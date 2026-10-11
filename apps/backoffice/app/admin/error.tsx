"use client";

import { Button, Card, Heading } from "@/app/components/ui";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="max-w-2xl mx-auto p-6">
      <Card className="p-6">
        <Heading level="h2" as="h1">This page could not load</Heading>
        <p className="text-sm text-ink-600 mt-1">{error.message || "Unexpected error."}</p>
        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </Card>
    </main>
  );
}
