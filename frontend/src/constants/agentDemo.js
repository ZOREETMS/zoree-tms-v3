// Demo presets for the AI Agent Console. The ids match the rows created by
// api/scripts/agentDemoSeed.js (see docs/AI_AGENTS_DEMO.md).
export const DEMO_IDS = {
  sourcingShipment: "SHP-DEMO-SRC1",
  traceShipment: "SHP-DEMO-TT1",
  podShipment: "SHP-DEMO-POD1",
  auditInvoice: "INV-DEMO-FA1",
};

export const DEMO_RFQ = {
  from: "Maria Lopez <maria.lopez@acmefoods.example>",
  subject: "Rate request - 2 lanes next week",
  emailText: `Hi team,

Can you quote these for pickup next Tuesday?

1) Chicago, IL 60632 to Dallas, TX 75207 - 38,000 lbs packaged foods, 53' dry van
2) Atlanta, GA to New York, NY - 41k lbs, dry van

Need rates by EOD.

Thanks,
Maria Lopez
Transportation Manager, Acme Foods`,
};

export const DEMO_CARRIER_REPLY =
  "Driver had a breakdown outside Harrisburg PA this morning, mechanic is on it. Should be rolling by 6pm. New ETA tomorrow around 10am.";

export const DEMO_POD_TEXT = `DELIVERY RECEIPT / PROOF OF DELIVERY
Swift Transportation
PRO: PRO-DEMO-77120   BOL: BOL-SHP-DEMO-POD1
Shipper: Gulf Coast Appliance DC, Houston TX
Consignee: Austin Home Supply, 4400 Industrial Blvd, Austin TX 78744
Pieces: 24 pallets shipped. Received 22 pallets.
Exception: 2 cartons crushed on pallet 14 - refused. Short 2.
Received by: J. Ramirez   Signature: [signed]   Time: 14:20`;

/** Sample POD photo served from frontend/public. */
export const DEMO_POD_IMAGE = "/demo/pod-sample.png";

/** Order email for the Email Order Agent. The sender address is what
 *  api/scripts/agentDemoSeed.js uses to find and remove the demo order. */
export const DEMO_ORDER_EMAIL = {
  from: "Acme Foods Orders <orders@acmefoods.example>",
  subject: "PO 55021 - Chicago to Dallas, pickup Tuesday",
  body: `Hi Zoree team,

Thanks for the quote. Please book this one:

PO 55021
Ship from: Acme Foods DC, 4300 S Ashland Ave, Chicago, IL 60632
Ship to: Acme Foods Southwest, 2100 Irving Blvd, Dallas, TX 75207
Ready: next Tuesday, deliver by Thursday
22 pallets packaged foods, 38,000 lbs total, 53' dry van

Lines:
- 14 pallets canned vegetables, 24,000 lbs
- 8 pallets dry pasta, 14,000 lbs

Dock hours 6am-2pm, appointment required at delivery.

Thanks,
Maria Lopez
Transportation Manager, Acme Foods`,
};
