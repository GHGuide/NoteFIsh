# Plan — call-centre readiness

Drafted 15 Sep 2026, implemented the same day. Extends the
[implementation contract](implementation-contract.md), whose
"Floor, seats and outbound delivery" section is now the authority.

## Status

| Item | State |
| --- | --- |
| Rule change in `AGENTS.md` | Done — outbound-only wording, at the user's explicit request |
| A1 seats, A2 per-agent state, A3 concurrency, A4 queue, A5 targeted broadcast, A6 `/floor` | Done |
| B1 Twilio access-mode fix, B2 queue routing, B3 concurrent streams, B4 admin setup | Done |
| B5 real handset test | **Not done. Needs a phone, a number and a public HTTPS deploy.** |
| C1 signed webhook, C2 export API, C3 Zendesk adapter | Done, verified against a fake transport only |
| D1–D5 ease of use | Done, except a seeded demo voice, which needs a real licensed `reference_id` (`NOTEFISH_DEMO_VOICE_REFERENCE_ID` is read but nothing is seeded automatically) |

Evidence: 70 automated tests pass, including two callers reaching two agents at
once with audio isolated per seat. Per `AGENTS.md`, none of that closes B5.

The user asked for three things at once: multi-agent with a queue, a real phone
number, and the ability to plug into existing call-centre platforms — plus
"easy to use" throughout. This plan sequences them.

## Goal

Turn the single-seat NoteFish desk into something a small call centre (5–20
agents) can actually run a shift on: agents sign in, real customers dial a real
number, calls queue and route, and finished calls leave the building as tickets
in whatever system the centre already uses.

## Rule change required first

`AGENTS.md` currently says NoteFish is **not** "an integration hub" and **not**
a "Flex / Genesys rebuild". Workstream C contradicts the first half of that.

The proposed amendment keeps the spirit and narrows the ban:

> NoteFish is not a Flex / Genesys rebuild and does not become a surface for
> Slack, email, wiki or CRM *inside* the desk. It does emit completed calls
> outward — transcript, ticket, audio reference — over a signed webhook and a
> read API, so an existing ticketing system stays the system of record.

That is an outbound one-way boundary, not a hub. **Confirm this wording before
Workstream C starts.** Workstreams A and B need no rule change.

## Current state

Verified by reading the tree on 15 Sep 2026; 61 tests pass on Node 24.9.

What already works and must not regress:

- Caller ↔ desk audio over WebSockets, half-duplex, with `played` acks, `clear`
  cancellation, mute, and live language switching.
- OpenAI transcribe + translate; Fish TTS in an enrolled `reference_id`.
- The Twilio leg is more complete than the docs claim: `/twilio/incoming`
  returns `<Connect><Stream>`, `/ws/twilio` validates signature, accountSid and
  `audio/x-mulaw@8000` ([calls.mjs:323](../server/calls.mjs:323)), and replies
  are converted to μ-law 8k and paced in 1 s frames
  ([calls.mjs:426](../server/calls.mjs:426)). It has never met a real number.
- Security is solid: Origin checks, constant-time comparison, invitation
  capabilities, rate limits, strict CSP, atomic `fsync`+rename persistence.

What blocks a call centre:

| # | Blocker | Location |
|---|---|---|
| 1 | One live call, process-wide: `if (live.size) throw 'The desk is already handling another call.'` | [calls.mjs:209](../server/calls.mjs:209) |
| 2 | No agent identity. Desk sockets are anonymous and ignore every inbound frame | [index.mjs:90](../server/index.mjs:90) |
| 3 | `broadcast` fans every event to all ≤5 desk clients | [index.mjs:27](../server/index.mjs:27) |
| 4 | Settings are one global row — one `voiceId`, one language pair, one `queueName` | [store.mjs:5](../server/store.mjs:5) |
| 5 | No queue: a browser caller becomes a ringing call immediately, or is refused | [index.mjs:122](../server/index.mjs:122) |
| 6 | Tickets never leave: `Confirm dispatch` writes local JSON only | [routes.mjs:156](../server/routes.mjs:156) |
| 7 | `validateTwilio` returns false unless `deskPassword` is set — Twilio and shared-demo mode are mutually exclusive today | [security.mjs:96](../server/security.mjs:96) |
| 8 | First run needs `.env` keys + ffmpeg + an enrolled voice before Space does anything (`canTalk` requires `voice`) | [App.jsx:386](../web/App.jsx:386) |

## Proposed changes

### Workstream A — agents, queue, concurrent calls

The foundation. B and C both assume it.

**A1. Agent identity (smallest thing that is honestly not fake auth).**
Admin maintains a roster in settings: `{id, name, voiceId, languages}`. An
agent opens `/desk`, picks their name once, and the server sets a signed
`HttpOnly`, `SameSite=Strict`, `Secure` session cookie (HMAC over agent id +
issued-at, key from a new `NOTEFISH_SESSION_SECRET`). Existing access modes are
untouched and still gate the workspace.

This is **presence, not authentication** — anyone who can reach the desk can
claim any roster name. It must be labelled that way in `/admin` and in the
docs. Real per-agent auth means an IdP and is explicitly out of scope here;
the cookie is designed so an OIDC subject can replace the roster id later
without touching the routing code.

**A2. Per-agent state.** Store `version: 1 → 2` with a migration that moves the
existing singleton into `workspace.defaults` and seeds an `agents: []` array.
`validateState` gains the new shapes; the old shape is read once and rewritten.
Resolution order for a call: agent override → queue setting → workspace
default.

**A3. Concurrent calls.** Replace the `live.size` guard with a per-agent guard:
one live call *per agent*, `MAX_CONCURRENT_CALLS` (default 20) process-wide.
Each runtime already carries its own segmenter, caption queue and abort
controller, so the machinery is per-call already — the cap is the only thing
that is global.

**A4. Queue and routing.** A new `server/queue.mjs`: inbound calls enter
`waiting`, and ring every agent who is `available` and has a ready voice.
First to answer wins; the rest see it disappear. Waiting calls keep the
existing 60 s timeout and show position and wait time to the caller. Agent
states: `available` / `on_call` / `paused` (with reason).

Recommended over longest-idle round-robin: it needs no fairness bookkeeping and
matches how a 5–20 seat room actually behaves. Round-robin can come later
behind the same interface if someone asks for fairness metrics.

**A5. Targeted broadcast.** `broadcast(event)` becomes
`broadcast(event, {to})` where `to` is an agent id, `'supervisors'`, or
`'all'`. Desk sockets register their agent id from the session cookie at
upgrade time. Raise the desk client cap from 5 to `MAX_AGENTS` (default 20).
Caller audio frames go **only** to the assigned agent — today every connected
browser hears every caller, which is both a privacy problem and a bandwidth
one.

**A6. Supervisor view.** A read-only `/floor` route: live calls, who is on
them, wait times, queue depth. No audio, no barge-in — listening in on staff
is a legal question, not a feature to slip in.

### Workstream B — real phone number

Depends on A only for routing; the audio path itself already exists.

**B1.** Decide the Twilio + access-mode interaction (blocker 7). Recommended:
drop `deskPassword` from the `validateTwilio` precondition and require
`publicBaseUrl` + `twilioAuthToken` only. Signature validation is what actually
authenticates Twilio; the desk password is unrelated to it. Small change,
[security.mjs:96](../server/security.mjs:96), with a test.

**B2.** Route inbound Twilio calls through the A4 queue rather than straight to
the single desk. `registerInbound` already builds a `twilio` transport call
([calls.mjs:234](../server/calls.mjs:234)); it gains a queue hand-off.

**B3.** Concurrent Twilio streams: raise the `twilioWss.clients.size >= 2` cap
([index.mjs:82](../server/index.mjs:82)) to `MAX_CONCURRENT_CALLS`, and confirm
`streamSid → call` mapping holds under parallel calls.

**B4.** Number provisioning in `/admin`: show the webhook URL to paste into the
Twilio console, plus a readiness check that flags missing HTTPS, missing auth
token, and a mismatched `TWILIO_PHONE_NUMBER`.

**B5.** The real test. One phone dials the number, the queue rings, an agent
answers, captions move, a held-Space reply is heard in the Fish voice, end
works, transcript persists. Per `AGENTS.md`, nothing before this counts as
done.

### Workstream C — outbound integration

Gated on the rule change above.

**C1. Signed webhook on call end.** POST the completed call (id, from, agent,
languages, ticket, full transcript, timestamps) to a configured URL with an
HMAC-SHA256 signature over the raw body, a timestamp header, and bounded
retries with backoff. Failures are recorded on the call and surfaced in
`/admin`; a call is never lost because a webhook was down.

**C2. Read API for pull-based systems.** `GET /api/calls` exists; add cursor
pagination, `since`, and a `format=csv` export. Token-scoped, read-only,
separate from the desk session.

**C3. One worked adapter, not a hub.** `server/integrations/` with a single
interface (`deliver(call) → {ok, reference}`) and exactly one implementation
chosen with the user — Zendesk ticket creation is the most common ask. Genesys
and Five9 are platform *replacements*, not ticket sinks; embedding inside them
is a different and much larger project, and this plan does not attempt it.
Everything else uses the generic webhook.

### Workstream D — easy to use

Threaded through A–C, not a phase.

**D1.** A licensed demo voice seeded on first boot so the desk works before
anyone enrols. Product review item 7 already recommends this.
**D2.** A first-run checklist on `/admin` that reads the existing `blockers`
array and links each one to the fix.
**D3.** Desk states named plainly: Waiting · Listening · Recording your
reply · Translating · Playing to caller. Most of this exists; it needs one
consistent vocabulary.
**D4.** Typed-reply fallback when a microphone fails — the API already accepts
`{text}` on `/reply`; the desk should offer it visibly rather than as a
fallback nobody finds.
**D5.** Per-agent onboarding: pick your name, pick your voice, hear it, take
calls. Four steps, one screen.

## Files affected

| Area | Files |
|---|---|
| New | `server/queue.mjs`, `server/session.mjs`, `server/integrations/` (C only), `docs/queue-routing.md` |
| Heavy change | `server/calls.mjs`, `server/index.mjs`, `server/store.mjs`, `server/routes.mjs`, `web/App.jsx` |
| Light change | `server/config.mjs`, `server/security.mjs`, `web/api.js`, `web/styles.css` |
| Docs | `AGENTS.md` (rule change), `implementation-contract.md`, `data-model.md`, `architecture.md`, `README.md` |
| Tests | New: `queue.test.mjs`, `agent-session.test.mjs`, `webhook-delivery.test.mjs`. Updated: `server-api`, `media-calls`, `server-security`, `server-shared-demo` |

## Adapter boundaries touched

- **New:** queue ↔ call service. The call service should not know how a call
  found its agent.
- **New:** integrations. `deliver(call)` only; no vendor SDK reaches
  `calls.mjs`.
- **Preserved:** providers (`openai`, `fish`, `twilio`) stay behind
  `providers.mjs`. Store stays the only writer of persisted state.

## Risks and assumptions

1. **The JSON store is the real ceiling.** One file, one process, whole-state
   rewrite per mutation ([store.mjs:38](../server/store.mjs:38)). Fine for 20
   agents; it will not survive 100, and it cannot survive two instances. The
   plan keeps it and documents the ceiling rather than dragging in Postgres for
   a room of twenty people. Revisit when a real deployment exceeds it.
2. **Roster identity is not authentication** (A1). Must be stated in the UI,
   not just in this file.
3. **Shared-demo mode plus multi-agent is a bad combination.** Anonymous
   visitors claiming agent identities on a public URL. Recommend multi-agent be
   available only in protected mode, and that `/admin` say so.
4. **Per-call cost scales with concurrency** — 20 parallel calls means 20
   parallel OpenAI + Fish streams. Add a visible spend guard before anyone runs
   a real shift.
5. **Call recording and transcript retention are regulated** in most places a
   call centre operates. Outbound webhooks move personal data to third parties.
   Retention limits and a deletion path are a legal requirement, not polish;
   they are named here so they are not discovered late.
6. Twilio concurrency, μ-law pacing under load, and the queue's behaviour when
   every agent is busy are all unproven until B5.

## Verification steps

Per workstream, in order:

- **A:** `npm test` with new queue/session/routing suites. Then two browsers as
  two agents, two phones as two callers, simultaneously: both connect, each
  agent hears only their own caller, the third caller waits and sees a
  position.
- **B:** `npm test`, then the B5 handset test with a real number. Then two
  concurrent real calls.
- **C:** `npm test` with a local webhook receiver asserting signature, retry
  and ordering. Then one real ticket in the chosen system.
- **D:** A person who has never seen NoteFish reaches "took a call" without
  being told what to do.

Build and container checks stay intermediate evidence. The phone test is the
only thing that closes B.

## Open decisions

Each of these changes what gets built. Recommendations given; confirmation
needed before the relevant workstream starts.

1. **AGENTS.md wording** (above) — blocks C.
2. **Scale target.** Recommend 5–20 agents, single instance, JSON store. If the
   real target is 100+, the store and the single-process runtime need replacing
   first and this plan changes shape.
3. **Identity.** Recommend the roster + signed cookie in A1. If real
   per-agent authentication is required on day one, say so now — it is an IdP
   integration, not an afternoon.
4. **Integration target for C3.** Recommend Zendesk, or generic webhook only.
5. **Order.** Recommend A → B → C, D threaded throughout. B is the most
   demo-able and could go first, but it would be built twice: once for the
   single desk, once for the queue.
