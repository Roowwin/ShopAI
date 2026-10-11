import ContentPage, { Note, Section } from "../components/ContentPage";

export const metadata = {
  title: "Returns & warranty - RFO Store",
  description: "Plain-language returns and 12-month warranty terms for refurbished devices bought from RFO Store.",
};

const STEPS = [
  {
    n: "1",
    title: "Email us first",
    body: "Message support@rfostore.com.au with your order number and a sentence about what went wrong. Never send a device back without a return authorisation from us - parcels that arrive unannounced cannot be matched to an order.",
  },
  {
    n: "2",
    title: "Get your label",
    body: "For faults and warranty claims we email a prepaid tracked label within one business day. For change-of-mind returns we send the return address and instructions, and return freight is yours to arrange.",
  },
  {
    n: "3",
    title: "Pack it safely",
    body: "Include the device, the accessories it arrived with and the printed condition report. Use a padded box - damage in transit on an inadequately packed return is not covered.",
  },
  {
    n: "4",
    title: "We inspect and settle",
    body: "Once it arrives we test the device, usually within two business days. You then get your choice of refund, replacement or repair, and we confirm the outcome by email.",
  },
];

export default function ReturnsPage() {
  return (
    <ContentPage
      title="Returns & warranty"
      intro="Buying refurbished should not mean reading the fine print with a magnifying glass, so here are the terms in plain language: 30 days to change your mind, 12 months of warranty cover, and prepaid freight on every fault claim."
    >
      <Section title="The two promises">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
            <p className="font-semibold text-slate-900">30-day returns</p>
            <p className="mt-1 text-slate-600">
              Change your mind for any reason within 30 days of delivery and send the device back for a refund, as long as it is in
              the condition it arrived in.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
            <p className="font-semibold text-slate-900">12-month warranty</p>
            <p className="mt-1 text-slate-600">
              Every device is covered for 12 months against hardware faults that appear in normal use. Grading does not change the
              warranty: Grade A and Grade D get the same cover.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Dead on arrival or faulty in the first 30 days">
        <p>
          If your device arrives damaged, will not power on, or develops a fault in the first 30 days, we treat it as a
          dead-on-arrival claim. That means:
        </p>
        <ul className="space-y-1.5 list-disc pl-5">
          <li>Prepaid return shipping - you pay nothing to send it back.</li>
          <li>Your choice of a full refund or a replacement unit of the same model, if we have one in stock.</li>
          <li>If no equivalent unit is available, a full refund, including any shipping you were charged.</li>
          <li>No restocking fee, no debate about grades, no requirement to accept a repair instead.</li>
        </ul>
        <p>
          Start the claim by emailing{" "}
          <a className="text-emerald-700 hover:underline" href="mailto:support@rfostore.com.au">support@rfostore.com.au</a> with your
          order number. Photos or a short video of the fault speed things up a lot.
        </p>
      </Section>

      <Section title="Change of mind within 30 days">
        <p>
          You do not need a reason. Return the device within 30 days of delivery and we refund the purchase price. To qualify, the
          device must come back:
        </p>
        <ul className="space-y-1.5 list-disc pl-5">
          <li>In the condition it was sent in, with no new cracks, scratches, liquid damage or missing parts.</li>
          <li>With the accessories and printed condition report that came in the box.</li>
          <li>Factory reset, with any account, passcode or screen lock removed. A device we cannot unlock cannot be refunded.</li>
        </ul>
        <p>
          Change-of-mind return freight is at your cost, typically $15 within Australia and $25 to New Zealand, and the original
          shipping charge is not refunded separately because shipping is free on every order. Refunds are issued to the original
          payment method, usually within 3-5 business days of inspection.
        </p>
      </Section>

      <Section title="What the 12-month warranty covers">
        <ul className="space-y-1.5 list-disc pl-5">
          <li>Hardware failure under normal use: charging faults, dead cameras, failing speakers or microphones, screen faults that were not caused by impact, battery failure, and boot or software faults caused by the hardware.</li>
          <li>Devices that stop matching their description, for example a fault the grading process could not have reasonably detected.</li>
          <li>Repair, replacement with an equivalent unit, or a refund if neither is possible - our choice first, yours if we cannot fix it within a reasonable time.</li>
          <li>Prepaid freight both ways on every accepted claim, Australia and New Zealand.</li>
        </ul>
      </Section>

      <Section title="What is not covered">
        <ul className="space-y-1.5 list-disc pl-5">
          <li>Accidental or physical damage: cracked screens, bent frames, liquid or corrosion damage, crushed ports.</li>
          <li>Damage from an unauthorised repair or from parts we did not supply.</li>
          <li>Normal battery ageing after 12 months, or battery drain caused by apps and settings rather than a hardware fault.</li>
          <li>Theft or loss after delivery.</li>
          <li>Devices with the serial label or internal serial removed, altered or made unreadable.</li>
          <li>Cosmetic wear that was accurately described by the grade you bought - see <a className="text-emerald-700 hover:underline" href="/grades">our grades</a> for what each grade allows.</li>
        </ul>
        <p>
          None of this limits your rights under the Australian Consumer Law or the New Zealand Consumer Guarantees Act. Our
          warranty sits on top of those statutory guarantees, and where the two overlap the law wins.
        </p>
      </Section>

      <Section title="How a claim works">
        <div className="space-y-4">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="h-7 w-7 shrink-0 rounded-full bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center">
                {s.n}
              </span>
              <div>
                <p className="font-medium text-slate-900">{s.title}</p>
                <p className="text-slate-600 mt-0.5">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Questions before you buy">
        <Note>
          Not sure whether something is covered? Ask us before you order - email support@rfostore.com.au or check the{" "}
          <a className="underline" href="/faq">FAQ</a>, which covers grading, battery health and delivery times. We would rather
          answer a question up front than process a return later.
        </Note>
        <p>
          Ready to shop? Browse the <a className="text-emerald-700 hover:underline" href="/">current stock</a> - every listing shows
          its grade, battery health and how many units are on the shelf.
        </p>
      </Section>
    </ContentPage>
  );
}
