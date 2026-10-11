/* The four-point grading scale, in one place. The /grades page explains it in full; the product page
   needs the same words next to the live counts (what the grade means, who usually buys it), so the
   copy lives here and both pages read it - that way the two cannot drift apart.

   `battery` + `looks` are the long form the /grades page renders. `spec` and `useCase` are the two
   one-line descriptions the product page shows per grade: the condition spec, and the most common
   use case. */
export type Grade = {
  letter: string;
  label: string;
  tone: string;   // solid badge (grades page)
  pill: string;   // soft pill (product page grade rows)
  battery: string;
  looks: string[];
  spec: string;
  useCase: string;
};

export const GRADES: Grade[] = [
  {
    letter: "A",
    label: "Like new",
    tone: "bg-emerald-600",
    pill: "bg-emerald-50 text-emerald-700",
    battery: "Battery health 90% or better",
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
    tone: "bg-emerald-500",
    pill: "bg-sky-50 text-sky-700",
    battery: "Battery health 85% or better",
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
    tone: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700",
    battery: "Battery health 80% or better",
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
    tone: "bg-slate-500",
    pill: "bg-slate-100 text-slate-600",
    battery: "Battery health 80% or better",
    looks: [
      "Obvious cosmetic wear: scuffed edges, deeper scratches, small dents",
      "Possible small blemish in a screen corner, or a replaced screen or battery",
      "Any replaced part is a genuine-quality part, and it is noted on the condition report",
    ],
    spec: "Battery health 80%+, obvious wear or a replaced part noted on the report",
    useCase: "The lowest price we can offer on a fully working device - great for a spare, a first phone or a test unit.",
  },
];
