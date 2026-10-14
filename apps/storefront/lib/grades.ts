/* The four-point grading scale, in one place. The /grades page explains it in full; the product page
   needs the same words next to the live counts (what the grade means, who usually buys it), so the
   copy lives here and both pages read it - that way the two cannot drift apart.

   `battery` + `looks` are the long form the /grades page renders. `spec` and `useCase` are the two
   one-line descriptions the product page shows per grade: the condition spec, and the most common
   use case.

   `tone` and `pill` are design-token classes (see tailwind.config.ts `colors.grade`), not raw palette
   values. They used to be raw Tailwind classes, which had a live consequence: this file lives in ./lib
   and Tailwind's `content` glob did not include it, so the classes were never emitted - Grade D's
   badge background was missing from the built CSS entirely. `content` now covers ./lib; keep these as
   plain literals so the scanner can still see them.

   A is the brand hue (forest green). B is deliberately sky, not the brand hue: with both A and B
   green the two badges were indistinguishable at a glance. */
export type Grade = {
  letter: string;
  label: string;
  tone: string;   // solid badge (grades page)
  pill: string;   // soft pill (product page grade rows)
  ink: string;    // the grade's own text step, for an indicator that is not the pill
  battery: string;
  /* The floor `battery` states, as a number, so a page can draw it rather than only print it.
     It is the GUARANTEED MINIMUM, not a measurement - a Grade A unit may well be at 97% - which is
     why every meter drawn from it sits beside the sentence that says "or better". D and C share a
     floor because the published scale gives them the same one. */
  batteryPct: number;
  looks: string[];
  spec: string;
  useCase: string;
};

export const GRADES: Grade[] = [
  {
    letter: "A",
    label: "Like new",
    tone: "bg-grade-a-solid",
    pill: "bg-grade-a-solid/15 text-grade-a-ink ring-1 ring-grade-a-solid/30",
    ink: "text-grade-a-ink",
    battery: "Battery health 90% or better",
    batteryPct: 90,
    looks: [
      "No visible marks when you hold it at arm's length",
      "Screen free of scratches, chips and shadowing",
      "Frame and back clean, at most faint marks under direct light",
    ],
    spec: "Battery health 90%+, screen and frame unmarked",
    useCase: "Buyers who want the newest-feeling device and the longest battery life.",
  },
  {
    letter: "B",
    label: "Excellent",
    tone: "bg-grade-b-solid",
    pill: "bg-grade-b-solid/15 text-grade-b-ink ring-1 ring-grade-b-solid/30",
    ink: "text-grade-b-ink",
    battery: "Battery health 85% or better",
    batteryPct: 85,
    looks: [
      "Light micro-scratches on the frame or back cover",
      "Screen clean and unmarked when the display is on",
      "No dents, no cracks, no bent chassis",
    ],
    spec: "Battery health 85%+, light micro-scratches on the frame only",
    useCase: "Most customers. Nearly new in the hand, a clear step down in price from Grade A.",
  },
  {
    letter: "C",
    label: "Good",
    tone: "bg-grade-c-solid",
    pill: "bg-grade-c-solid/15 text-grade-c-ink ring-1 ring-grade-c-solid/30",
    ink: "text-grade-c-ink",
    battery: "Battery health 80% or better",
    batteryPct: 80,
    looks: [
      "Visible scuffs, scratches or small dents on the frame",
      "Screen may show faint marks that are not visible while it is on",
      "All wear is cosmetic - the device is fully functional",
    ],
    spec: "Battery health 80%+, visible scuffs or small dents on the frame",
    useCase: "Value hunters who will use a case anyway and would rather save the difference.",
  },
  {
    letter: "D",
    label: "Fair",
    tone: "bg-grade-d-solid",
    pill: "bg-grade-d-solid/15 text-grade-d-ink ring-1 ring-grade-d-solid/30",
    ink: "text-grade-d-ink",
    battery: "Battery health 80% or better",
    batteryPct: 80,
    looks: [
      "Obvious cosmetic wear: scuffed edges, deeper scratches, small dents",
      "Possible small blemish in a screen corner, or a replaced screen or battery",
      "Any replaced part is a genuine-quality part, and it is noted on the condition report",
    ],
    spec: "Battery health 80%+, obvious wear or a replaced part noted on the report",
    useCase: "The lowest price we can offer on a fully working device - great for a spare, a first phone or a test unit.",
  },
];

/** Look up a grade by its letter. The one way to turn a grade string from the API into its copy and colours. */
export function gradeFor(letter: string): Grade | undefined {
  return GRADES.find((g) => g.letter === letter);
}
