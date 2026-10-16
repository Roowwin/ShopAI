import type { CSSProperties, ReactNode } from "react";
import { mediaUrl } from "@/lib/api";
import { iconFor } from "@/lib/productIcons";

type Props = {
  slug?: string | null;
  imageUrl?: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
  /** The one image above the fold (the product page's hero, the homepage fan). Card art is lazy. */
  priority?: boolean;
  /** Passed through to the <img> - the hero staggers its float with it. */
  style?: CSSProperties;
};

/* Card art, best available first: the product's own photo (image_url), else the category-glyph icon
   shipped for its slug (lib/productIcons), else the caller's tile (the initials block). No client JS
   and no onError: the icon set is known at build time, so the markup never points at a file that is
   not there - and a slug with no art just falls through to the tile.

   Card art is below the fold in practice, so both images load lazily and decode off the main thread.
   The box is sized by the caller's aspect-[4/3] class, so there is no layout shift on load.

   `priority` is for the product page's hero shot, which IS the fold: lazy-loading it delays the
   largest paint for no benefit, since it is visible before anything scrolls. */
export default function ProductArt({ slug, imageUrl, alt, className, fallback, priority, style }: Props) {
  const loading = priority ? "eager" : "lazy";
  if (imageUrl) return <img src={mediaUrl(imageUrl)} alt={alt} className={className} style={style} loading={loading} fetchPriority={priority ? "high" : "auto"} decoding="async" />;
  const icon = iconFor(slug);
  if (!icon) return <>{fallback}</>;
  return <img src={icon} alt="" className={className} style={style} loading={loading} decoding="async" />;   // decorative: the product title sits beside it
}
