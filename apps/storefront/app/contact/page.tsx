import ContentPage, { Note, Section } from "../components/ContentPage";
import { linkClass } from "../components/ui";

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
        <div className="rounded-control bg-surface-sunken ring-1 ring-line px-4 py-3">
          <p className="font-medium text-ink-900">support@rfostore.com.au</p>
          <p className="text-ink-600 mt-0.5">
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
        <div className="divide-y divide-line">
          {HOURS.map((h) => (
            <div key={h.day} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
              <span className="text-ink-600">{h.day}</span>
              <span className="font-medium">{h.hours}</span>
            </div>
          ))}
        </div>
        <p className="text-ink-500">
          Messages that arrive outside these hours are queued and answered in order the next business morning. New Zealand customers:
          our hours are the same clock time as yours, two hours ahead of your local time.
        </p>
      </Section>

      <Section title="Returns &amp; warehouse">
        {/* THE ADDRESS IS GONE, and deliberately not replaced with an invented one. It used to read
            "Unit 4, 12 Example Street, Melbourne VIC 3000" under the warning "Placeholder address -
            confirm with support before sending anything", which is a fake address printed on a
            customer-facing page next to an instruction to trust it less. A shop with no public
            counter does not need to publish a street address at all: what the customer needs is the
            authorisation and the label, which is what this section now says and nothing more. If
            there is a real returns address to publish, it belongs here and nowhere else. */}
        <p>
          We do not have a retail counter, and we cannot accept walk-in drop-offs or customer pickups.
          Never ship a device without a return authorisation email from us first - it carries the
          return address for that specific return.
        </p>
        <p>
          Warranty returns come with a prepaid label. Change-of-mind returns use the instructions we
          email you when you raise the return.
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
          Many questions are already answered instantly in our <a className={linkClass} href="/faq">FAQ</a>, including dispatch
          times, grade meanings and what is covered by the 12-month warranty. For anything about a specific
          device, send us the model or the order number and we will check the shelf and answer by email.
        </Note>
      </Section>
    </ContentPage>
  );
}
