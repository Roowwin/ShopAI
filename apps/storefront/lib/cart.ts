export type CartLine = { asset_id: number; title: string; grade: string; price_cents: number; serial_tail: string };

const KEY = "rfo_cart";

function ping(): void {
  if (typeof window !== "undefined") { window.dispatchEvent(new Event("rfocart")); }
}

export function cartGet(): CartLine[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function cartAdd(line: CartLine): CartLine[] {
  const c = cartGet();
  if (c.find((x) => x.asset_id === line.asset_id)) return c;
  c.push(line);
  sessionStorage.setItem(KEY, JSON.stringify(c));
  ping();
  return c;
}

export function cartRemove(assetId: number): CartLine[] {
  const c = cartGet().filter((x) => x.asset_id !== assetId);
  sessionStorage.setItem(KEY, JSON.stringify(c));
  ping();
  return c;
}

export function cartTotal(): number {
  return cartGet().reduce((s, x) => s + x.price_cents, 0);
}

export function cartClear(): void {
  sessionStorage.removeItem(KEY);
  ping();
}