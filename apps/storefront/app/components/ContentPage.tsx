import type { ReactNode } from "react";
import { Card, Heading } from "./ui";

export default function ContentPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main className="max-w-3xl mx-auto pt-8 px-4 pb-12">
      <Heading level="h1">{title}</Heading>
      <p className="text-lead text-ink-600 mt-2">{intro}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <Heading level="h2">{title}</Heading>
      <div className="mt-3 space-y-2 text-body text-ink-600">{children}</div>
    </Card>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <Card tone="brand" className="px-5 py-4 text-body">
      {children}
    </Card>
  );
}
