export const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.rfo.localhost";
export const INTERNAL = process.env.API_INTERNAL_URL ?? "http://api:8000";

export async function apiInternal(path: string, revalidate = 30): Promise<any> {
  const r = await fetch(INTERNAL + path, { next: { revalidate } });
  if (!r.ok) throw new Error("upstream " + r.status);
  return r.json();
}

export function aud(cents: number): string {
  return (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}
