// BaseDesk deterministic demo seed generator.
// Run: node shared/generate-seed.mjs  -> writes shared/seed.json (byte-identical on every run)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SEED = 20260711;
// Fixed base timestamp — never Date.now(), so output is reproducible.
const NOW = new Date('2026-07-11T12:00:00Z');
const NOW_MS = NOW.getTime();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const ri = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}
const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString();
const pad = (n, w) => String(n).padStart(w, '0');
const singleSpace = (s) => s.replace(/\s+/g, ' ').trim();
const preview = (s) => singleSpace(s).slice(0, 90);

// ---------------------------------------------------------------- agents
const agents = [
  { id: 'a_1', name: 'Sam Reed', email: 'sam@basedesk.test', role: 'admin' },
  { id: 'a_2', name: 'Priya Nair', email: 'priya@basedesk.test', role: 'agent' },
  { id: 'a_3', name: 'Jonas Weber', email: 'jonas@basedesk.test', role: 'agent' },
  { id: 'a_4', name: 'Mel Ortiz', email: 'mel@basedesk.test', role: 'agent' },
].map((a) => ({ id: a.id, name: a.name, email: a.email, avatarHue: hashHue(a.email), role: a.role, status: 'active', inviteToken: null, signature: '' }));

// ---------------------------------------------------------------- contacts
const contactSeed = [
  ['Maya Chen', 'maya.chen@kitelabs.io', 'Kite Labs', 'San Francisco, US', 'America/Los_Angeles'],
  ['Tom Aldridge', 'tom.aldridge@northwindoutfitters.com', 'Northwind Outfitters', 'Portland, US', 'America/Los_Angeles'],
  ['Sofia Marino', 'sofia@fernandco.com', 'Fern & Co.', 'Milan, Italy', 'Europe/Rome'],
  ['Derek Boone', 'derek.boone@gmail.com', null, 'Austin, US', 'America/Chicago'],
  ['Amara Okafor', 'amara@halcyongoods.com', 'Halcyon Goods', 'London, UK', 'Europe/London'],
  ['Lukas Novak', 'lukas.novak@brightline.dev', 'Brightline Software', 'Prague, Czechia', 'Europe/Prague'],
  ['Hannah Kim', 'hannah@papercrane.studio', 'Paper Crane Studio', 'Seoul, South Korea', 'Asia/Seoul'],
  ['Ravi Patel', 'ravi.patel@monsoontrading.in', 'Monsoon Trading', 'Mumbai, India', 'Asia/Kolkata'],
  ['Elena Vasquez', 'elenavasquez88@outlook.com', null, 'Madrid, Spain', 'Europe/Madrid'],
  ['Chris Dunn', 'chris@oakline.co', 'Oakline Furniture', 'Denver, US', 'America/Denver'],
  ['Freja Lindqvist', 'freja@polarpost.se', 'Polar Post', 'Stockholm, Sweden', 'Europe/Stockholm'],
  ['Marcus Bell', 'marcus@bellandsons.com', 'Bell & Sons Hardware', 'Manchester, UK', 'Europe/London'],
  ['Yuki Tanaka', 'yuki.tanaka@sablesystems.jp', 'Sable Systems', 'Tokyo, Japan', 'Asia/Tokyo'],
  ['Priscilla Nwosu', 'priscilla.nwosu@yahoo.com', null, 'Lagos, Nigeria', 'Africa/Lagos'],
  ['Owen Gallagher', 'owen@harboranalytics.com', 'Harbor Analytics', 'Boston, US', 'America/New_York'],
  ['Ingrid Bauer', 'ingrid@alpenglow.travel', 'Alpenglow Travel', 'Munich, Germany', 'Europe/Berlin'],
  ['Diego Fuentes', 'diego@cardinalcoffee.mx', 'Cardinal Coffee', 'Mexico City, Mexico', 'America/Mexico_City'],
  ['Alice Berg', 'alice.berg@proton.me', null, 'Oslo, Norway', 'Europe/Oslo'],
];
const MRR_TIERS = [49900, 99900, 149900, 249900, 499900, 999900, 1999900];
const contacts = contactSeed.map(([name, email, company, location, timezone], i) => ({
  id: 'c_' + pad(i + 1, 2),
  name, email, company,
  avatarHue: hashHue(email),
  location, timezone,
  createdAt: iso(NOW_MS - ri(35, 500) * DAY - ri(0, 23) * HOUR),
  mrr: company === null ? null : pick(MRR_TIERS),
}));
const personalContactIds = contacts.filter((c) => c.company === null).map((c) => c.id);

// ---------------------------------------------------------------- canned replies
const canned = [
  { id: 'cr_1', title: 'Refund policy', body: 'Thanks for reaching out. Refunds are available within 30 days of purchase for unused items and within 14 days for opened ones. Once we receive the return scan from the carrier, the refund is issued automatically and lands on your card within 3-5 business days.', actions: { addTags: ['refund'] } },
  { id: 'cr_2', title: 'Shipping delay', body: 'Sorry about the wait on your order. Carrier tracking sometimes lags a day or two behind the actual movement of the package. I have asked the carrier for a trace and will update you here as soon as they respond.', actions: { status: 'pending', addTags: ['shipping'] } },
  { id: 'cr_3', title: 'Password reset', body: 'You can reset your password from the sign-in page via "Forgot password" — the email arrives within a minute or two. If it does not show up, check the spam folder and make sure the address matches the one on the account. Reply here if you are still locked out and I will reset it manually after an identity check.', actions: null },
  { id: 'cr_4', title: 'API rate limits', body: 'The API allows 600 requests per minute per token, measured over a sliding window. Responses include X-RateLimit-Remaining so your client can back off before hitting a 429. For bulk work, batching into chunks of 50 with a short pause between them stays comfortably under the limit.', actions: null },
  { id: 'cr_5', title: 'Plan comparison', body: 'Team is $12 per seat and covers shared inboxes, views and reporting. Business is $18 per seat and adds SSO, audit logs and priority support. Upgrades are prorated to the day, so you only pay the difference for the remainder of the current cycle.', actions: null },
  { id: 'cr_6', title: 'Closing thanks', body: 'Glad that is sorted. I will close this ticket now, but replying to this email reopens it at any time — no need to start over. Thanks for your patience.', actions: { status: 'solved', addTags: ['resolved'] } },
];

// ---------------------------------------------------------------- scenarios
// Each archetype carries subject variants and body pools per conversation role.
// Placeholders: {first} contact first name, {agent} agent first name, {order} order number.
const S = {
  order_status: {
    tags: ['shipping'], prio: ['medium', 'low'], weight: 3,
    subjects: ['Where is order {order}?', 'Order {order} tracking has not moved', 'Delivery window passed for order {order}'],
    opener: [
      'Hi, I placed order {order} last week and the tracking page still shows "label created". Could you check where it actually is?',
      'My order {order} was supposed to arrive by Tuesday and the tracking has not updated in four days. Can you find out what is happening?',
      'Quick one — the estimated delivery for order {order} came and went yesterday. Is it lost or just slow?',
    ],
    agent: [
      'Hi {first}, thanks for flagging this. I have asked the carrier for a trace on order {order} and should hear back within a day. I will update you here as soon as I know more.',
      'Hi {first}, I checked with the warehouse and order {order} left the dock yesterday, so the tracking page is lagging behind. You should see movement within 24 hours.',
    ],
    followup: [
      'Thanks {agent}. The tracking finally updated this morning, so it looks like it is moving again.',
      'Any news on this? I am away from Thursday, so timing is getting tight.',
    ],
    resolution: [
      'Good news — the carrier confirmed delivery of order {order} this morning. Sorry it took the scenic route. Let me know if anything is missing from the box.',
      'The package was delivered today according to the carrier scan. Sorry about the slow tracking updates, and thanks for bearing with us.',
    ],
    thanks: ['It arrived, all good. Thanks for chasing it.', 'Got it today. Appreciate the help.'],
    notes: ['Opened a trace with the carrier. Their ops team usually answers within 24 hours.'],
  },
  refund_request: {
    tags: ['refund', 'billing'], prio: ['medium', 'high'], weight: 3,
    subjects: ['Refund for order {order}', 'Double charged on order {order}', 'Requesting a refund on my last order'],
    opener: [
      'Hi, I was charged twice for order {order} — once on the 3rd and again on the 5th, same amount. Can you refund the duplicate charge?',
      'I would like a refund for order {order}. The size runs small and the return portal says my window is still open.',
      'Order {order} never shipped and I have since bought the item locally. Please cancel it and refund my card.',
    ],
    agent: [
      'Hi {first}, sorry about that. I can see the duplicate on our side and have started the refund — it should land back on your card within 3-5 business days.',
      'Hi {first}, no problem. I have approved the return for order {order}; once the carrier scans the package the refund goes out automatically.',
    ],
    followup: [
      'Thanks. I will keep an eye on my statement and confirm when it shows up.',
      'The refund has not appeared yet. Should I be worried, or is this normal timing?',
    ],
    resolution: [
      'The refund for order {order} is processed on our side and confirmed by the payment provider. It can take one more banking day to display, but it is done.',
      'Refund issued in full for order {order}, reference on its way by email. Sorry again for the back and forth.',
    ],
    thanks: ['The money is back on my card. Thanks for sorting it quickly.', 'Refund received. All good on my end.'],
    notes: ['Checked Stripe — charge already refunded, waiting on webhook to update the order record.', 'Return approved under the 30-day policy. Refund will auto-issue on the carrier scan.'],
  },
  broken_checkout: {
    tags: ['bug'], prio: ['urgent', 'high', 'medium'], weight: 2,
    subjects: ['Checkout button does nothing', 'Cannot complete purchase — payment step errors', 'Checkout broken on Safari'],
    opener: [
      'Every time I hit Pay on the checkout page it spins for a second and then nothing happens. I have tried two different cards and both fail the same way.',
      'Your checkout throws "something went wrong" at the payment step. I am on Safari 18 on a Mac and have already cleared cookies.',
    ],
    agent: [
      'Hi {first}, sorry — that is not you, we can reproduce it. Engineering is on it now; in the meantime the order can be completed from the cart page using the express option.',
      'Hi {first}, thanks for the browser details, that narrowed it down quickly. A fix is rolling out within the hour.',
    ],
    followup: [
      'The express option worked, thanks. You might want to put a banner up though — I nearly gave up.',
      'Still failing for me as of this morning. Same spinner, same silence.',
    ],
    resolution: [
      'The payment step is fixed and deployed — a stale script was blocking the confirm call in Safari. Your cart is untouched if you would like to finish the order.',
      'This is resolved as of an hour ago and we have added a monitor so it cannot regress quietly. Thanks for the patience.',
    ],
    thanks: ['Confirmed working now. Order went through.', 'Works again on my side. Thanks for the quick fix.'],
    notes: ['Reproduced on Safari 18. Frontend deploy 2214 reverted, incident channel opened.'],
  },
  api_429: {
    tags: ['api'], prio: ['urgent', 'high', 'medium'], weight: 2,
    subjects: ['Getting 429s on the /v1/tickets endpoint', 'Rate limited far below documented quota', 'Sudden spike in 429 responses since this morning'],
    opener: [
      'Since around 09:00 UTC our integration gets HTTP 429 on roughly a third of calls to /v1/tickets, even though we are well under the documented 600 requests per minute. Nothing changed on our side.',
      'We are seeing 429 responses with Retry-After: 60 on bulk exports. Our plan should allow this volume — can you check whether a limiter changed?',
    ],
    agent: [
      'Hi {first}, you are right — a limits rollout yesterday put your account on the wrong tier. I have corrected it and you should see normal throughput within a few minutes.',
      'Hi {first}, I pulled your request logs and the limiter is triggering on burst rather than sustained rate. Spacing the batch into 50-call chunks will clear it while we review the tier config.',
    ],
    followup: [
      'Confirmed, error rate is back to zero on our dashboard. Thanks for the quick turnaround.',
      'Chunking helps, but we would still like the documented quota honored — this blocks our nightly sync.',
    ],
    resolution: [
      'The tier config is fixed and we added a regression check so this rollout mistake cannot repeat. Your last hour of traffic shows zero 429s.',
      'Limits are restored to your plan quota and verified against your live traffic. The postmortem lands in our changelog this week.',
    ],
    thanks: ['All green on our side now. Appreciated.', 'Nightly sync completed clean. Thanks.'],
    notes: ['Account fell into the default limiter bucket after the rollout. Bumped to tier-3 manually, flagged to the platform team.'],
  },
  login_2fa: {
    tags: ['account'], prio: ['high', 'medium'], weight: 2,
    subjects: ['Locked out after phone change — 2FA codes go nowhere', 'Cannot log in, authenticator lost', 'Account locked after too many attempts'],
    opener: [
      'I got a new phone and did not move my authenticator app over, so I cannot produce a 2FA code and my backup codes are on the old device. How do I get back into my account?',
      'My account locked itself after a few failed logins this morning. I am sure of the password — could it be the VPN we route through?',
    ],
    agent: [
      'Hi {first}, I can reset 2FA after an identity check. Could you reply from the billing email on the account and include the last four digits of the card on file?',
      'Hi {first}, I have cleared the lockout. The failed attempts came from two different IPs, which fits the VPN theory — signing in without it should work now.',
    ],
    followup: [
      'Just sent the verification details from the billing address.',
      'That worked, I am back in. I will add fresh backup codes right away.',
    ],
    resolution: [
      'Identity confirmed, and I have reset 2FA on the account. You will be prompted to enroll a new device at next sign-in — please also download fresh backup codes.',
      'You are unlocked and the old authenticator is revoked. Everything on the account looks untouched, but do review the sessions page just in case.',
    ],
    thanks: ['Back in and re-enrolled. Thanks for the careful handling.', 'All sorted, thanks. Backup codes saved somewhere sensible this time.'],
    notes: ['Identity verified against billing email plus card last four. 2FA reset performed, audit log entry added.'],
  },
  plan_upgrade: {
    tags: ['billing'], prio: ['low', 'medium'], weight: 2,
    subjects: ['Difference between Team and Business plans?', 'Upgrading mid-cycle — how is it billed?', 'Do we need Business for SSO?'],
    opener: [
      'We are at 9 seats on Team and about to add contractors. Does Business change the per-seat price, and is SSO included or an add-on?',
      'If we upgrade in the middle of a billing cycle, is the difference prorated or do we pay the full month twice?',
    ],
    agent: [
      'Hi {first}, Business is $18 per seat and includes SSO, audit logs and priority support; Team stays $12 without those. Upgrades are prorated to the day, so you only pay the difference for the rest of the cycle.',
      'Hi {first}, good timing — proration is automatic, and the invoice shows the credit line by line so finance can trace it.',
    ],
    followup: [
      'Prorated works for us. If we upgrade today, do the SSO settings appear immediately?',
      'Thanks, that is clear. Last thing — can we mix monthly and annual seats?',
    ],
    resolution: [
      'Yes — features unlock the moment the upgrade completes. I have also noted a 14-day grace period on the account so you can roll back without losing the proration.',
      'All answered above, and I have sent a one-page comparison to your billing email for the finance folder.',
    ],
    thanks: ['Upgraded this morning and SSO is configured. Thanks for laying it out clearly.', 'That covers everything we needed. Thanks.'],
    notes: ['Expansion likely: 9 seats now, contractors joining. Added to the CS follow-up sheet.'],
  },
  feature_request: {
    tags: ['feature-request'], prio: ['low', 'medium'], weight: 2,
    subjects: ['Feature request: scheduled report exports', 'Any plans for dark mode in the customer portal?', 'Request: webhook on ticket reopen'],
    opener: [
      'It would save us a weekly chore if reports could export themselves to CSV on a schedule — every Monday to an email or an S3 bucket, for example. Is anything like that planned?',
      'Our workflow needs a webhook when a ticket reopens, not just on create and close. Today we poll the API every minute, which feels wasteful for everyone.',
    ],
    agent: [
      'Hi {first}, thanks — that is a well-argued case and you are not the first to ask. I have added your vote and the S3 detail to the tracking issue; product reviews these monthly.',
      'Hi {first}, noted and logged. No promises on timing, but requests with a concrete workflow attached tend to move faster.',
    ],
    followup: [
      'Good to hear. Any rough idea of timeline, even just a quarter?',
      'Understood. Please keep this thread posted if it lands on a roadmap.',
    ],
    resolution: [
      'Scheduled exports made the roadmap for next quarter — I cannot promise the exact shape yet. The reopen webhook actually shipped in yesterday’s release; docs are live.',
      'This is now tracked publicly on our roadmap page under Reporting. I will nudge this thread when it ships.',
    ],
    thanks: ['Saw the release notes. That covers our main pain point.', 'Great, we will watch the roadmap. Thanks for the straight answer.'],
    notes: ['Second request this month for scheduled exports. Linked both tickets in the product tracker.'],
  },
  damaged_shipment: {
    tags: ['shipping'], prio: ['high', 'medium'], weight: 2,
    subjects: ['Order {order} arrived damaged', 'Box crushed, two items broken in order {order}', 'Damaged on arrival — replacement or refund?'],
    opener: [
      'Order {order} arrived today with the box crushed on one side. The ceramic pieces inside are cracked — photos attached. What are my options?',
      'The courier left order {order} out in the rain and the packaging soaked through. Two of the four items are unusable.',
    ],
    agent: [
      'Hi {first}, sorry — that should never have made it past the carrier in that state. I have filed a damage claim on our side; we can ship replacements today or refund the damaged items, whichever you prefer.',
      'Hi {first}, apologies for the state of that delivery. Photos received and that is plenty for the claim — no forms needed on your side.',
    ],
    followup: [
      'Replacements please, if the timing is similar. No rush on the claim paperwork.',
      'I would rather take the refund for the two damaged ones and keep the rest.',
    ],
    resolution: [
      'Replacements for order {order} shipped this afternoon with extra padding; tracking is on its way to your email. The damage claim covers the cost, nothing owed on your side.',
      'Refund for the damaged items is issued and the claim is closed. The rest of the order is yours as delivered.',
    ],
    thanks: ['Replacements arrived intact. Appreciate you making it painless.', 'Refund received, and the surviving items are lovely. Thanks.'],
    notes: ['Damage claim DC-4471 filed with the carrier. Photos saved to the order record.'],
  },
  invoice_vat: {
    tags: ['billing'], prio: ['medium', 'low'], weight: 2,
    subjects: ['Invoice missing our VAT number', 'Need invoices addressed to the parent company', 'VAT charged despite valid EU VAT ID'],
    opener: [
      'Our accountant flagged that the June invoice does not show our VAT number, which we entered during checkout. Could you reissue it with the VAT ID and registered address?',
      'We were charged VAT on the last invoice even though our EU VAT ID is on file and validated. Can this be corrected and credited?',
    ],
    agent: [
      'Hi {first}, apologies — the VAT ID was saved but never linked to the billing profile. I have fixed the linkage and reissued June with the ID and correct address; it is in your billing history now.',
      'Hi {first}, you are right and I can see why. The validation ran after the invoice was cut. I am issuing a credit note for the VAT amount today.',
    ],
    followup: [
      'The reissued invoice looks right. Will July onward pick this up automatically?',
      'Credit note received. Please make sure the next cycle does not repeat this.',
    ],
    resolution: [
      'Yes — future invoices inherit the corrected profile automatically, and the wrongly charged VAT is credited against your next bill.',
      'Fixed going forward, verified against a preview of the July invoice. Your accountant should see clean paperwork from here on.',
    ],
    thanks: ['Accountant is satisfied, which is the highest bar there is. Thanks.', 'All reconciled on our side now. Thank you.'],
    notes: ['VIES check passed. Credit note CN-2093 issued for the VAT amount.'],
  },
  cancellation: {
    tags: ['account', 'billing'], prio: ['medium', 'low'], weight: 2,
    subjects: ['Please cancel our subscription', 'Downgrading to free at end of term', 'Cancel account — project ended'],
    opener: [
      'The project this account supported has wrapped up, so please cancel the subscription at the end of the current period. We would like an export of our data first.',
      'We are consolidating tools and will not renew. What happens to our ticket history after cancellation?',
    ],
    agent: [
      'Hi {first}, done — the subscription ends on the renewal date with no further charges. Your data stays exportable for 90 days after that, and I have queued a full export to your email today.',
      'Hi {first}, understood, and sorry to see you go. Cancellation is scheduled; nothing is deleted for 90 days, so there is a comfortable window to grab everything.',
    ],
    followup: [
      'Export received and verified. Sad to go — the product was not the problem.',
      'Thanks. If the next project needs a helpdesk, we know where to find you.',
    ],
    resolution: [
      'Cancellation is confirmed for the period end and the export is in your inbox. Your workspace can be revived within 90 days if plans change.',
      'All set — final invoice is settled and the account winds down on the renewal date. Thanks for being straightforward about it.',
    ],
    thanks: ['All wrapped up cleanly. Thanks for not making it a maze.', 'Appreciate the smooth exit. Take care.'],
    notes: ['Exit reason: project ended, not product dissatisfaction. No save offer per policy.'],
  },
  integration_bug: {
    tags: ['api', 'bug'], prio: ['high', 'medium'], weight: 2,
    subjects: ['SDK throws TypeError since 2.4.1', 'Webhook handler crashes on null customer field', 'Integration breaks on tickets without assignee'],
    opener: [
      'Since updating your Node SDK to 2.4.1 our worker crashes whenever a ticket has no assignee. Trace:\nTypeError: Cannot read properties of null (reading \'id\')\n    at normalizeTicket (basedesk-sdk/dist/normalize.js:88:31)\n    at Array.map (<anonymous>)\n    at Client.listTickets (basedesk-sdk/dist/client.js:214:19)\nRolling back to 2.4.0 fixes it, so it looks like a regression.',
      'Our webhook consumer started failing overnight on payloads where customer is null. Stack:\n    at parsePayload (hooks/basedesk.js:41:17)\n    at handler (hooks/index.js:19:9)\nDid the payload contract change in the last release?',
    ],
    agent: [
      'Hi {first}, that is a regression in 2.4.1 — normalizeTicket assumes assignee is always an object. A patched 2.4.2 is in review; 2.4.0 is safe to stay on meanwhile.',
      'Hi {first}, the contract did not change, but a null guard was dropped in the last release. Fix is queued and your trace made it a five-minute diagnosis.',
    ],
    followup: [
      'Staying on 2.4.0 for now. Ping this thread when 2.4.2 is out and we will verify against staging.',
      'Thanks. We added a temporary null check on our side so the worker stays up.',
    ],
    resolution: [
      'Version 2.4.2 is published with the null-assignee fix and a test covering it. Thanks for the clean trace — it went straight into the regression suite.',
      'The patched release is live and we verified it against a payload sample matching yours. You can drop the workaround.',
    ],
    thanks: ['Upgraded and the worker has been stable for 24 hours. Closing from our side.', 'Confirmed fixed on staging and production. Nice turnaround.'],
    notes: ['Regression introduced in SDK PR 312. Fix merged, release tagged 2.4.2.'],
  },
  onboarding_help: {
    tags: ['onboarding'], prio: ['low', 'medium'], weight: 2,
    subjects: ['Best way to import our old tickets?', 'Setting up views for a three-person team', 'Getting started — mail forwarding question'],
    opener: [
      'We are moving over from a shared Gmail inbox. Is there a recommended way to bring old conversations in, or do we start fresh and keep Gmail around as an archive?',
      'Just set up the workspace for our team of three. How do you suggest splitting views so we do not trip over each other’s tickets?',
    ],
    agent: [
      'Hi {first}, most small teams start fresh and keep the old inbox read-only — importers are on the roadmap, but honestly the clean cut is underrated. For a team of three, one shared triage view plus per-agent views covers most of it.',
      'Hi {first}, welcome aboard. Forward the shared address to your inbox address here and replies will thread correctly from day one.',
    ],
    followup: [
      'Clean cut it is. One more thing — can two people get notified on the same urgent ticket?',
      'Forwarding is set up and the first tickets are flowing in. This is already calmer than Gmail.',
    ],
    resolution: [
      'Set up as discussed, and yes — watchers cover the double-notification case. The first week’s questions are usually the last, so shout if anything feels off.',
      'Sounds like you are fully up and running. I will close this, but reply any time and it reopens.',
    ],
    thanks: ['We are up and running. The team picked it up in an afternoon.', 'All good here. Thanks for the pointers.'],
    notes: ['New team onboarding, three seats. Added to the week-two check-in list.'],
  },
  spam: {
    tags: [], prio: ['low', 'medium'], weight: 0,
    subjects: ['Partnership opportunity for your store', 'Boost your domain authority today', 'Final notice: your business listing', 'Exclusive wholesale catalog inside'],
    opener: [
      'Hello, we help brands like yours reach ten times more customers through our influencer network. Our team has prepared a custom proposal — reply now to claim your onboarding discount before Friday.',
      'Your website is missing out on high-quality backlinks from DA 70+ domains. We offer guaranteed first-page rankings with a monthly package tailored to your niche.',
      'This is the final notice regarding your unclaimed business listing. Confirm your details within 48 hours to avoid removal from the directory.',
    ],
    agent: [], followup: [], resolution: [], thanks: [], notes: [],
  },
};

const genericNotes = [
  'Waiting on the customer to confirm before closing this out.',
  'Second ticket from this account in two weeks — keeping an eye on the pattern.',
  'Escalated internally, will circle back once ops responds.',
];
const snoozeNotes = [
  'Snoozing until the customer is back from leave — they asked us to check in next week.',
  'Snoozed while we wait on the third-party claim. Will follow up when it lands.',
  'Parking this until the fix ships. Reopen when the release notes go out.',
];
const trashNotes = [
  'Duplicate of an earlier ticket from the same contact. Trashing this copy.',
  'Customer sent this by mistake and asked us to disregard it.',
];

// ---------------------------------------------------------------- ticket slots
// Target view counts (per the plan's view semantics, evaluated at NOW):
//   open 22, pending 14, on_hold 5, solved 41, closed 24  (inbox, not snoozed)
//   snoozed 5 (future snoozedUntil), archive 6, spam 4, trash 3  -> 124 total
// Note: the plan's status list (22/14/5/48/24) sums to 113, which cannot coexist with
// 124 total + 13 bucketed + 5 snoozed tickets; solved is reduced 48 -> 41 to reconcile.
const slots = [];
const addSlots = (n, s) => { for (let i = 0; i < n; i++) slots.push({ ...s }); };
addSlots(22, { bucket: 'inbox', snooze: false, status: 'open' });
addSlots(14, { bucket: 'inbox', snooze: false, status: 'pending' });
addSlots(5, { bucket: 'inbox', snooze: false, status: 'on_hold' });
addSlots(41, { bucket: 'inbox', snooze: false, status: 'solved' });
addSlots(24, { bucket: 'inbox', snooze: false, status: 'closed' });
addSlots(3, { bucket: 'inbox', snooze: true, status: 'open' });
addSlots(2, { bucket: 'inbox', snooze: true, status: 'pending' });
addSlots(4, { bucket: 'archive', snooze: false, status: 'solved' });
addSlots(2, { bucket: 'archive', snooze: false, status: 'closed' });
addSlots(4, { bucket: 'spam', snooze: false, status: 'closed' });
addSlots(3, { bucket: 'trash', snooze: false, status: 'closed' });
let ticketSlots = shuffle(slots);

// createdAt (hours before NOW), shaped so open skews recent and archive skews old
function createdHoursAgo(slot) {
  if (slot.bucket === 'spam' || slot.bucket === 'trash') return ri(24, 26 * 24);
  if (slot.bucket === 'archive') return ri(18 * 24, 29 * 24);
  if (slot.snooze) return ri(2 * 24, 12 * 24);
  switch (slot.status) {
    case 'open': return ri(4, 9 * 24);
    case 'pending': return ri(8, 12 * 24);
    case 'on_hold': return ri(2 * 24, 18 * 24);
    case 'solved': return ri(2 * 24, 28 * 24);
    default: return ri(6 * 24, 29 * 24); // closed
  }
}
ticketSlots = ticketSlots.map((slot) => ({
  ...slot,
  createdMs: NOW_MS - createdHoursAgo(slot) * HOUR - ri(0, 59) * MIN - ri(0, 59) * 1000,
}));
ticketSlots.sort((a, b) => a.createdMs - b.createdMs); // oldest first -> lowest numbers

// assignee plans per group (exact guarantees: unassigned view = 12, mine(a_1) view = 7)
const cycle = (ids, n) => Array.from({ length: n }, (_, i) => ids[i % ids.length]);
const plans = {
  open: shuffle([...Array(10).fill(null), 'a_1', 'a_1', 'a_1', 'a_1', ...cycle(['a_2', 'a_3', 'a_4'], 8)]),
  pending: shuffle([null, null, 'a_1', 'a_1', ...cycle(['a_2', 'a_3', 'a_4'], 10)]),
  on_hold: shuffle(['a_1', 'a_2', 'a_3', 'a_4', 'a_2']),
  solved: shuffle(cycle(['a_1', 'a_2', 'a_3', 'a_4'], 41)),
  closed: shuffle(cycle(['a_1', 'a_2', 'a_3', 'a_4'], 24)),
  snoozed: shuffle(['a_1', 'a_1', 'a_2', 'a_3', 'a_4']),
  archive: shuffle(cycle(['a_1', 'a_2', 'a_3', 'a_4'], 6)),
  spam: [null, null, null, null],
  trash: shuffle([null, 'a_2', null]),
};
const planIdx = Object.fromEntries(Object.keys(plans).map((k) => [k, 0]));
const groupOf = (s) => (s.bucket !== 'inbox' ? s.bucket : s.snooze ? 'snoozed' : s.status);

// weighted scenario pool (spam bucket gets the spam archetype)
const scenarioPool = Object.entries(S).flatMap(([k, s]) => Array(s.weight).fill(k));
// exact priority distribution across all 124 tickets
const prioPool = shuffle([
  ...Array(10).fill('urgent'), ...Array(28).fill('high'),
  ...Array(56).fill('medium'), ...Array(30).fill('low'),
]);
// Pick RANDOMLY among the scenario's still-available preferences (not
// first-available) so urgent/high/low stay interleaved across the timeline
// instead of draining in generation order.
function takePriority(prefs) {
  const avail = prefs.filter((p) => prioPool.includes(p));
  if (avail.length > 0) {
    const p = avail[Math.floor(rnd() * avail.length)];
    return prioPool.splice(prioPool.indexOf(p), 1)[0];
  }
  return prioPool.shift();
}

const solvedPatterns = [
  ['o', 'r'], ['o', 'a', 'r'], ['o', 'a', 'f', 'r'],
  ['o', 'a', 'f', 'r', 't'], ['o', 'a', 'r', 't'], ['o', 'n', 'a', 'f', 'r', 't'],
];
function patternFor(slot) {
  if (slot.bucket === 'spam') return ['o'];
  if (slot.bucket === 'trash') return pick([['o'], ['o', 'n']]);
  if (slot.snooze) return pick([['o', 'z'], ['o', 'a', 'z'], ['o', 'a', 'f', 'z']]);
  if (slot.bucket === 'archive') return pick(solvedPatterns);
  switch (slot.status) {
    case 'open': return pick([['o'], ['o'], ['o', 'n'], ['o', 'a', 'f'], ['o', 'a', 'f', 'n']]);
    case 'pending': return pick([['o', 'a'], ['o', 'a'], ['o', 'n', 'a'], ['o', 'a', 'f', 'a'], ['o', 'a', 'n']]);
    case 'on_hold': return pick([['o', 'a', 'n'], ['o', 'n'], ['o', 'a', 'f', 'n']]);
    default: return pick(solvedPatterns); // solved | closed
  }
}
function threadTimes(createdMs, k) {
  if (k === 1) return [createdMs];
  const avail = NOW_MS - 30 * MIN - createdMs;
  const ideal = (k - 1) * (2 * HOUR + rnd() * 18 * HOUR);
  const span = Math.min(avail, Math.max((k - 1) * 8 * MIN, Math.min(avail * 0.85, ideal)));
  const gaps = Array.from({ length: k - 1 }, () => 0.25 + rnd());
  const total = gaps.reduce((a, b) => a + b, 0);
  const times = [createdMs];
  let acc = 0;
  for (const g of gaps) { acc += g; times.push(createdMs + span * (acc / total)); }
  return times;
}
function mkVariantPicker() {
  const used = new Map();
  return (key, pool) => {
    if (!used.has(key)) used.set(key, Math.floor(rnd() * pool.length));
    const i = used.get(key);
    used.set(key, i + 1);
    return pool[i % pool.length];
  };
}
const fill = (t, c) => t.replaceAll('{first}', c.first).replaceAll('{agent}', c.agent).replaceAll('{order}', c.order);

// ---------------------------------------------------------------- build tickets + messages
const contactQueue = shuffle(contacts.map((c) => c.id)); // guarantees every contact appears
const tickets = [];
const rawMessages = [];

ticketSlots.forEach((slot, index) => {
  const id = 't_' + pad(index + 1, 3);
  const scnKey = slot.bucket === 'spam' ? 'spam' : pick(scenarioPool);
  const scn = S[scnKey];
  const requesterId = slot.bucket === 'spam'
    ? pick(personalContactIds)
    : (contactQueue.length ? contactQueue.shift() : pick(contacts).id);
  const contact = contacts.find((c) => c.id === requesterId);
  const group = groupOf(slot);
  const assigneeId = plans[group][planIdx[group]++];
  const mainAgentId = assigneeId ?? pick(agents).id;
  const mainAgent = agents.find((a) => a.id === mainAgentId);
  const ctx = {
    first: contact.name.split(' ')[0],
    agent: mainAgent.name.split(' ')[0],
    order: String(ri(30000, 49999)),
  };
  const priority = takePriority(scn.prio);
  const tags = [];
  if (scn.tags[0] && rnd() < 0.85) tags.push(scn.tags[0]);
  if (scn.tags[1] && rnd() < 0.35) tags.push(scn.tags[1]);
  if (priority === 'urgent' && rnd() < 0.5) tags.push('urgent-escalation');
  const channel = scnKey === 'api_429' || scnKey === 'integration_bug'
    ? pick(['api', 'api', 'email', 'web'])
    : scnKey === 'spam' ? 'email'
      : pick(['email', 'email', 'email', 'email', 'email', 'email', 'web', 'web', 'chat', 'chat']);

  const pattern = patternFor(slot);
  const times = threadTimes(slot.createdMs, pattern.length);
  const pickVariant = mkVariantPicker();
  const msgs = pattern.map((step, i) => {
    let authorKind = 'agent', kind = 'reply', body = '';
    if (step === 'o') { authorKind = 'contact'; body = pickVariant('opener', scn.opener); }
    else if (step === 'f') { authorKind = 'contact'; body = pickVariant('followup', scn.followup); }
    else if (step === 't') { authorKind = 'contact'; body = pickVariant('thanks', scn.thanks); }
    else if (step === 'a') { body = pickVariant('agent', scn.agent); }
    else if (step === 'r') { body = pickVariant('resolution', scn.resolution); }
    else if (step === 'n') {
      kind = 'note';
      body = slot.bucket === 'trash' ? pick(trashNotes)
        : scn.notes.length && rnd() < 0.7 ? pickVariant('notes', scn.notes) : pick(genericNotes);
    } else { kind = 'note'; body = pick(snoozeNotes); } // 'z' snooze note
    let authorId = requesterId;
    if (authorKind === 'agent') {
      authorId = kind === 'note' && rnd() < 0.25 ? pick(agents.filter((a) => a.id !== mainAgent.id)).id : mainAgent.id;
    }
    return { ticketId: id, authorKind, authorId, kind, body: fill(body, ctx), at: iso(times[i]) };
  });
  rawMessages.push(...msgs);

  const lastReply = [...msgs].reverse().find((m) => m.kind === 'reply');
  const lastAt = msgs[msgs.length - 1].at;
  const firstAgentReply = msgs.find((m) => m.authorKind === 'agent' && m.kind === 'reply');
  const resolved = slot.status === 'solved' || slot.status === 'closed';
  tickets.push({
    id,
    number: 1024 + index,
    subject: fill(pickVariant('subject', scn.subjects), ctx),
    status: slot.status,
    priority,
    bucket: slot.bucket,
    requesterId,
    assigneeId,
    tags,
    channel,
    createdAt: msgs[0].at,
    updatedAt: lastAt,
    snoozedUntil: slot.snooze ? iso(NOW_MS + ri(20, 720) * HOUR + ri(0, 59) * MIN) : null,
    lastMessageAt: lastAt,
    lastMessagePreview: preview(lastReply.body),
    firstRespondedAt: firstAgentReply ? firstAgentReply.at : null,
    resolvedAt: resolved ? lastAt : null,
  });
});

// global message ids, ascending by time
rawMessages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ticketId < b.ticketId ? -1 : 1));
const messages = rawMessages.map((m, i) => ({ id: 'm_' + pad(i + 1, 5), ...m }));

// ---------------------------------------------------------------- deals
// 35 deals: ~46% expansion, ~31% inbound, ~23% retention; 46% won / 40% open / 14% lost.
// At least 6 won deals close within the last 7 days so the money pill and revenue
// charts are non-empty against the fixed NOW.
const companyContacts = contacts.filter((c) => c.company !== null);
const dealTypePool = shuffle([
  ...Array(16).fill('expansion'), ...Array(11).fill('inbound'), ...Array(8).fill('retention'),
]);
const dealStagePool = shuffle([
  ...Array(16).fill('won'), ...Array(14).fill('open'), ...Array(5).fill('lost'),
]);
const dealValues = [50000, 90000, 120000, 250000, 480000, 750000, 1200000, 2400000];
const ticketsByContact = {};
for (const t of tickets) (ticketsByContact[t.requesterId] ||= []).push(t);

const deals = [];
let wonWithin7 = 0;
for (let i = 0; i < 35; i++) {
  const type = dealTypePool[i];
  const stage = dealStagePool[i];
  const contact = pick(companyContacts);
  const value = pick(dealValues);
  const ownerId = agents[i % agents.length].id;
  let createdMs;
  let closedMs = null;
  if (stage === 'won' && wonWithin7 < 6) {
    closedMs = NOW_MS - ri(0, 6) * DAY - ri(1, 23) * HOUR;
    createdMs = closedMs - ri(2, 25) * DAY - ri(0, 23) * HOUR;
    wonWithin7 += 1;
  } else if (stage === 'won' || stage === 'lost') {
    createdMs = NOW_MS - ri(8, 45) * DAY - ri(0, 23) * HOUR;
    closedMs = createdMs + ri(1, 10) * DAY + ri(0, 23) * HOUR;
    if (closedMs > NOW_MS - HOUR) closedMs = NOW_MS - ri(8, 40) * HOUR;
  } else {
    createdMs = NOW_MS - ri(1, 30) * DAY - ri(0, 23) * HOUR;
  }
  const updatedMs = closedMs ?? createdMs;
  const cTickets = ticketsByContact[contact.id] || [];
  const ticketId = cTickets.length && rnd() < 0.6 ? pick(cTickets).id : null;
  const title =
    type === 'expansion' ? `Upgrade to Business — ${ri(2, 25)} seats`
    : type === 'retention' ? `Retention: ${contact.company} renewal`
    : `New: ${contact.company} team plan`;
  const note =
    type === 'expansion' ? 'Wants SSO and more seats; positive on the call.'
    : type === 'retention' ? 'Renewal at risk; weighing options.'
    : 'Inbound from the pricing page; evaluating plans.';
  deals.push({
    id: 'd_' + pad(i + 1, 3),
    title, type, stage, value, currency: 'USD',
    contactId: contact.id, ticketId, ownerId, note,
    createdAt: iso(createdMs),
    closedAt: closedMs !== null ? iso(closedMs) : null,
    updatedAt: iso(updatedMs),
  });
}
deals.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

// ---------------------------------------------------------------- knowledge base
const kbSeed = [
  ['Getting started', 'Set up your first inbox view',
    'Views are saved filters over your tickets. Start with the built-in All, Unassigned, and My open views, then add your own by combining a status, a priority, and an assignee. Most small teams run one shared triage view plus a personal view per agent so nobody trips over each other.'],
  ['Getting started', 'Keyboard shortcuts cheat sheet',
    'BaseDesk is keyboard-first. In the inbox, use j and k to move between tickets, Enter to open, e to solve, u to assign to yourself, and 1 to 4 to set priority. Inside a ticket, r focuses the reply box and n starts an internal note. Press ? anywhere to see the full list, or Ctrl/Cmd K to open the command palette.'],
  ['Billing', 'How refunds are processed',
    'Refunds are available within 30 days of purchase for unused items and within 14 days for opened ones. Once the return scan comes back from the carrier, the refund is issued automatically and lands on the original card within 3 to 5 business days. Duplicate charges are refunded as soon as we can see both on our side.'],
  ['Billing', 'Update your VAT or tax ID',
    'Add or correct a VAT or tax ID from the billing profile before an invoice is generated. If an invoice was already cut without the ID, we can reissue it with the correct details and, where VAT was charged in error, raise a credit note for the difference. Reissued invoices appear in your billing history.'],
  ['API', 'Handling rate limits (429s)',
    'The API allows 600 requests per minute per token, measured over a sliding window. Every response includes an X-RateLimit-Remaining header so your client can back off before hitting a 429. For bulk work, batch into chunks of about 50 requests with a short pause between them to stay comfortably under the limit.'],
  ['Account', 'Reset two-factor authentication',
    'If you have lost your authenticator and your backup codes, reply from the billing email on the account and include the last four digits of the card on file. After an identity check we reset 2FA and add an entry to the audit log. Set up fresh backup codes right after you are back in so this does not recur.'],
].map(([category, title, body], i) => ({
  id: 'kb_' + pad(i + 1, 2),
  title,
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  category,
  body,
  status: 'published',
  createdAt: iso(NOW_MS - (60 - i * 5) * DAY),
  updatedAt: iso(NOW_MS - (20 - i * 2) * DAY),
}));

// ---------------------------------------------------------------- ai agents
const aiAgents = [
  { id: 'ai_1', name: 'Reply Assistant', avatarHue: 210, enabled: true, autonomy: 'draft', scopeTags: [], scopePriorities: [], createdAt: iso(NOW_MS - 40 * DAY) },
  { id: 'ai_2', name: 'Deflection Bot', avatarHue: 285, enabled: true, autonomy: 'resolve', scopeTags: [], scopePriorities: [], createdAt: iso(NOW_MS - 30 * DAY) },
];
const contactById = new Map(contacts.map((c) => [c.id, c]));
const draftTickets = tickets.filter((t) => t.bucket === 'inbox' && (t.status === 'open' || t.status === 'pending')).slice(0, 6);
const resolvedTickets = tickets.filter((t) => t.bucket === 'inbox' && t.status === 'solved').slice(0, 5);
const aiActions = [];
let aiN = 0;
for (const t of draftTickets) {
  const c = contactById.get(t.requesterId);
  const first = c ? c.name.split(' ')[0] : 'there';
  const topic = t.subject.toLowerCase().replace(/[.?!]+$/, '');
  const draftBody = `Hi ${first},\n\nThanks for reaching out about ${topic}. I have looked into it on our side and will follow up shortly with the next step. If anything else comes up in the meantime, just reply here and it stays on this thread.\n\nBest,\nReply Assistant`;
  aiActions.push({
    id: 'act_' + pad(++aiN, 3), agentId: 'ai_1', ticketId: t.id, kind: 'draft', status: 'pending',
    draftBody,
    suggestedPriority: null, suggestedTags: [], kbArticleId: null,
    // Deterministic, realistic token counts (as if a model produced these drafts).
    promptTokens: 320 + (t.number % 460), completionTokens: Math.max(40, Math.round(draftBody.length / 4)),
    createdAt: iso(new Date(t.lastMessageAt).getTime() + 5 * MIN), resolvedAt: null,
  });
}
for (const t of resolvedTickets) {
  aiActions.push({
    id: 'act_' + pad(++aiN, 3), agentId: 'ai_2', ticketId: t.id, kind: 'resolve', status: 'sent',
    draftBody: null, suggestedPriority: null, suggestedTags: [], kbArticleId: pick(kbSeed).id,
    promptTokens: 540 + (t.number % 520), completionTokens: 130 + (t.number % 160),
    createdAt: iso(new Date(t.createdAt).getTime() + 10 * MIN), resolvedAt: t.updatedAt,
  });
}

// ---------------------------------------------------------------- channels
const channels = [
  { id: 'ch_1', type: 'webchat', name: 'Website chat', enabled: true, inboundToken: 'tok_webchat_3f9a2c81', address: null, createdAt: iso(NOW_MS - 50 * DAY) },
  { id: 'ch_2', type: 'email', name: 'Email — support inbox', enabled: true, inboundToken: 'tok_email_b71e0439', address: 'support@basedesk.example', createdAt: iso(NOW_MS - 55 * DAY) },
];
for (const t of tickets) {
  t.channelId = t.channel === 'chat' ? 'ch_1' : t.channel === 'email' ? 'ch_2' : null;
}

// ---------------------------------------------------------------- @mention notifications
// Seed a couple of internal notes where a teammate @mentions the current admin
// (Sam / a_1), plus the matching notifications — one unread, one already read —
// so the header bell demonstrates both states on first load.
const mentionTargets = tickets.filter((t) => t.status === 'open' || t.status === 'pending').slice(0, 2);
const notifications = [];
const noteSeeds = [
  { actor: 'a_2', body: 'Hey @Sam, this one is asking for a manager callback — can you take it? I left a holding note.' },
  { actor: 'a_3', body: 'Thanks @Sam, escalating to you since it touches billing. Flagged it urgent on my end.' },
];
mentionTargets.forEach((t, i) => {
  const s = noteSeeds[i];
  const at = iso(NOW_MS - (i === 0 ? 95 * MIN : 27 * HOUR));
  const mid = 'm_note_' + (i + 1);
  messages.push({ id: mid, ticketId: t.id, authorKind: 'agent', authorId: s.actor, kind: 'note', body: s.body, at });
  notifications.push({
    id: 'nt_' + (i + 1), agentId: 'a_1', ticketId: t.id, messageId: mid,
    actorId: s.actor, snippet: s.body, createdAt: at, readAt: i === 0 ? null : at,
  });
});

const out = { agents, contacts, tickets, messages, canned, deals, kb: kbSeed, aiAgents, aiActions, channels, notifications };
const file = join(dirname(fileURLToPath(import.meta.url)), 'seed.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`seed.json written: ${tickets.length} tickets, ${messages.length} messages, ${contacts.length} contacts, ${agents.length} agents, ${canned.length} canned, ${deals.length} deals, ${kbSeed.length} kb, ${aiAgents.length} aiAgents, ${aiActions.length} aiActions, ${channels.length} channels, ${notifications.length} notifications`);



