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

/* WHERE THE PHOTOGRAPHY IS FETCHED FROM, for a storefront that is not served by its own API's host.

   The API mints SHOP-RELATIVE addresses - `/media/<uuid>` - because in the docker stack nginx serves
   that prefix on the shop vhost, and a relative path is then the same origin as the page. Deployed
   anywhere else (Vercel, say) the page inherits that path onto ITS OWN domain, which serves nothing
   there, so every product photograph and every banner 404s while the pages themselves render
   perfectly - the confusing half of this bug.

   Set NEXT_PUBLIC_MEDIA_BASE to whatever does serve it and the relative paths are prefixed with it:
     * `https://api.example.com/store`   - the API's own route is `/store/media/{id}`;
     * or `https://shop.example.com`     - if nginx in front of it rewrites `/media/` as the stack does.
   LEAVE IT UNSET LOCALLY: the empty default prefixes nothing, and the relative path is already right.

   ONLY THE API'S MEDIA PATHS GO THROUGH THIS. The category glyphs (`/icons/<slug>.svg`) are files in
   this app's own `public/`, they deploy with the storefront, and prefixing those would break them. */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE ?? "").replace(/\/+$/, "");

/** An image address from the API, resolved against the media host when one is configured. */
export function mediaUrl(path?: string | null): string {
  if (!path) { return ""; }
  return MEDIA_BASE ? MEDIA_BASE + path : path;
}
