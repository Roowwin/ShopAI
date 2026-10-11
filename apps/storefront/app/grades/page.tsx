import type { ReactNode } from "react";
import ContentPage, { Note, Section } from "../components/ContentPage";
import { Badge, Card, Heading } from "../components/ui";
import { GRADES } from "@/lib/grades";

export const metadata = {
  title: "Our grades A-D - RFO Store",
  description: "What grade A, B, C and D mean for cosmetic condition, battery health and price on refurbished devices.",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-ink-500">{label}</span>
      <span className="flex-1 text-ink-700">{children}</span>
    </div>
  );
}

export default function GradesPage() {
  return (
    <ContentPage
      title="Our grades: A to D"
      intro="Every device we sell is tested, cleaned and graded by hand on the same four-point scale. The grade describes cosmetic condition only - it never describes how well the device works, because every grade is fully functional and covered by the same 12-month warranty."
    >
      <Section title="The scale at a glance">
        <Row label="Grade A">Like new. Closest to an unboxed device, best battery health, highest price.</Row>
        <Row label="Grade B">Excellent. Light wear you have to look for. The balanced choice.</Row>
        <Row label="Grade C">Good. Clearly visible cosmetic wear, functionally identical.</Row>
        <Row label="Grade D">Fair. Heaviest wear we will sell, fully working, lowest price.</Row>
      </Section>

      {GRADES.map((g) => (
        <Card key={g.letter} className="p-5">
          <div className="flex items-center gap-3">
            <Badge shape="tile" colorClass={g.tone + " text-white"}>{g.letter}</Badge>
            <div>
              <Heading level="h2">Grade {g.letter} - {g.label}</Heading>
              <p className="text-xs text-ink-500">{g.battery}</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-700 leading-relaxed list-disc pl-5">
            {g.looks.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-600">
            <span className="font-medium text-ink-900">Best for: </span>
            {g.useCase}
          </p>
        </Card>
      ))}

      <Section title="What every grade includes">
        <p>
          Grading is the last step, not the only one. Before a device is graded it goes through the same refurbishment and test
          process regardless of which grade it will end up as:
        </p>
        <ul className="space-y-1.5 list-disc pl-5">
          <li>Full factory reset and secure data wipe, then a clean operating system installed.</li>
          <li>Every unit serialised and tracked from intake to dispatch, with the masked serial shown on the listing.</li>
          <li>Function test on screen and touch, cameras, speakers and microphones, Wi-Fi, Bluetooth and cellular, charging port, buttons, biometrics and sensors.</li>
          <li>Battery health read from the device and recorded on the condition report that ships in the box.</li>
          <li>Deep clean and sanitise, then a final cosmetic grade against the descriptions above.</li>
          <li>Network unlocked, so it works on any compatible AU or NZ carrier.</li>
        </ul>
      </Section>

      <Section title="Choosing between two grades">
        <p>
          The same model at Grade B and Grade C is the same device internally - the difference is what it looks like and what it
          costs. If the device lives in a case and a screen protector, Grade C or D usually saves money with no functional
          downside. If you plan to resell it later or want maximum battery life for years of use, pay for Grade A or B.
        </p>
        <Note>
          Grades describe cosmetics honestly and conservatively: we would rather a device arrive looking better than described than
          the other way around. If a unit does not match its grade, it is covered by the 30-day return policy and the 12-month
          warranty - see <a className="underline" href="/returns">returns &amp; warranty</a>.
        </Note>
        <p>
          Want to see what is on the shelf in a particular grade right now? Browse the{" "}
          <a className="text-brand-700 hover:underline" href="/">shop</a> or check the{" "}
          <a className="text-brand-700 hover:underline" href="/faq">FAQ</a> for how ordering works.
        </p>
      </Section>
    </ContentPage>
  );
}
