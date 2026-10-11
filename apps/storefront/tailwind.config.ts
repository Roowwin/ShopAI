import type { Config } from "tailwindcss";

/* Tailwind cannot inject an alpha channel into a bare `var(--x)`, so every colour that
   needs an opacity modifier (`bg-brand/10`, `ring-line/40`) is expressed as
   `rgb(var(--token) / <alpha-value>)`. The channel values live in globals.css.

   `content` must include ./lib: lib/grades.ts holds class strings, and Tailwind only
   emits classes it can see as literals in a scanned file. When it did not, grade D's
   `bg-slate-500` was missing from the built CSS entirely. */
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
        // page, card and sunken backgrounds
        surface: {
          DEFAULT: token("--surface"),
          muted: token("--surface-muted"),
          sunken: token("--surface-sunken"),
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
      fontSize: {
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.1em" }],
      },
    },
  },
  plugins: [],
};
export default config;
