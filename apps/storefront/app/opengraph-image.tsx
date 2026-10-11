import { ImageResponse } from "next/og";

/* The share card. Rendered from JSX at request time - the storefront ships no brand raster
   assets, so there is no image file to keep in sync with the palette. */
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
          background: "linear-gradient(90deg, #047857 0%, #065f46 55%, #022c22 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, letterSpacing: 6, textTransform: "uppercase", color: "#a7f3d0" }}>
          <div style={{ width: 22, height: 22, borderRadius: 9999, background: "#10b981" }} />
          RFO Store
        </div>
        <div style={{ fontSize: 88, fontWeight: 700, marginTop: 28, lineHeight: 1.05 }}>Renewed tech. Zero waste.</div>
        <div style={{ fontSize: 36, marginTop: 28, color: "#d1fae5" }}>
          Certified refurbished devices - serialised, graded, warehouse-tracked.
        </div>
      </div>
    ),
    { ...size },
  );
}
