import type { Config } from "tailwindcss";

/* Tailwind cannot inject an alpha channel into a bare `var(--x)`, so every colour that
   needs an opacity modifier (`bg-brand/10`, `ring-line/40`) is expressed as
   `rgb(var(--token) / <alpha-value>)`. The channel values live in globals.css.

   `content` must include ./lib: lib/ui.ts holds the status/grade class strings, and Tailwind
   only emits classes it can see as literals in a scanned file. When the storefront did not
   include its lib dir, Grade D's badge background was missing from the built CSS entirely.
   Keep this glob and ./lib/ui.ts in step - a token present in source but absent from the built
   CSS means the glob missed a file. */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // primary action + links - the de-facto emerald, now a token
        brand: {
          50: token("--brand-50"),
          100: token("--brand-100"),
          200: token("--brand-200"),
          300: token("--brand-300"),
          500: token("--brand-500"),
          600: token("--brand-600"),
          700: token("--brand-700"),
          800: token("--brand-800"),
          900: token("--brand-900"),
          950: token("--brand-950"),
          DEFAULT: token("--brand-600"),
        },
        // the soft secondary accent (amber). On the light ground the 50/100 fills were pale washes
        // and 700 was the ink on them; here the fills are deep and 700 is a light amber. The old
        // note here said the scale was kept identical to the storefront's - that no longer holds:
        // the two apps now have deliberately different grounds, and this token set is the
        // backoffice's own.
        accent: {
          50: token("--accent-50"),
          100: token("--accent-100"),
          300: token("--accent-300"),
          400: token("--accent-400"),
          500: token("--accent-500"),
          700: token("--accent-700"),
          DEFAULT: token("--accent-400"),
        },
        // text
        ink: {
          300: token("--ink-300"),
          400: token("--ink-400"),
          500: token("--ink-500"),
          600: token("--ink-600"),
          700: token("--ink-700"),
          900: token("--ink-900"),
          // the dark ink for text on a bright fill - see globals.css
          inverse: token("--ink-inverse"),
          DEFAULT: token("--ink-900"),
        },
        // destructive actions and error text
        danger: {
          50: token("--danger-50"),
          200: token("--danger-200"),
          600: token("--danger-600"),
        },
        // page, card and sunken backgrounds. `glass` is the translucent panel the chrome and the
        // overlays sit on - pair it with backdrop-blur-md, which is stock Tailwind.
        surface: {
          DEFAULT: token("--surface"),
          muted: token("--surface-muted"),
          sunken: token("--surface-sunken"),
          glass: token("--surface-glass"),
        },
        // hairlines
        line: {
          DEFAULT: token("--line"),
          strong: token("--line-strong"),
        },
        // the A-D scale, deliberately separate from `brand` so a grade never reads as
        // the primary action. Grade B is sky, not emerald: A is the brand hue, and two
        // emerald grades are indistinguishable at a glance.
        grade: {
          a: { solid: token("--grade-a-solid"), soft: token("--grade-a-soft"), ink: token("--grade-a-ink") },
          b: { solid: token("--grade-b-solid"), soft: token("--grade-b-soft"), ink: token("--grade-b-ink") },
          c: { solid: token("--grade-c-solid"), soft: token("--grade-c-soft"), ink: token("--grade-c-ink") },
          d: { solid: token("--grade-d-solid"), soft: token("--grade-d-soft"), ink: token("--grade-d-ink") },
        },
        // ADMIN-ONLY: the asset lifecycle, which the storefront never shows. One group per
        // state with the same solid/soft/ink shape as `grade`, so a chip (soft+ink) and a
        // status dot (solid) draw from one place instead of a per-page palette - the
        // assistant page used to hardcode emerald/blue/sky/violet/amber/teal per action.
        status: {
          received: { solid: token("--status-received-solid"), soft: token("--status-received-soft"), ink: token("--status-received-ink") },
          tested: { solid: token("--status-tested-solid"), soft: token("--status-tested-soft"), ink: token("--status-tested-ink") },
          in_repair: { solid: token("--status-in-repair-solid"), soft: token("--status-in-repair-soft"), ink: token("--status-in-repair-ink") },
          graded: { solid: token("--status-graded-solid"), soft: token("--status-graded-soft"), ink: token("--status-graded-ink") },
          listed: { solid: token("--status-listed-solid"), soft: token("--status-listed-soft"), ink: token("--status-listed-ink") },
          reserved: { solid: token("--status-reserved-solid"), soft: token("--status-reserved-soft"), ink: token("--status-reserved-ink") },
          sold: { solid: token("--status-sold-solid"), soft: token("--status-sold-soft"), ink: token("--status-sold-ink") },
          shipped: { solid: token("--status-shipped-solid"), soft: token("--status-shipped-soft"), ink: token("--status-shipped-ink") },
          returned: { solid: token("--status-returned-solid"), soft: token("--status-returned-soft"), ink: token("--status-returned-ink") },
          scrapped: { solid: token("--status-scrapped-solid"), soft: token("--status-scrapped-soft"), ink: token("--status-scrapped-ink") },
        },
      },
      borderRadius: {
        card: "1rem", // content panels
        control: "0.75rem", // tiles, buttons, inputs
      },
      /* The glow: an emerald hairline with a soft bloom behind it, which is what replaces the
         light-mode `shadow-sm` on a dark ground - a grey shadow is invisible against slate, so the
         boundary has to be drawn in light rather than cast in darkness. Two layers on purpose: the
         1px ring is the border the brief asks for, the blur is the "glowing" part. */
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--brand-700) / 0.45), 0 8px 32px -12px rgb(var(--brand-500) / 0.35)",
        "glow-sm": "0 0 0 1px rgb(var(--brand-700) / 0.35), 0 4px 18px -10px rgb(var(--brand-500) / 0.30)",
      },
      fontFamily: {
        // Shape-identical to the storefront's stack. The backoffice loads no webfont, so
        // --font-sans is simply absent and the inner fallback wins; a future font load then
        // needs no config change. The inner fallback keeps the declaration valid either way.
        sans: ["var(--font-sans, system-ui)", "sans-serif"],
      },
      fontSize: {
        // the uppercase kicker: table headers, stat labels. Replaces the text-[10px]/text-[11px]
        // + four different tracking-* values that had drifted across the pages.
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.1em" }],
      },
    },
  },
  plugins: [],
};
export default config;
