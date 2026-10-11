import type { ReactNode } from "react";
import ContentPage, { Note, Section } from "../components/ContentPage";
import { linkClass } from "../components/ui";

export const metadata = {
  title: "FAQ - RFO Store",
  description: "How ordering, shipping, grading and warranty work on certified refurbished devices at RFO Store.",
};

function QA({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="border-b border-line pb-2 last:border-0 last:pb-0">
      <p className="font-medium text-ink-900">{q}</p>
      <div className="mt-1 space-y-1 text-ink-600">{children}</div>
    </div>
  );
}

export default function FaqPage() {
  return (
    <ContentPage
      title="Frequently asked questions"
      intro="Short answers about buying, delivery, condition grades and warranty. If your question is not here, our support team replies to every email within one business day."
    >
      <Section title="Ordering & payment">
        <QA q="How does the shop work?">
          <p>
            Every listing is a single refurbished unit, not a bulk product. Stock counts show how many graded units of that model
            we have on the shelf right now, and each unit has its own condition grade and price.
          </p>
          <p>Adding a unit to your cart holds it while you finish checkout, so you can order with confidence that it is still available.</p>
        </QA>
        <QA q="Do I need an account?">
          <p>
            No. Checkout is guest-only: name, delivery address and country are all we need. Your order number and receipt arrive by
            email straight after payment.
          </p>
        </QA>
        <QA q="Which payment methods do you accept?">
          <p>
            All major credit and debit cards through our secure checkout. Payment is captured in Australian dollars and processed by
            our payment provider, so we never see or store your card number.
          </p>
        </QA>
        <QA q="Can I get a GST invoice?">
          <p>
            Yes. Every order comes with a GST-compliant tax invoice: 10% for Australian deliveries and 15% for New Zealand
            deliveries. Prices shown on the site are in AUD and include GST.
          </p>
        </QA>
        <QA q="Can I collect in person or see a unit before buying?">
          <p>
            We are an online-only warehouse, so there is no shopfront pickup. If you would like extra photos of a specific unit
            before you buy, email us the model name and we will send them through.
          </p>
        </QA>
      </Section>

      <Section title="Shipping & delivery">
        <QA q="Where do you deliver?">
          <p>Australia and New Zealand only. We cannot ship to freight forwarders that then on-ship outside AU and NZ.</p>
        </QA>
        <QA q="How much is shipping?">
          <p>
            Free tracked shipping on every order, no minimum. Multiple units in one order travel together in the same parcel at no
            extra cost.
          </p>
        </QA>
        <QA q="How long does delivery take?">
          <p>
            Orders placed before 2pm on a business day are dispatched the same day, otherwise the next business day. From dispatch,
            allow 2-5 business days for Australian metro addresses, up to 8 business days for regional Australia, and 5-10 business
            days for New Zealand.
          </p>
        </QA>
        <QA q="Do I need to sign for the parcel?">
          <p>
            Yes, deliveries are signature-on-receipt so your device is not left unattended. You will get a tracking link by email as
            soon as the parcel is scanned by the courier.
          </p>
        </QA>
      </Section>

      <Section title="Condition & grading">
        <QA q="What does the grade letter mean?">
          <p>
            Every unit is graded A, B, C or D on cosmetic condition, and every grade is fully tested and fully functional. Grade A is
            the closest to new; Grade D is the most budget-friendly with visible wear. See{" "}
            <a className={linkClass} href="/grades">our grades explained</a> for cosmetic details and battery
            health per grade.
          </p>
        </QA>
        <QA q="Are the photos of the actual unit?">
          <p>
            Product photos show the model and are representative of the grade. Small marks vary between individual units, which is
            why we describe each grade in detail and offer returns if a device does not match its description.
          </p>
        </QA>
        <QA q="What is in the box?">
          <p>
            The device, a compatible charging cable, and a printed condition report with the unit serial. Original retail boxes and
            chargers are not included unless the listing says so - that is part of how refurbished stock keeps costs and e-waste down.
          </p>
        </QA>
        <QA q="Is the serial number real?">
          <p>
            Yes. Every unit is serialised and tracked through intake, testing and grading. On the site we mask the middle of the
            serial in photos and listings; the full serial is on your invoice and condition report.
          </p>
        </QA>
        <QA q="Is my data safe if I bought a device that was previously used?">
          <p>
            Every device is factory reset and securely wiped as part of refurbishment before it is graded, then a clean operating
            system is installed. No previous owner data reaches you.
          </p>
        </QA>
      </Section>

      <Section title="Warranty & returns">
        <QA q="What warranty do I get?">
          <p>
            A 12-month RFO warranty on every device, covering hardware faults that come up in normal use. If something fails we
            repair it, replace it with an equivalent unit, or refund you. Full terms are on the{" "}
            <a className={linkClass} href="/returns">returns and warranty page</a>.
          </p>
        </QA>
        <QA q="What if I change my mind?">
          <p>
            You have 30 days from delivery to return a device for a refund, as long as it comes back in the condition it was sent in
            with the accessories and condition report.
          </p>
        </QA>
        <QA q="What if the device arrives faulty?">
          <p>
            Contact us within 30 days and we email a prepaid return label. Once it is back with us you can choose a full refund or a
            replacement unit of the same model if we have one in stock.
          </p>
        </QA>
        <QA q="How do I make a claim?">
          <p>
            Email{" "}
            <a className={linkClass} href="mailto:support@rfostore.com.au">support@rfostore.com.au</a> with
            your order number and what is happening. We reply within one business day with the next step, and we cover return
            freight on all warranty claims.
          </p>
        </QA>
      </Section>

      <Section title="Still stuck?">
        <Note>
          Our support team answers email Monday to Friday, 9am-5pm AEST, and Saturday 10am-2pm. Send order questions, warranty
          claims or photo requests to support@rfostore.com.au, or use{" "}
          <a className={linkClass} href="/contact">contact us</a> for hours and response times.
        </Note>
        <p>
          Looking for a device instead? Browse the <a className={linkClass} href="/">shop</a> or ask the{" "}
          <a className={linkClass} href="/assistant">AI assistant</a> what we have in stock right now.
        </p>
      </Section>
    </ContentPage>
  );
}
