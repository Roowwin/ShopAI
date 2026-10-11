/* ink-600, not ink-500: this text sits on the body's surface-sunken, where ink-500 is 4.34:1
   and fails WCAG AA for 14px text. ink-600 is 6.92:1 there. */
export default function Loading() {
  return <div className="p-6 text-sm text-ink-600">Loading...</div>;
}
