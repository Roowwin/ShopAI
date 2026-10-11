/* The backoffice's shared value formatters.

   `aud` moved here from app/components/dashboard/StatRow.tsx, where J5 had to define it
   module-locally because lib/ was outside that job's surfaces. The ops pages need the same
   money format, and two copies of a currency formatter drift by exactly one option object - so
   there is one here and StatRow imports it. `when` joins it for the same reason: the dashboard's
   audit feed and the orders/customers/audit/assets pages all render a timestamp, and the
   date-plus-time locale options belong in one place.

   The API speaks cents; a cent value rendered raw (112618000) is the one number on these pages a
   human cannot read. Currency defaults to AUD - orders carry a currency column and the DB pins it
   to AUD today - so a caller with a different currency can pass it. */

export function aud(cents: number | null | undefined, currency = "AUD"): string {
  if (cents == null) return "-";
  return (cents / 100).toLocaleString("en-AU", { style: "currency", currency });
}

/* An ISO timestamp as the short local form. A value the runtime cannot parse is echoed back
   unchanged rather than rendered as "Invalid Date" - an audit row with an odd `at` should still
   show what the API actually sent. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}
