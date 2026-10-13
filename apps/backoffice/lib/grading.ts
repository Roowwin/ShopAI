/* The four-point scale, as the GRADER reads it.

   HAND-MIRRORED, like the UI kit in app/components/ui: apps/storefront/lib/grades.ts holds the
   customer-facing copy for the same scale - the shop's /grades page and its product pages read it
   there - and there is no shared package, so the two files have to be kept in step by hand. The
   judgements here are the same ones in the same order, cut down to what fits a tooltip: the word
   the grade sells under, the battery floor, and the cosmetic line a grader can hold a unit up
   against.

   These are the SHOP's criteria, not the workbench's. A grader who invents a fifth reading of
   "good" is grading a scale of one, so the guide quotes the published scale rather than restating
   it in this app's own voice - and if the shop ever moves a battery floor, the storefront file and
   this one move together.

   Nothing here is a Tailwind class, which matters because lib/** is inside tailwind.config.ts's
   `content` glob: a utility-looking word in this file would emit a real rule into the built CSS.
   Keep prose in prose. */

export type GradeLetter = "A" | "B" | "C" | "D";

export type GradeCriterion = {
  letter: GradeLetter;
  /** How the shop names the grade, in one word. */
  label: string;
  /** The battery floor that grade is allowed to sell at. */
  battery: string;
  /** The cosmetic judgement, one sentence, in the shop's own words. */
  criteria: string;
};

export const GRADE_CRITERIA: GradeCriterion[] = [
  {
    letter: "A",
    label: "Like new",
    battery: "Battery health 90% or better",
    criteria: "No visible marks at arm's length, screen free of scratches, frame clean.",
  },
  {
    letter: "B",
    label: "Excellent",
    battery: "Battery health 85% or better",
    criteria: "Light micro-scratches on the frame, screen clean, no dents or cracks.",
  },
  {
    letter: "C",
    label: "Good",
    battery: "Battery health 80% or better",
    criteria: "Visible scuffs or small dents on the frame - all of it cosmetic, fully functional.",
  },
  {
    letter: "D",
    label: "Fair",
    battery: "Battery health 80% or better",
    criteria: "Obvious wear, or a genuine-quality replacement part noted on the report.",
  },
];

/** One grade's criterion, or undefined for a value the API has not taught this app yet. */
export function criterionFor(letter: string | null | undefined): GradeCriterion | undefined {
  if (!letter) return undefined;
  return GRADE_CRITERIA.find((g) => g.letter === letter.toUpperCase());
}

/* The id a grade button points its description at.

   ONE element per grade, not one per row: the criteria belong to the GRADE, so the four sentences
   are rendered once per page and every row's button references the same four ids. Forty rows of
   the same four sentences would be forty copies of one fact, and a copy is a thing that drifts. */
export function gradeHelpId(letter: string): string {
  return `grade-help-${letter.toLowerCase()}`;
}

/** The whole criterion as one sentence - the text handed to a screen reader. No markup in here. */
export function gradeHelpText(c: GradeCriterion): string {
  return `Grade ${c.letter}, ${c.label}. ${c.battery}. ${c.criteria}`;
}
