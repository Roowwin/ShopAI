"use client";

/* The public returns form: find your order, say what is wrong, attach a photograph.

   THREE STEPS, IN THE ORDER THE API ENFORCES. The order is looked up FIRST, because everything
   after it is addressed to a specific order - and because a customer who mistyped their reference
   should find that out before filling in a description they would otherwise lose. A return can only
   be raised from an order the (reference, email) pair actually names, which is the check that stops
   anyone who has seen a confirmation link from returning somebody else's parcel.

   THE PHOTOGRAPH IS THE THIRD STEP AND IS OPTIONAL. A defective-goods claim is much stronger with
   one, but refusing the request without a photograph would lock out a customer whose camera is
   broken - so the form asks for it, explains why it helps, and lets them continue without it.

   NOTHING HERE DECIDES ANYTHING. Submitting raises a PENDING request; the shop answers it. The
   screen says so rather than implying an approval has happened. */

import { useState } from "react";

import { Button, Card, Heading, Input, fieldClass, cn } from "./ui";
import { API } from "@/lib/api";

const REASONS: { value: string; label: string }[] = [
  { value: "defective", label: "Defective - it does not work properly" },
  { value: "wrong_item", label: "Wrong item - not what I ordered" },
  { value: "changed_mind", label: "Changed my mind" },
];

type Found = { id: number; public_id: string; status: string; currency: string;
               total_cents: number; placed_at: string | null };
type Created = { public_id: string; number: string; status: string };

export default function RmaRequestForm() {
  const [step, setStep] = useState<"find" | "describe" | "photos" | "done">("find");
  const [ref, setRef] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<Found | null>(null);
  const [existing, setExisting] = useState<Created | null>(null);
  const [reason, setReason] = useState(REASONS[0].value);
  const [detail, setDetail] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The check-back half. A customer keeps the RMA NUMBER, not the internal id, so the lookup
  // accepts either - see `returns.get_by_ref`.
  const [checkRef, setCheckRef] = useState("");
  const [checkEmail, setCheckEmail] = useState("");
  const [found, setFound] = useState<any>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkErr, setCheckErr] = useState("");

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setCheckBusy(true); setCheckErr(""); setFound(null);
    const r = await fetch(
      API + `/store/returns/${encodeURIComponent(checkRef.trim())}?email=${encodeURIComponent(checkEmail.trim())}`);
    const j: any = await r.json().catch(() => ({}));
    setCheckBusy(false);
    if (!r.ok) { setCheckErr(typeof j?.detail === "string" ? j.detail : `Could not find that return (${r.status})`); return; }
    setFound(j);
  }

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch(API + "/store/returns/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ref: ref.trim(), email: email.trim() }),
    });
    const j: any = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(typeof j?.detail === "string" ? j.detail : `Could not find that order (${r.status})`); return; }
    setOrder(j.order);
    if (j.existing_return) { setExisting(j.existing_return); return; }
    setStep("describe");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch(API + "/store/returns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ref: ref.trim(), email: email.trim(), reason,
                             detail: detail.trim() || null }),
    });
    const j: any = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(typeof j?.detail === "string" ? j.detail : `Could not raise the return (${r.status})`); return; }
    setCreated(j.request);
    setStep("photos");
  }

  async function upload(files: FileList | null) {
    if (!files || !created) return;
    setBusy(true); setErr("");
    for (const f of Array.from(files)) {
      const body = new FormData();
      body.append("file", f);
      const r = await fetch(
        API + `/store/returns/${created.public_id}/photos?email=${encodeURIComponent(email.trim())}`,
        { method: "POST", body });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof j?.detail === "string" ? j.detail : `Upload failed (${r.status})`); break; }
      setUploaded((u) => [...u, j.filename]);
    }
    setBusy(false);
  }

  return (
    <>
      <Card className="p-6">
      <Heading level="h2">Start a return</Heading>
      <p className="mt-2 text-body text-ink-600">
        Enter the order reference from your confirmation and the email you ordered with. We will send
        you a return authorisation once it is approved - please do not post anything back before then.
      </p>

      {err && <p className="mt-3 text-sm text-danger-600">{err}</p>}

      {step === "find" && !existing && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={find}>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">Order reference</span>
            <Input className="mt-1 w-full px-4 py-2.5" required value={ref}
                   onChange={(e) => setRef(e.target.value)} placeholder="e.g. 8f1961da-1241-4bdf-…" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">Email on the order</span>
            <Input className="mt-1 w-full px-4 py-2.5" type="email" required value={email}
                   onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Find my order"}</Button>
          </div>
        </form>
      )}

      {existing && (
        <div className="mt-4 rounded-control bg-surface-sunken ring-1 ring-line p-4 text-body">
          <p className="font-medium text-ink-900">
            There is already an open return on this order - {existing.number}.
          </p>
          <p className="mt-1 text-ink-600">
            Its status is <span className="font-medium">{existing.status}</span>. Keep the reference
            handy; we will be in touch about it.
          </p>
        </div>
      )}

      {step === "describe" && order && (
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <p className="text-sm text-ink-600">
            Order found - placed {order.placed_at ?? "recently"} for {order.currency}{" "}
            {(order.total_cents / 100).toFixed(2)}.
          </p>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">Reason for return</span>
            <select className={cn(fieldClass, "mt-1 w-full px-4 py-2.5 bg-surface text-ink-900 ring-1 ring-line")}
                    value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">What went wrong? <span className="font-normal text-ink-500">(optional)</span></span>
            <textarea className={cn(fieldClass, "mt-1 w-full px-4 py-2.5 bg-surface text-ink-900 ring-1 ring-line")}
                      rows={3} maxLength={1000} value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                      placeholder="A sentence about the fault helps us authorise it faster." />
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Raise the return"}</Button>
        </form>
      )}

      {step === "photos" && created && (
        <div className="mt-4 space-y-4">
          <p className="text-body text-ink-900">
            Return <span className="font-medium">{created.number}</span> raised - it is{" "}
            <span className="font-medium">pending</span> review.
          </p>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">
              Add photographs of the problem <span className="font-normal text-ink-500">(optional, up to 5 MB each)</span>
            </span>
            <input className="mt-2 block text-sm" type="file" accept="image/*" multiple disabled={busy}
                   onChange={(e) => upload(e.target.files)} />
          </label>
          {uploaded.length > 0 && (
            <ul className="text-sm text-ink-600">
              {uploaded.map((n, i) => <li key={`${n}-${i}`}>Attached: {n}</li>)}
            </ul>
          )}
          <Button onClick={() => setStep("done")} disabled={busy}>
            {uploaded.length ? "Done" : "Continue without a photo"}
          </Button>
        </div>
      )}

      {step === "done" && created && (
        <div className="mt-4 rounded-control bg-surface-sunken ring-1 ring-line p-4">
          <p className="font-medium text-ink-900">Thanks - your return is with us.</p>
          <p className="mt-1 text-body text-ink-600">
            Your reference is <span className="font-medium">{created.number}</span>. We will review it
            and let you know the outcome. If it is approved you will be able to download a prepaid
            return label below.
          </p>
        </div>
      )}
      </Card>

      <Card className="p-6">
        <Heading level="h2">Check a return</Heading>
        <p className="mt-2 text-body text-ink-600">
          Use the reference we gave you and the email you ordered with. Once your return is approved,
          its prepaid label appears here to print.
        </p>
        {checkErr && <p className="mt-3 text-sm text-danger-600">{checkErr}</p>}
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={check}>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">Return reference</span>
            <Input className="mt-1 w-full px-4 py-2.5" required value={checkRef}
                   onChange={(e) => setCheckRef(e.target.value)} placeholder="RMA-2026-00001" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-900">Email on the order</span>
            <Input className="mt-1 w-full px-4 py-2.5" type="email" required value={checkEmail}
                   onChange={(e) => setCheckEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={checkBusy}>{checkBusy ? "Checking…" : "Check status"}</Button>
          </div>
        </form>

        {found && (
          <div className="mt-4 rounded-control bg-surface-sunken ring-1 ring-line p-4 text-body">
            <p className="text-ink-900">
              {found.request.number} is <span className="font-medium">{found.request.status}</span>.
            </p>
            {found.request.decision_note && (
              <p className="mt-1 text-ink-600">From us: {found.request.decision_note}</p>
            )}
            {found.label ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-ink-900">
                  Return label - {found.label.carrier}, tracking{" "}
                  <span className="font-mono">{found.label.tracking_ref}</span>
                </p>
                <address className="mt-1 not-italic text-ink-600">
                  Send it to: {found.label.return_to.name}
                  {found.label.return_to.address
                    ? found.label.return_to.address.split(/\r?\n/).map((l: string) => (
                        <span key={l} className="block">{l}</span>))
                    : null}
                  {found.label.return_to.email && <span className="block">{found.label.return_to.email}</span>}
                </address>
                <p className="mt-2 text-xs text-ink-500">
                  Print this page and include it in the parcel, or write the tracking reference on the box.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-ink-600">
                No label yet - one is issued only when the return is approved.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
