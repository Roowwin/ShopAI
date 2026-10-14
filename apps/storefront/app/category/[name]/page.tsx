import { apiInternal } from "@/lib/api";
import LoadMore from "@/app/components/LoadMore";
import { Heading, navLinkClass } from "@/app/components/ui";

export const revalidate = 0;

export default async function CategoryPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const cat = decodeURIComponent(name);
  const items: any[] = await apiInternal("/store/catalog?limit=8&category=" + encodeURIComponent(cat));
  return (
    <main className="max-w-6xl mx-auto px-4 pt-14 pb-16">
      <nav className="text-xs text-ink-400 mb-4"><a href="/" className={navLinkClass}>Home</a> / {cat}</nav>
      <Heading level="h1">{cat}</Heading>
      <p className="text-body text-ink-500 mt-2">Certified refurbished, serialised and graded.</p>
      <div className="mt-8"><LoadMore initial={items} /></div>
    </main>
  );
}
