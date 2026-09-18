# One desk, many voices (plan, 18 Sep 2026)

## Goal

Remove the floor: the roster, seats, "answering as", the Floor page, and signing
out. A person signs in once and stays signed in. What they switch between is
their **voices** — a name, an avatar and how they sound — not a roster entry.

This reverses the Floor rules added to AGENTS.md on 15 Sep 2026, at the user's
request: "the whole floor thing is badly designed and very confusing. also
signing in as operators is a bad idea."

## Why it matters beyond the confusion

A roster with nobody seated means calls ring nobody. Eight calls in the current
history ended "No agent answered within 60 seconds" or "no agent free" for
exactly that reason, while the desk was open in front of the user. Removing the
seat removes that whole class of failure: a call always rings this desk.

## Current state

- **Seat** (`server/session.mjs`): a 12-hour signed `notefish_agent` cookie
  naming a roster row. Presence, never authentication.
- **Account** (`server/accounts.mjs`): a real person, 30-day `notefish_user`
  cookie, scrypt password, roles admin/supervisor/agent.
- `server/queue.mjs` reports presence and the queue; `calls.mjs:578` enforces
  first-answer-wins; every per-call event is addressed `to: call.agentId`.
- Settings resolve agent-then-workspace in `calls.mjs:445`.
- The frontend carries `seat`, `floor`, `agents` through nearly every page.

## Decisions

1. **Accounts stay, seats go.** The user's own words are "if you log in once".
   Sign-in is what keeps a hosted desk from being open to anyone with the link,
   and the OpenAI and Fish keys sit behind it. Signing *out* goes.
2. **A voice is the identity.** The sidebar's "ANSWERING AS" becomes the voice
   switcher: avatar, name, and the other voices underneath it.
3. **Switching a voice switches only the voice.** Languages, style and glossary
   stay desk-wide, so changing how you sound never silently changes what
   language you are translating into. Assumed, not confirmed; the alternative is
   per-voice languages, which is a larger change and easy to add later.
4. **Roles collapse to one.** With no roster to administer, admin/supervisor/
   agent have nothing left to separate. Accounts keep an owner for voices.

## Proposed changes, in order

Each step leaves the tree working and the tests green.

1. **Server stops needing a seat.** `answer()` drops its `agentId` argument and
   the first-answer-wins guard. Per-call events broadcast to the desk. Calls
   record the voice used instead of the agent who took them.
2. **Server drops the roster.** Delete `queue.mjs`, `session.mjs`, the
   `/api/agents*` and `/api/floor` routes, `ownCall`, `requireFloor`, the
   floor-only panels in `layout.mjs`, and the `agents` array from the store, with
   a migration that carries any per-agent voice choice onto the workspace.
3. **Frontend drops the seat.** Remove `seat`, `floor` and `agents` from
   `App.jsx` and every page; delete `pages/floor.jsx`; remove the Agents pane
   from settings; remove the sign-out button.
4. **Sidebar becomes the voice switcher**, with the blob avatar and name.
5. **Companion** loses `--as`.
6. **Docs**: AGENTS.md floor rules, README, architecture, data-model, flows.

## Files affected

`server/`: index.mjs, routes.mjs, calls.mjs, queue.mjs (delete), session.mjs
(delete), store.mjs, layout.mjs, accounts.mjs, integrations/index.mjs.
`web/`: App.jsx, api.js, lib.jsx, pill.jsx, pages/{floor (delete), settings,
desk, calls, insights, voice, phrases, onboarding, free, auth}.jsx.
`companion/index.mjs`. Tests: agent-session, queue-routing (delete or rewrite),
roles, invites, desk-layout, style-policy, server-shared-demo.

## Risks and assumptions

- **Existing data.** 183 calls reference `agentId`/`agentName`. They keep those
  fields as history; nothing reads them for routing any more.
- **The hosted desk.** app.notefish.ai has one account. Removing roles cannot
  lock anyone out, because the only role that gated anything was admin and the
  sole account holds it.
- **Reversibility.** This deletes a feature the user asked for on 15 Sep. It is
  recoverable from git, but not cheaply.
- **Assumed:** decision 3 above.

## Verification

- `npm test` green at every step.
- A call rings the desk and can be answered with no seat taken, which is the
  failure the user actually hit.
- The sidebar switches voice and the next reply uses it.
- No request anywhere returns `NO_SEAT` or `SINGLE_DESK`.
