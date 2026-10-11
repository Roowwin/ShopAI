/* Join class names, dropping falsy entries. Deliberately NOT tailwind-merge: there is no
   conflict resolution, so a caller's `className` is for layout only and must never be used
   to override a variant's colour - it would append, not replace. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
