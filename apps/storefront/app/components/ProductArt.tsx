import type { ReactNode } from "react";
import { iconFor } from "@/lib/productIcons";

type Props = {
  slug?: string | null;
  imageUrl?: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
};

/* Card art, best available first: the product's own photo (image_url), else the category-glyph icon
   shipped for its slug (lib/productIcons), else the caller's tile (the initials block). No client JS
   and no onError: the icon set is known at build time, so the markup never points at a file that is
   not there - and a slug with no art just falls through to the tile. */
export default function ProductArt({ slug, imageUrl, alt, className, fallback }: Props) {
  if (imageUrl) return <img src={imageUrl} alt={alt} className={className} />;
  const icon = iconFor(slug);
  if (!icon) return <>{fallback}</>;
  return <img src={icon} alt="" className={className} />;   // decorative: the product title sits beside it
}
