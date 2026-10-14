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
        // primary action + links - the forest green ladder, now a token
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
      /* Motion. The two durations and the easing curve are the storefront's own tokens, mapped to
         the same CSS custom properties in globals.css, so both apps move to one rhythm.

         This app used to define `fast` alone, at a literal 150ms, because its chrome already wrote
         `duration-fast ease-out` in four places and `fast` was otherwise undefined - an undefined
         class is not an error in Tailwind, it simply emits nothing. `base` is new and had no
         existing users. The easing key is now added and `ease-out` re-pointed at the design
         system's curve: the sites that wrote it were silently animating on Tailwind's stock
         ease-out, and the whole point of naming a token is that the system owns the curve. Those
         sites are confined to the chrome (SidebarNav, Switch, ActionTiles). */
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      /* TWO GLOWS, EACH WITH ONE JOB. The Quiet Luxury pass deleted this app's `glow`, `glow-sm`,
         `glow-danger` and `glow-warning` tokens, because a bloom under every tile and every
         timeline node was the largest single source of visual noise here. The executive dashboard
         asks for two of them back, narrowly, so they are named for the JOB they do rather than for
         the surface they sit on - the next person cannot casually put `shadow-flow` on a card:

           flow    the lifecycle rail in the pipeline map. Only that one thin connecting line
                   carries it; the stage markers keep the flat state tints they had.
           urgency the amber halo on an ageing-work badge. Amber rather than red, and it animates,
                   because a lot that has sat for a fortnight is the one thing on this page that
                   should catch an eye before it is read.

         Both are drawn in LIGHT rather than as a shadow - a grey shadow is invisible against slate
         - and neither is offset. Everything else in this app stays flat: elevation is the surface
         step plus a 1px `--line`, which costs the compositor nothing. */
      boxShadow: {
        flow: "0 0 10px -1px rgb(var(--brand-500) / 0.55)",
        urgency: "0 0 0 3px rgb(var(--accent-400) / 0.14)",
      },
      fontFamily: {
        // Shape-identical to the storefront's stack, and now fed by the same two faces: the root
        // layout loads Inter and Space Grotesk through next/font/google and sets --font-sans /
        // --font-display on <html>. Previously this app loaded no webfont at all, so --font-sans
        // was simply absent and every screen fell back to the OS UI font - the largest single
        // typographic difference between the two apps. The inner fallbacks keep both declarations
        // valid if a variable is ever absent.
        sans: ["var(--font-sans, system-ui)", "sans-serif"],
        // Space Grotesk: headings and the display step only, never body copy or table data.
        display: ["var(--font-display, system-ui)", "sans-serif"],
      },
      /* The type scale - the SAME steps, in the same order, as the storefront's. This app used to
         carry only `eyebrow`, which is why its pages hand-rolled text-2xl / text-lg / text-sm for
         headings and every page header drifted a little. Each heading step now carries its own
         weight, leading and tracking, so a page writes `text-h2` and no page picks a size itself.
         The three heading steps sit at the top of their role's range: page titles 28px, section
         headings 20px, card titles 16px.

         `display` and `display-lg` are the storefront's hero steps, kept here so the two scales
         stay key-identical; nothing in this app should use them - an admin page has no hero. */
      fontSize: {
        // the uppercase kicker: table headers, stat labels. Replaces the text-[10px]/text-[11px]
        // + four different tracking-* values that had drifted across the pages.
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.1em" }],
        display: ["2rem", { lineHeight: "1.08", letterSpacing: "-0.02em", fontWeight: "600" }],
        "display-lg": ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "600" }],
        h1: ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        h2: ["1.25rem", { lineHeight: "1.35", letterSpacing: "-0.012em", fontWeight: "600" }],
        h3: ["1rem", { lineHeight: "1.4", letterSpacing: "-0.006em", fontWeight: "600" }],
        lead: ["1.0625rem", { lineHeight: "1.7" }],
        body: ["0.875rem", { lineHeight: "1.65" }],
      },
    },
  },
  plugins: [],
};
export default config;
