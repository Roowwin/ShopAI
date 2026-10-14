"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { register, signIn } from "@/lib/session";
import { Button, Card, Heading, Input, linkClass } from "../../components/ui";

/* SIGN IN / CREATE AN ACCOUNT.
 *
 * The storefront has never had this screen. `/store/auth/register` and `/store/auth/login` have
 * existed since Phase 3 and no page in the shop ever called them, so a customer session was
 * unreachable from a browser and "My Orders" had nothing to be behind.
 *
 * ONE SCREEN, TWO MODES, because they are the same two fields and the same one call either way -
 * two routes would be two copies of the same form, and the only difference (a display name) is one
 * input.
 *
 * THE MODE COMES FROM THE QUERY STRING, read in an effect rather than with `useSearchParams()`.
 * That hook forces the whole route behind a Suspense boundary to prerender, which is a lot of
 * machinery to carry a `?mode=register` from the account page's "Create an account" button. The
 * cost is one frame in sign-in mode before the effect flips it.
 *
 * THE ERRORS ARE THE SERVER'S. "invalid credentials" and "email already registered" are sentences
 * the API already writes and that a sign-in form must not paraphrase - a client that invents its own
 * wording drifts from the rule that actually refused.
 */

/** A FastAPI error body is sometimes a string and sometimes a list of field errors. */
function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: string[] };
    const field = first?.loc?.filter((p) => p !== "body").join(".");
    return (field ? field + ": " : "") + (first?.msg ?? "that did not work");
  }
  return "that did not work";
}

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "register") {
      setMode("register");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (mode === "register" && password.length < 10) {
      setErr("choose a password of at least 10 characters");
      return;
    }
    setBusy(true);
    const res = mode === "signin"
      ? await signIn(email.trim(), password)
      : await register(email.trim(), password, displayName.trim());
    setBusy(false);
    if (!res.ok) { setErr(detailText(res.body?.detail)); return; }
    // Straight to the orders the account exists to show. `/account` re-reads the session itself, so
    // nothing has to be passed across.
    router.push("/account");
  }

  return (
    <main className="max-w-md mx-auto px-4 pt-20 pb-28">
      <Heading level="h1">{mode === "signin" ? "Sign in" : "Create your account"}</Heading>
      <p className="text-sm text-ink-500 mt-2">
        {mode === "signin"
          ? "See every order you have placed and where each one has got to."
          : "An account keeps your orders in one place. You can still check out as a guest."}
      </p>

      <Card className="p-5 md:p-6 mt-6">
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-ink-600 mb-1" htmlFor="display_name">
                Your name (optional)
              </label>
              <Input id="display_name" autoComplete="name" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink-600 mb-1" htmlFor="email">Email</label>
            <Input id="email" type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-600 mb-1" htmlFor="password">Password</label>
            <Input id="password" type="password" required value={password}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)} />
            {mode === "register" && (
              <p className="text-xs text-ink-400 mt-1">At least 10 characters, including a number.</p>
            )}
          </div>
          <Button variant="primary" type="submit" className="w-full" disabled={busy} busy={busy}>
            {busy ? "One moment..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {err && <p className="mt-4 text-sm text-danger-600" role="alert">{err}</p>}

        <p className="mt-5 text-sm text-ink-600">
          {mode === "signin" ? (
            <>New here?{" "}
              <button type="button" className={linkClass} onClick={() => { setMode("register"); setErr(""); }}>
                Create an account
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button type="button" className={linkClass} onClick={() => { setMode("signin"); setErr(""); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </Card>

      <p className="mt-6 text-xs text-ink-400">
        <a href="/" className={linkClass}>Keep shopping</a>
      </p>
    </main>
  );
}
