"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/app/components/ui";
import { apiFetch } from "@/lib/api";
import { storefrontUrl } from "./site";

/* ONE PICTURE IN THE CMS, from either of the two addresses a product photo can have.

   A URL-BACKED photo is fetched by the browser from the shop, exactly as the storefront fetches it:
   no token, no blob, no round trip through the API. That is the kind the picker chooses between, and
   it is why the tile here and the tile on the shop floor are the same picture.

   A BYTE-BACKED photo has no such address - its bytes sit in Postgres behind the staff token - so it
   comes through the authenticated door the same way a unit's photograph does in the image hub, and
   is held as a blob URL for as long as it is on screen. It is shown so that an operator recognises a
   photo they uploaded; it is not selectable, because there is nothing public to point the catalogue
   at and a broken tile on the shop floor is worse than an honest "not publishable" here.

   A FAILED LOAD FALLS BACK rather than leaving a broken-image icon: in dev the seeded addresses point
   at hosts that do not resolve, and a CMS that draws a smashed tile for every one of them reads as
   broken when it is only offline. The caller says what to draw instead - the same "no photo" tile a
   product with no address gets. */
type Props = {
  address?: string | null;
  rawPath?: string | null;
  alt: string;
  className?: string;
  fallback: ReactNode;
};

export default function Photo({ address, rawPath, alt, className, fallback }: Props) {
  const src = storefrontUrl(address);
  const [blob, setBlob] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (src || !rawPath) { return; }
    let alive = true;
    let made = "";
    apiFetch(rawPath)
      .then(async (r) => {
        if (!r.ok) { if (alive) { setFailed(true); } return; }
        const b = await r.blob();
        if (!alive) { return; }
        made = URL.createObjectURL(b);
        setBlob(made);
      })
      .catch(() => { if (alive) { setFailed(true); } });
    return () => {
      alive = false;
      if (made) { URL.revokeObjectURL(made); }
    };
  }, [src, rawPath]);

  /* A blob URL is revoked and replaced when this picture changes, so the state is cleared with it -
     otherwise the previous photo stays on screen under the new row's name. */
  useEffect(() => { setBlob(""); }, [src, rawPath, address]);

  const shown = src ?? (blob || null);
  if (!shown || failed) { return <>{fallback}</>; }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a blob URL or the shop's own address, not a bundled asset
    <img src={shown} alt={alt} onError={() => setFailed(true)} className={cn(className)} />
  );
}
