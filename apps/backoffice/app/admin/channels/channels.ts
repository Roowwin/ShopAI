/* The three marketplace hubs this job adds, and the one place their sample figures live.

   THE FACT THIS FILE EXISTS TO KEEP HONEST. There is no marketplace integration in this build:
   nothing under apps/backend/app names eBay, Amazon, Facebook, a marketplace or a channel at all.
   There are no credentials, no channel on a product or a unit, and no sync job. Every figure the
   brief's dashboard shape asks for would therefore be invented, and the shape of a "connected"
   page would be a picture of something that does not exist.

   So the invented figures live in exactly one place - `sample`, below - and are drawn in exactly
   one region: the preview panel that says, in words, that it is sample data. A reader who never
   presses the preview control never sees a number this file holds. That is the whole design: the
   preview is what makes the page demonstrable, and its label is what keeps it honest.

   Nothing real is stored here, because nothing real is a constant. The storefront's own listing
   count is read from GET /store/catalog when a page loads - the one destination this build can
   actually reach - and the three "not connected" states are the absence of a thing rather than a
   value. */

export type ChannelId = "ebay" | "amazon" | "facebook";

export type Channel = {
  id: ChannelId;
  /** the brand as it is written inside a sentence */
  label: string;
  /** the page's own title */
  heading: string;
  /** what a hub for this channel would be for, and that none of it is wired here */
  blurb: string;
  /** what a real connection would need, named one by one: the gaps ARE this page's content */
  needs: string[];
  /** SAMPLE. Invented figures, drawn only inside the labelled preview panel. */
  sample: {
    tiles: { label: string; value: string }[];
    rows: { name: string; state: string }[];
  };
};

export const CHANNELS: Record<ChannelId, Channel> = {
  ebay: {
    id: "ebay",
    label: "eBay",
    heading: "eBay Hub",
    blurb: "Publish stock to eBay and read back what sold. None of it is wired in this build - "
      + "the panel below says exactly what is missing.",
    needs: [
      "eBay credentials and an application token - this build holds neither.",
      "A channel on a product, so a listing could belong to eBay - there is none.",
      "A push and a sync job, with a schedule - neither exists.",
    ],
    sample: {
      tiles: [
        { label: "Items live", value: "142" },
        { label: "Sold (7 days)", value: "9" },
        { label: "Watchers", value: "317" },
        { label: "Last sync", value: "2 mins ago" },
      ],
      rows: [
        { name: "eBay", state: "Live" },
        { name: "Amazon", state: "Draft" },
        { name: "FB Marketplace", state: "Not listed" },
      ],
    },
  },
  amazon: {
    id: "amazon",
    label: "Amazon",
    heading: "Amazon Hub",
    blurb: "Publish stock to Amazon and read back what sold. None of it is wired in this build - "
      + "the panel below says exactly what is missing.",
    needs: [
      "Amazon (SP-API) credentials - this build holds none.",
      "A channel on a product, so a listing could belong to Amazon - there is none.",
      "A push and a sync job, with a schedule - neither exists.",
    ],
    sample: {
      tiles: [
        { label: "Items live", value: "118" },
        { label: "Orders (7 days)", value: "6" },
        { label: "Sessions (7 days)", value: "1240" },
        { label: "Last sync", value: "14 mins ago" },
      ],
      rows: [
        { name: "Amazon", state: "Live" },
        { name: "eBay", state: "Draft" },
        { name: "FB Marketplace", state: "Not listed" },
      ],
    },
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    heading: "FB Marketplace",
    blurb: "Publish stock to Facebook Marketplace and read back what sold. None of it is wired in "
      + "this build - the panel below says exactly what is missing.",
    needs: [
      "A Facebook (Meta) business token - this build holds none.",
      "A channel on a product, so a listing could belong to Facebook - there is none.",
      "A push and a sync job, with a schedule - neither exists.",
    ],
    sample: {
      tiles: [
        { label: "Items live", value: "76" },
        { label: "Enquiries (7 days)", value: "4" },
        { label: "Reach (7 days)", value: "2890" },
        { label: "Last sync", value: "1 hour ago" },
      ],
      rows: [
        { name: "FB Marketplace", state: "Live" },
        { name: "eBay", state: "Draft" },
        { name: "Amazon", state: "Not listed" },
      ],
    },
  },
};
