import { API } from "./api";

/* The CUSTOMER's session, from the browser.
 *
 * The storefront has had no account UI at all: `/store/auth/register|login|refresh|logout|me` have
 * existed since Phase 3 and nothing in the shop ever called them, so a customer session was
 * unreachable from a page. This module is that half.
 *
 * It is deliberately a near-copy of `apps/backoffice/lib/api.ts` rather than something cleverer,
 * because the two are the same mechanism on two different zones and the differences are the ones
 * that matter:
 *
 *   * the token is the CUSTOMER type, so it is refused by every /staff route (the API decodes by
 *     token `typ`, not by which client asked), and
 *   * the refresh cookie is `rfo_rt_store`, scoped by the API to `path=/store/auth` - so the refresh
 *     below is the ONLY request that carries it, and `credentials: "include"` on every call is what
 *     lets that happen across the shop->api origin boundary.
 *
 * THE TOKEN LIVES IN sessionStorage, NOT localStorage. It is a bearer credential with a short life
 * and no value after the tab closes; localStorage would leave it readable by any script on this
 * origin long after the shopper has gone. That also means a SERVER component cannot be the customer
 * - sessionStorage does not exist on the server - which is why the order pages that need to show an
 * owner their own address are client components.
 */

const TOKEN_KEY = "rfo_customer_access";

export type Customer = { id: number; public_id: string; email: string; display_name: string | null };

export type OrderSummary = {
  public_id: string; status: string; currency: string; total_cents: number;
  placed_at: string; item_count: number; first_title: string | null;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

/* One authenticated call. On a 401 it mints a new access token from the refresh cookie ONCE and
 * retries; if that fails too the stored token is dropped, because a token the API has already
 * refused twice is not worth presenting a third time.
 *
 * The 401 is NOT turned into a redirect here (the backoffice does that, and it is the reason that
 * client needs its own carve-out for the sign-in path). This module is used by pages that are
 * allowed to be anonymous, so "not signed in" is an answer rather than an error - the caller decides
 * what to render.
 */
export async function apiCustomer(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  const token = getToken();
  if (token) headers.set("Authorization", "Bearer " + token);
  let r = await fetch(API + path, { ...init, headers, credentials: "include", cache: "no-store" });
  if (r.status === 401 && token) {
    const rr = await fetch(API + "/store/auth/refresh", { method: "POST", credentials: "include", cache: "no-store" });
    if (rr.ok) {
      const j: any = await rr.json();
      setToken(j.access_token);
      headers.set("Authorization", "Bearer " + j.access_token);
      r = await fetch(API + path, { ...init, headers, credentials: "include", cache: "no-store" });
    } else {
      setToken(null);
    }
  }
  return r;
}

/* The three session actions. Each returns the API's parsed body plus whether it worked, so a page
 * can show the server's own sentence ("invalid credentials", "email already registered") instead of
 * inventing one it cannot keep true.
 */
async function session(path: string, body: unknown): Promise<{ ok: boolean; body: any }> {
  const r = await fetch(API + path, {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const parsed = await r.json().catch(() => ({}));
  if (r.ok && parsed?.access_token) setToken(parsed.access_token);
  return { ok: r.ok, body: parsed };
}

export function signIn(email: string, password: string) {
  return session("/store/auth/login", { email, password });
}

export function register(email: string, password: string, display_name: string) {
  return session("/store/auth/register", { email, password, display_name });
}

export async function signOut(): Promise<void> {
  await fetch(API + "/store/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
  setToken(null);
}

/** Who is signed in, or null. Never throws: this answers a question, it does not guard a door. */
export async function me(): Promise<Customer | null> {
  if (!getToken()) return null;
  const r = await apiCustomer("/store/me");
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}
