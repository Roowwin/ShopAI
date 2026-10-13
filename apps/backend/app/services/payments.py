"""Payment providers: how a webhook is trusted, what it means, and how a charge is created.

THE SHAPE. Three providers sit behind one interface - `stub`, `stripe`, `paypal` - and the rest of
the app never branches on the name:

    verify(raw_body, headers, secret)  -> is this really from the provider?
    parse(raw_body)                    -> {event_id, type, provider_ref, amount_cents}
    create_checkout(order, secret)     -> {provider_ref, redirect_url}   (the outbound call)

`type` is always one of the three NORMALISED events below, so the webhook handler has one switch
rather than one per provider. That normalisation is the whole point of the module: `stripe` says
`payment_intent.payment_failed`, `paypal` says `PAYMENT.CAPTURE.DENIED`, and the order lifecycle
should not have to learn either vocabulary.

IDEMPOTENCY AT THE SOURCE. The provider's own event id is written to `payment_events` under
`UNIQUE (provider, event_id)` before anything else happens, so a redelivered event is a duplicate
INSERT rather than a second side effect. Inferring "already handled" from the payment row's status
(what the stub flow used to do) only works while exactly one event type can move a payment; the
moment refunds exist, `succeeded` arriving twice and `succeeded` then `refunded` are both "the
payment row changed", and the row cannot tell them apart.

WHERE THE SECRET COMES FROM. The Settings API's `api_keys` store (services/system_settings), falling
back to the `PAYMENT_WEBHOOK_SECRET` environment value for the stub provider - so the existing stub
deployment keeps working unchanged and a real provider is configured from the page rather than by
editing .env.

PAYPAL'S SIGNATURE IS VERIFIED LOCALLY, AND THAT IS A SIMPLIFICATION WORTH STATING. PayPal's own
verification is an outbound POST to /v1/notifications/verify-webhook-signature carrying the whole
event; it cannot be done offline. This module verifies an HMAC-SHA256 of the raw body under an
`x-paypal-signature` header instead, which is a real check against anyone who does not hold the
secret but is NOT what PayPal does. A production PayPal deployment must replace `_verify_paypal`
with the API call - the seam is one function, and the comment at that function says so.
"""

import hashlib
import hmac
import json
import time
import uuid

import httpx
from sqlalchemy import text

from app.services import system_settings as ss

STUB = "stub"
STRIPE = "stripe"
PAYPAL = "paypal"
PROVIDERS = (STUB, STRIPE, PAYPAL)

# The normalised vocabulary the order lifecycle understands. A provider event that maps to none of
# these is still RECORDED (the log is worth having) but moves nothing.
EV_SUCCEEDED = "payment.succeeded"
EV_FAILED = "payment.failed"
EV_REFUNDED = "payment.refunded"
EV_IGNORED = "payment.ignored"

# Stripe's replay window. A signature older than this is refused even though it verifies, because a
# correctly signed request captured off the wire is still valid forever otherwise.
STRIPE_TOLERANCE_SECONDS = 300


class WebhookRejected(ValueError):
    """The request could not be attributed to the provider. Carries the operator-readable reason."""


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------
async def signing_secret(db, provider: str, env_secret: str = "") -> str:
    """The WEBHOOK SIGNING secret for a provider: Settings API key, else the env value.

    Two credentials are not one. A provider usually issues an API key to call it WITH and a separate
    signing secret to verify what it calls back with, so the store is asked for `<provider>.webhook`
    first and the bare `<provider>` second - an operator who has only one credential stores it under
    the bare name and both lookups find it, and one who has both can keep them apart. (The Settings
    API's provider slug allows a dot and not an underscore, which is why the suffix is `.webhook`.)

    The env fallback is only meaningful for the stub provider - that is what PAYMENT_WEBHOOK_SECRET
    has always been. For a real provider an unconfigured secret means "no request can be verified",
    which the caller turns into a refusal rather than an open door.
    """
    try:
        stored = (await ss.get_api_key(db, f"{provider}.webhook")
                  or await ss.get_api_key(db, provider))
    except Exception:
        stored = None
    return stored or (env_secret if provider == STUB else "")


async def api_key(db, provider: str) -> str:
    """The OUTBOUND credential for a provider, or "" when none is stored."""
    try:
        return await ss.get_api_key(db, provider) or ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------
def _const_eq(a: str, b: str) -> bool:
    return hmac.compare_digest((a or "").encode(), (b or "").encode())


def verify(provider: str, raw: bytes, headers, secret: str) -> None:
    """Raise :class:`WebhookRejected` unless the request is provably from `provider`.

    An EMPTY secret is a refusal, never a pass: a deployment that has not configured the provider
    must not accept any webhook for it. That is the one place this module is deliberately paranoid.
    """
    if not secret:
        raise WebhookRejected(f"no {provider} signing secret is configured")
    if provider == STRIPE:
        _verify_stripe(raw, headers, secret)
    elif provider == PAYPAL:
        _verify_paypal(raw, headers, secret)
    else:
        _verify_stub(raw, headers, secret)


def _verify_stub(raw: bytes, headers, secret: str) -> None:
    """The original scheme: hex HMAC-SHA256 of the raw body in `x-stub-signature`."""
    expect = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not _const_eq(headers.get("x-stub-signature", ""), expect):
        raise WebhookRejected("bad webhook signature")


def _verify_stripe(raw: bytes, headers, secret: str) -> None:
    """Stripe's scheme: a `stripe-signature` header of `t=<unix>,v1=<hex>`, signed over `t.body`."""
    header = headers.get("stripe-signature", "")
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    timestamp, signature = parts.get("t", ""), parts.get("v1", "")
    if not timestamp or not signature:
        raise WebhookRejected("malformed stripe-signature header")
    try:
        if abs(time.time() - int(timestamp)) > STRIPE_TOLERANCE_SECONDS:
            raise WebhookRejected("stripe signature timestamp is outside the tolerance window")
    except ValueError:
        raise WebhookRejected("malformed stripe-signature timestamp")
    signed = timestamp.encode() + b"." + raw
    expect = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not _const_eq(signature, expect):
        raise WebhookRejected("bad webhook signature")


def _verify_paypal(raw: bytes, headers, secret: str) -> None:
    """A LOCAL HMAC stand-in for PayPal's outbound verification - see the module docstring.

    REPLACE THIS with a POST to /v1/notifications/verify-webhook-signature before taking real PayPal
    traffic. It is one function so that the replacement is one edit, and it is stated here rather
    than left for whoever notices the traffic is trusted on a shared secret.
    """
    expect = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not _const_eq(headers.get("x-paypal-signature", ""), expect):
        raise WebhookRejected("bad webhook signature")


# ---------------------------------------------------------------------------
# Parsing: the provider's payload -> the normalised event
# ---------------------------------------------------------------------------
def _obj(raw: bytes) -> dict:
    try:
        body = json.loads(raw.decode() or "{}")
    except (ValueError, UnicodeDecodeError):
        raise WebhookRejected("webhook body is not JSON")
    return body if isinstance(body, dict) else {}


def parse(provider: str, raw: bytes) -> dict:
    """The provider's payload as {event_id, type, provider_ref, amount_cents, payload}."""
    body = _obj(raw)
    if provider == STRIPE:
        return _parse_stripe(body)
    if provider == PAYPAL:
        return _parse_paypal(body)
    return _parse_stub(body)


def _parse_stub(body: dict) -> dict:
    event = str(body.get("event") or "")
    kind = {"payment.succeeded": EV_SUCCEEDED, "payment.failed": EV_FAILED,
            "payment.refunded": EV_REFUNDED}.get(event, EV_IGNORED)
    ref = str(body.get("ref") or "")
    if not ref:
        raise WebhookRejected("stub webhook has no ref")
    # The stub has no natural event id, so one is derived from the ref and the event: the same
    # (ref, event) pair delivered twice is the same event, which is exactly what the log's UNIQUE
    # must collapse.
    return {"event_id": f"{ref}:{event}", "type": kind, "provider_ref": ref,
            "amount_cents": body.get("amount_cents"), "payload": body}


def _parse_stripe(body: dict) -> dict:
    kind = {"payment_intent.succeeded": EV_SUCCEEDED,
            "payment_intent.payment_failed": EV_FAILED,
            "charge.refunded": EV_REFUNDED}.get(str(body.get("type") or ""), EV_IGNORED)
    obj = (body.get("data") or {}).get("object") or {}
    # A refund event's object is the CHARGE; its payment_intent is the id we stored, and the refunded
    # amount is the charge's own amount_refunded. A payment intent event's object IS the id.
    ref = str(obj.get("payment_intent") or obj.get("id") or "")
    event_id = str(body.get("id") or "")
    if not event_id:
        raise WebhookRejected("stripe webhook has no event id")
    amount = obj.get("amount_refunded") if kind == EV_REFUNDED else obj.get("amount_received") or obj.get("amount")
    return {"event_id": event_id, "type": kind, "provider_ref": ref,
            "amount_cents": amount, "payload": body}


def _parse_paypal(body: dict) -> dict:
    kind = {"PAYMENT.CAPTURE.COMPLETED": EV_SUCCEEDED,
            "PAYMENT.CAPTURE.DENIED": EV_FAILED,
            "PAYMENT.CAPTURE.REFUNDED": EV_REFUNDED}.get(str(body.get("event_type") or ""), EV_IGNORED)
    resource = body.get("resource") or {}
    # PayPal puts our reference (the order id we sent when creating the capture) in the resource's
    # custom_id, and the capture's own id in `id`. Prefer the capture id - it is what a refund will
    # name later - and fall back to custom_id so a hand-made test event still resolves.
    ref = str(resource.get("id") or resource.get("custom_id") or "")
    event_id = str(body.get("id") or "")
    if not event_id:
        raise WebhookRejected("paypal webhook has no event id")
    amount = None
    amt = (resource.get("amount") or {})
    if isinstance(amt, dict) and amt.get("value") is not None:
        try:
            amount = int(round(float(amt["value"]) * 100))
        except (TypeError, ValueError):
            amount = None
    return {"event_id": event_id, "type": kind, "provider_ref": ref,
            "amount_cents": amount, "payload": body}


# ---------------------------------------------------------------------------
# The event log
# ---------------------------------------------------------------------------
async def record_event(db, *, provider: str, event: dict, payment_id: int | None,
                       order_id: int | None) -> bool:
    """Write the provider's event if it is new. True when it was new, False on a redelivery.

    `ON CONFLICT DO NOTHING ... RETURNING` is the whole idempotency mechanism: the second delivery
    of one event inserts nothing and the caller skips its side effects. Nothing is compared in
    Python, so two workers racing the same event cannot both see "not present".
    """
    inserted = (await db.execute(text("""
        INSERT INTO payment_events (provider, event_id, event_type, payment_id, order_id,
                                    amount_cents, payload)
        VALUES (:pv, :eid, :etype, :pid, :oid, :amt, CAST(:pl AS jsonb))
        ON CONFLICT (provider, event_id) DO NOTHING
        RETURNING id"""),
        {"pv": provider, "eid": event["event_id"], "etype": event["type"],
         "pid": payment_id, "oid": order_id, "amt": event.get("amount_cents"),
         "pl": json.dumps(event.get("payload") or {})})).scalar_one_or_none()
    return inserted is not None


# ---------------------------------------------------------------------------
# The outbound call
# ---------------------------------------------------------------------------
# NOT EXERCISED BY ANY TEST, DELIBERATELY: there is no Stripe or PayPal account in this environment,
# and a test that reached out would be a test of the network. What IS tested is the refusal - a
# provider with no configured key answers 503 rather than pretending to have created a charge - and
# the webhook half above, which is the half that has to be right for money to be tracked at all.
async def create_checkout(*, provider: str, order: dict, secret: str, return_url: str) -> dict:
    """Ask the provider for something to send the shopper to. Returns {provider_ref, redirect_url}."""
    if provider == STUB:
        return {"provider_ref": "stub-" + uuid.uuid4().hex, "redirect_url": None}
    if not secret:
        raise LookupError(f"no {provider} API key is configured")
    if provider == STRIPE:
        return await _stripe_checkout(order=order, secret=secret, return_url=return_url)
    if provider == PAYPAL:
        return await _paypal_checkout(order=order, secret=secret, return_url=return_url)
    raise LookupError(f"unknown payment provider {provider!r}")


async def _stripe_checkout(*, order: dict, secret: str, return_url: str) -> dict:
    """A Stripe Checkout Session. `secret` is the secret key from the Settings API."""
    form = {
        "mode": "payment",
        "success_url": return_url,
        "cancel_url": return_url,
        "client_reference_id": order["public_id"],
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": order.get("currency", "AUD").lower(),
        "line_items[0][price_data][unit_amount]": str(order["total_cents"]),
        "line_items[0][price_data][product_data][name]": f"Order {order['public_id'][:8]}",
    }
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post("https://api.stripe.com/v1/checkout/sessions", data=form,
                            auth=(secret, ""))
    if r.status_code >= 400:
        raise LookupError(f"stripe refused the session: {r.status_code} {r.text[:200]}")
    body = r.json()
    return {"provider_ref": body.get("id") or body.get("payment_intent") or "",
            "redirect_url": body.get("url")}


async def _paypal_checkout(*, order: dict, secret: str, return_url: str) -> dict:
    """A PayPal order. `secret` is the client id and secret joined by a colon (`id:secret`)."""
    client_id, _, client_secret = secret.partition(":")
    if not client_secret:
        raise LookupError("paypal key must be 'client_id:client_secret'")
    async with httpx.AsyncClient(timeout=20.0) as http:
        tok = await http.post("https://api-m.paypal.com/v1/oauth2/token",
                              data={"grant_type": "client_credentials"},
                              auth=(client_id, client_secret))
        if tok.status_code >= 400:
            raise LookupError(f"paypal refused the token: {tok.status_code} {tok.text[:200]}")
        access = tok.json().get("access_token", "")
        r = await http.post("https://api-m.paypal.com/v2/checkout/orders",
                            headers={"Authorization": f"Bearer {access}"},
                            json={"intent": "CAPTURE",
                                  "purchase_units": [{
                                      "custom_id": order["public_id"],
                                      "amount": {"currency_code": order.get("currency", "AUD"),
                                                 "value": f"{order['total_cents'] / 100:.2f}"}}],
                                  "payment_source": {"paypal": {
                                      "experience_context": {"return_url": return_url,
                                                             "cancel_url": return_url}}}})
    if r.status_code >= 400:
        raise LookupError(f"paypal refused the order: {r.status_code} {r.text[:200]}")
    body = r.json()
    link = next((l.get("href") for l in body.get("links", []) if l.get("rel") == "payer-action"), None)
    return {"provider_ref": body.get("id") or "", "redirect_url": link}
