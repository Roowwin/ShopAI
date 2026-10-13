import { ImageResponse } from "next/og";

/* The share card. Rendered from JSX at request time - the storefront ships no brand raster
   assets, so there is no image file to keep in sync with the palette.

   Which is also why these six values are LITERALS and not tokens: ImageResponse rasterises this
   JSX outside the browser, so there is no stylesheet and no `var(--brand-700)` to resolve. They
   mirror the brand ladder in globals.css by hand - 700/800/950 down the gradient, 200 for the
   kicker line, 500 for the dot, 100 for the sub-line - and they moved with it when the palette
   went from emerald to forest green. A later palette edit has to move them again; nothing can
   catch that automatically. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "RFO Store - certified refurbished, delivered across AU & NZ";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          background: "linear-gradient(90deg, #245B45 0%, #1B4634 55%, #091B14 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, letterSpacing: 6, textTransform: "uppercase", color: "#C8DBCF" }}>
          <div style={{ width: 22, height: 22, borderRadius: 9999, background: "#35775A" }} />
          RFO Store
        </div>
        <div style={{ fontSize: 88, fontWeight: 700, marginTop: 28, lineHeight: 1.05 }}>Renewed tech. Zero waste.</div>
        <div style={{ fontSize: 36, marginTop: 28, color: "#E7EFE8" }}>
          Certified refurbished devices - serialised, graded, warehouse-tracked.
        </div>
      </div>
    ),
    { ...size },
  );
}
