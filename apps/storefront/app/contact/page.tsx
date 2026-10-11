import ContentPage, { Note, Section } from "../components/ContentPage";

export const metadata = {
  title: "Contact us - RFO Store",
  description: "How to reach RFO Store support for orders, warranty claims and wholesale enquiries.",
};

const HOURS = [
  { day: "Monday to Friday", hours: "9:00am - 5:00pm AEST" },
  { day: "Saturday", hours: "10:00am - 2:00pm AEST" },
  { day: "Sunday & public holidays", hours: "Closed" },
];

export default function ContactPage() {
  return (
    <ContentPage
      title="Contact us"
      intro="We are an online-only store, so email is the fastest way to reach a human. Every message is answered by our Australian support team - no offshore call centre, no ticket maze."
    >
      <Section title="Customer support">
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3">
          <p className="font-medium text-slate-900">support@rfostore.com.au</p>
          <p className="text-slate-600 mt-0.5">
            Orders, delivery, returns and warranty claims. Typical reply time is under 4 business hours, and no later than the next
            business day.
          </p>
        </div>
        <p>
          Include your order number (it is on your confirmation email and invoice) and the model name of the device. If something is
          faulty, a short description plus a photo or short video helps us approve a claim on the first reply.
        </p>
      </Section>

      <Section title="Opening hours">
        <div className="divide-y divide-slate-100">
          {HOURS.map((h) => (
            <div key={h.day} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
              <span className="text-slate-600">{h.day}</span>
              <span className="font-medium">{h.hours}</span>
            </div>
          ))}
        </div>
        <p className="text-slate-500">
          Messages that arrive outside these hours are queued and answered in order the next business morning. New Zealand customers:
          our hours are the same clock time as yours, two hours ahead of your local time.
        </p>
      </Section>

      <Section title="Returns &amp; warehouse address">
        <p>
          Placeholder address - confirm with support before sending anything, and never ship a device without a return authorisation
          email from us first:
        </p>
        <p className="font-mono text-xs bg-slate-50 ring-1 ring-slate-200 rounded-xl px-4 py-3 text-slate-700">
          RFO Store - Returns
          <br />
          Unit 4, 12 Example Street
          <br />
          Melbourne VIC 3000
          <br />
          Australia
        </p>
        <p>
          We do not have a retail counter and cannot accept walk-in drop-offs or customer pickups. Warranty returns come with a
          prepaid label; change-of-mind returns use the instructions we email you.
        </p>
      </Section>

      <Section title="Business &amp; wholesale">
        <p>
          Ordering refurbished devices in volume for a team, school or reseller? Email the same support address with the subject
          &quot;Wholesale&quot; and tell us the models, grades and quantities you are after. We can quote from current graded stock
          and hold larger lots for staged delivery.
        </p>
        <p>Wholesale orders are invoiced with a valid ABN or NZBN and shipped on a business account where one is supplied.</p>
      </Section>

      <Section title="Before you write">
        <Note>
          Many questions are already answered instantly in our <a className="underline" href="/faq">FAQ</a>, including dispatch
          times, grade meanings and what is covered by the 12-month warranty. For stock questions, the{" "}
          <a className="underline" href="/assistant">AI assistant</a> can check live availability and prices for you right away.
        </Note>
      </Section>
    </ContentPage>
  );
}
