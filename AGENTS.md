# AGENTS.md — NoteFIsh

You are working in the **NoteFIsh** repo.

NoteFIsh is a browser call-center desk. For the current demo, a caller opens a private link on a real phone and taps Call; the laptop desk rings. The agent hears the caller and reads translated captions. They hold a button, speak, then release; the caller hears translated Fish speech in an approved voice. OpenAI handles words, Fish handles speech, and the server carries the browser audio over secure WebSockets. The site combines a voice library, voice creation, and a call desk.

Read `finalidea.md` and `docs/hold-project.md` before changing anything.

## This is not

- Twin (the earlier org-change simulation; distinct from this NoteFIsh product)
- VoiceNote (WhatsApp/Telegram Chrome overlay)
- A Flex / Genesys rebuild
- An outbound dialer
- Always-on Google-Translate-on-the-call (that is Twilio’s sample)
- An integration hub **inside the desk**. Amended 15 Sep 2026 at the user's
  explicit request: NoteFIsh does not put Slack, email, wiki or CRM surfaces in
  front of the agent, and it never becomes the system of record. It does emit a
  completed call outward — transcript, ticket, agent, languages — over a signed
  webhook, a read-only export API, and one worked ticket adapter. That boundary
  is one-way and outbound only; nothing an integration returns re-enters the
  call path.

## Product rules

- Customer languages follow the selected Fish model coverage, with end-to-end validation. English is the agent default, not a fixed language restriction. See the language scope in `finalidea.md`.

- Half-duplex on purpose. Hold Space records the agent; release sends it for transcription, translation, and Fish playback. Never stream the agent's original microphone to the caller.
- Clone only enrolled / licensed `reference_id`s. Never clone callers or coworkers from the live line.
- OpenAI = words. Fish = who it sounds like. Browser audio = current demo transport. Twilio remains an optional future phone-number transport.
- If you drop Fish, you sound like every Twilio demo. Do not drop Fish.
- Pages: `/voices` (library), `/enroll` (create), `/desk` (call), `/floor` (read-only queue and room), `/admin` (setup), and `/caller` (phone caller). The user explicitly approved the caller page and browser-call demo without Twilio. Caller transport is scoped to an expiring invitation; its UI/socket must not load or broadcast desk APIs or transcripts. The temporary shared workspace is separately public by user request.
- Done means: a real phone browser calls a laptop, rings/answers, caller microphone is audible at the desk with translated captions, a real agent microphone reply is heard in the selected Fish voice on the phone, end works, transcript persists. Synthetic audio and same-laptop tabs are intermediate checks only.

## Floor rules (added 15 Sep 2026)

- A roster entry is a **seat, not an account**. The signed cookie says which
  agent a browser acts as; it does not verify a person. Never describe it as
  authentication in code comments, UI copy, or docs.
- An empty roster means one desk and no seat is required. Seats become required
  only once agents exist, so a single-person deployment stays simple.
- Multi-agent requires the protected access mode. A shared demo cannot tell
  visitors apart, so it stays a single desk.
- Caller audio is addressed to the assigned agent only. `broadcast(event, {to})`
  exists for that reason; never widen an audio event to the whole floor.
- Routing is ring-all, first-answer-wins. The call service owns the assignment
  guard; `queue.mjs` only reports presence and the queue view.
- One live call per agent, `NOTEFISH_MAX_CONCURRENT_CALLS` (default 20) for the
  process. The JSON store and single process are the real ceiling: this is built
  for 5–20 seats, not 100.

## How to work

- Smallest change that unblocks the next step.
- Keys in `.env` / gitignored files only. Never commit secrets.
- Keep the approved caller page focused on this demo; do not invent a hub or WhatsApp overlay.

## Current demo and deployment

- First demo: English-speaking agent, French-speaking caller. Keep other supported languages selectable.
- One Render Docker web service; Node 22+, FFmpeg, built frontend + API + WebSockets on the same server.
- Read `docs/implementation-contract.md` and `docs/render-deployment.md` for the current topology and deployment. They supersede the earlier unverified conference/SDK sketch.
- Server uses Render's `PORT`, listens on `0.0.0.0`, and persists state under `DATA_DIR=/var/data`. The user explicitly requested a temporary shared demo without sign-in. `NOTEFISH_PUBLIC_DEMO=true` opts the Render image into public workspace/API/desk access; absent/false keeps protected mode, and a Render environment override of false restores the existing login. Anyone with the site URL can use this shared library and desk. Keys stay server-side; Origin checks, caller invitations, upload limits and voice permission checks remain enabled.
- Provider checks and container tests are bounded evidence. Do not mark the goal complete without the actual phone conversation.
