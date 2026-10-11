export const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.rfo.localhost";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const access = typeof window !== "undefined" ? sessionStorage.getItem("rfo_access") : null;
  const headers = new Headers(init?.headers ?? {});
  if (access) headers.set("Authorization", "Bearer " + access);
  let r = await fetch(API + path, { ...init, headers, credentials: "include", cache: "no-store" });
  if (r.status === 401 && access) {
    const rr = await fetch(API + "/staff/auth/refresh", { method: "POST", credentials: "include", cache: "no-store" });
    if (rr.ok) {
      const j: any = await rr.json();
      sessionStorage.setItem("rfo_access", j.access_token);
      headers.set("Authorization", "Bearer " + j.access_token);
      r = await fetch(API + path, { ...init, headers, credentials: "include", cache: "no-store" });
    }
  }
  if (r.status === 401) {
    sessionStorage.removeItem("rfo_access");
    // The sign-in endpoints answer 401 for bad credentials - hand that back so the login /
    // MFA page can show the reason instead of reloading itself.
    // Everything else is a dead session. Send the user to the LOGIN page ("/"). Redirecting
    // to "/admin" looped forever: /admin is itself behind this check, so it re-401s on arrival.
    if (!path.startsWith("/staff/auth/")) {
      location.href = "/";
      throw new Error("session expired - redirecting to login");
    }
  }
  return r;
}

export async function logout() {
  await fetch(API + "/staff/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
  sessionStorage.removeItem("rfo_access");
}