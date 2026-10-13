VERDICT: PASS

Fast-lane landing (owner directive). What was actually checked, stated plainly:

- Every team route is `Depends(require_roles("admin"))` AND carries the in-body `_require_admin`
  guard, so the plain-function dispatch path in `staff_ai.chat` is refused too. None of the three
  action names is in `GUARDED_ACTIONS`, so no agent grant can reach them.
- No route returns a secret. `GET /staff/team` selects named columns and never `password_hash` or
  `totp_secret`; the test asserts the serialised body contains neither string.
- The only plaintext emitted is a freshly minted password, in the reset response, once - the same
  contract `bootstrap_staff.py` keeps. The row stores only `hash_password`, and the test asserts the
  returned plaintext appears in NO audit row.
- Three refusals limit an admin's blast radius: changing your own role, suspending your own account,
  and demoting or suspending the LAST active admin. Each is a way to lock the platform out.
- A suspension and a password reset both revoke the member's live `refresh_tokens` in the same
  transaction as the change, so neither is cosmetic: the test signs in as a suspended member
  afterwards and requires the refusal, and counts the revoked rows directly.
- The Team page is admin-gated in the UI as well, but that is UX only; the server is the wall.
