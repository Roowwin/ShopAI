import { apiInternal } from "@/lib/api";
import LoadMore from "@/app/components/LoadMore";

export const revalidate = 0;

export default async function CategoryPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const cat = decodeURIComponent(name);
  const items: any[] = await apiInternal("/store/catalog?limit=8&category=" + encodeURIComponent(cat));
  return (
    <main className="max-w-6xl mx-auto px-4 pt-6 pb-10">
      <nav className="text-xs text-slate-400 mb-3"><a href="/" className="hover:text-emerald-700">Home</a> / {cat}</nav>
      <h1 className="text-2xl font-semibold">{cat}</h1>
      <p className="text-sm text-slate-500 mt-1">Certified refurbished, serialised and graded.</p>
      <div className="mt-5"><LoadMore initial={items} /></div>
    </main>
  );
}