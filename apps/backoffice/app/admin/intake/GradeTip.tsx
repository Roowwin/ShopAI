import { GRADE_CRITERIA, criterionFor, gradeHelpId, gradeHelpText } from "@/lib/grading";

/* THE GRADING GUIDE: what each grade means, on the control that assigns it.

   Four buttons reading A B C D answer "which grades exist" and never "what is the difference" -
   the one question a grader is actually asking at the moment of the judgement. So each button
   carries the shop's published criterion for its own grade.

   TWO SURFACES, ONE COPY. `GradeHelp` renders the four criteria once per page as text only a
   screen reader reaches; the visible tooltip is the same copy again for the eye. Neither is
   written out per row - see gradeHelpId in lib/grading.ts for why the description is keyed to the
   grade rather than to the unit.

   WHY THE PANEL IS POSITIONED AGAINST THE WINDOW and not absolutely inside the cell: the workbench
   table is a scrolling region, and a box that scrolls trims anything its descendants paint past
   its own edge. A tooltip parented to a button in the last column would simply be cut off there.
   The layer below therefore sits outside that box, with the coordinates measured from the button
   at the moment it opens.

   The panel takes no pointer events of its own, on purpose: it is a caption, not a surface, and a
   caption that can swallow a click on the buttons underneath it is a caption that breaks the
   grading pass it was written for. */

/** Width of the panel, in pixels. The opener clamps the panel's centre against it. */
export const GRADE_TIP_WIDTH = 256;
/** Roughly how tall the panel is. Used to decide whether it opens above or below its button. */
export const GRADE_TIP_HEIGHT = 96;

/** The criteria as text for assistive tech. Rendered once; every grade button points at it. */
export function GradeHelp() {
  return (
    <div className="sr-only">
      {GRADE_CRITERIA.map((g) => (
        <p key={g.letter} id={gradeHelpId(g.letter)}>{gradeHelpText(g)}</p>
      ))}
    </div>
  );
}

type Props = {
  grade: string;
  /** Viewport coordinates of the panel's centre, already clamped to the window. */
  x: number;
  y: number;
  /** True to draw the panel above its button, false to draw it below. */
  above: boolean;
};

export function GradeTip({ grade, x, y, above }: Props) {
  const c = criterionFor(grade);
  if (!c) return null;
  return (
    <div
      role="tooltip"
      style={{
        left: x,
        top: y,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
        width: GRADE_TIP_WIDTH,
      }}
      className="pointer-events-none fixed z-50 rounded-card bg-surface p-3 text-left ring-1 ring-brand-500/60"
    >
      <p className="text-xs font-semibold text-brand-300">Grade {c.letter} &middot; {c.label}</p>
      <p className="mt-1 text-xs text-ink-500">{c.battery}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-700">{c.criteria}</p>
    </div>
  );
}
