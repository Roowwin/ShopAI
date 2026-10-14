"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Heading, Input } from "../components/ui";

/* THE TRACKING LOOKUP - the front door of the public tracking page.
 *
 * It asks for one thing and needs no account: the whole point of the page is that a tracking
 * reference is enough. What the RESULT page may say is deliberately narrow - see
 * apps/backend/app/api/v1/store_ops.py's `track_parcel` - because a carrier's reference is short
 * and guessable in a way an order's UUID is not, so the answer is "where is my parcel", not "what
 * did this order contain and where does it live".
 */

export default function TrackLookupPage() {
  const router = useRouter();
  const [ref, setRef] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = ref.trim();
    if (v) router.push("/track/" + encodeURIComponent(v));
  }

  return (
    <main className="max-w-md mx-auto px-4 pt-20 pb-28">
      <Heading level="h1">Track your parcel</Heading>
      <p className="text-sm text-ink-500 mt-2">
        Enter the tracking number you were given. You do not need an account.
      </p>

      <Card className="p-5 md:p-6 mt-6">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-600 mb-1" htmlFor="ref">
              Tracking number
            </label>
            <Input id="ref" value={ref} required autoComplete="off"
              onChange={(e) => setRef(e.target.value)} />
            <p className="text-xs text-ink-400 mt-1">
              Letters and numbers, as printed on the carrier&apos;s label.
            </p>
          </div>
          <Button variant="primary" type="submit" className="w-full">Track parcel</Button>
        </form>
      </Card>

      <p className="mt-6 text-xs text-ink-400">
        Looking for the items and totals on an order? Use that order&apos;s own confirmation link, or
        sign in and open it from your orders.
      </p>
    </main>
  );
}
