import type { Config } from "tailwindcss";

/* Tailwind cannot inject an alpha channel into a bare `var(--x)`, so every colour that
   needs an opacity modifier (`bg-brand/10`, `ring-line/40`) is expressed as
   `rgb(var(--token) / <alpha-value>)`. The channel values live in globals.css.

   `content` must include ./lib: lib/grades.ts holds class strings, and Tailwind only
   emits classes it can see as literals in a scanned file. When it did not, Grade D's
   badge background was missing from the built CSS entirely. */
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
        // the single secondary CTA (hero, checkout, deal badge)
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
          DEFAULT: token("--ink-900"),
        },
        // destructive actions (cart remove, checkout errors)
        danger: {
          50: token("--danger-50"),
          200: token("--danger-200"),
          600: token("--danger-600"),
        },
        // page, card and sunken backgrounds; `pressed` is the active/press fill of a control
        surface: {
          DEFAULT: token("--surface"),
          muted: token("--surface-muted"),
          sunken: token("--surface-sunken"),
          pressed: token("--surface-pressed"),
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
      },
      borderRadius: {
        card: "1rem", // content panels
        control: "0.75rem", // tiles, buttons, inputs
      },
      fontFamily: {
        // --font-sans is set by next/font on <html>. The inner fallback keeps the stack valid
        // if the variable is ever absent, instead of making the declaration invalid.
        sans: ["var(--font-sans, system-ui)", "sans-serif"],
      },
      /* The type scale. Each heading step carries its own weight, leading and tracking, so a
         page writes `text-h2` and never hand-rolls `text-lg font-semibold`. Display is the one
         deliberately large step (hero, product price) and gets the tightest tracking of the set;
         tracking loosens as the size drops, which is what keeps a big line from looking airy and
         a small one from looking cramped. `lead` is the reading size for page intros, `body` the
         size inside cards and long copy.

         Colour rhythm, applied by the primitives: headings inherit (so the hero's h1 stays white
         on the dark band, and an h2 sitting on a card is ink-900 from the body), body copy is
         ink-600, meta is ink-500, the eyebrow kicker is ink-400. */
      fontSize: {
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.1em" }],
        display: ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "600" }],
        h1: ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.02em", fontWeight: "600" }],
        h2: ["1.125rem", { lineHeight: "1.35", letterSpacing: "-0.012em", fontWeight: "600" }],
        h3: ["0.875rem", { lineHeight: "1.4", letterSpacing: "-0.006em", fontWeight: "600" }],
        lead: ["1.0625rem", { lineHeight: "1.7" }],
        body: ["0.875rem", { lineHeight: "1.65" }],
      },
      /* Motion tokens live in globals.css as CSS custom properties (see the comment there).
         `ease-out` is intentionally re-pointed at --ease-out: the design system owns the curve,
         and no component in either app used Tailwind's stock `ease-out` before this. */
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
    },
  },
  plugins: [],
};
export default config;
