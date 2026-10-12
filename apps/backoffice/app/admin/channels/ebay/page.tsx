import ChannelDashboard from "../ChannelDashboard";
import { CHANNELS } from "../channels";

/* /admin/channels/ebay - the eBay hub.

   One of three routes the Omnichannel category names, and one of three drawn from ONE channel
   list: the page's own words come from CHANNELS.ebay and its body from the shared dashboard, so a
   change to what a hub says about itself is one edit rather than three copies that agree until
   somebody fixes one of them.

   It hands over the channel's ID and never the descriptor: a prop is serialised into what
   ships, and the descriptor carries the sample figures.

   There is no eBay integration behind this route - see ChannelDashboard for what the page says
   about that and why it says it first. */
export default function EbayHubPage() {
  return <ChannelDashboard channelId={CHANNELS.ebay.id} />;
}
