# NoteFIsh — final idea

> **Latest demo direction — 12 Sep 2026:** The user explicitly approved a browser caller page and removed Twilio from the first demo. A real phone opens an invitation link, taps Call, and speaks French; a laptop desk answers, hears the caller, and displays English captions. Holding/releasing the agent microphone produces French Fish speech in the selected approved voice. Ending retains the transcript. This supersedes older “customer never uses the site” and mandatory Twilio passages below. See the current implementation contract and Render deployment guide.

> **Current implementation update — 12 Sep 2026:** The user now requests a Fish Audio-style voice library with cloning, previews, editing, archiving, and voice selection, alongside the call desk. Routes are `/voices`, `/enroll`, `/desk`, and `/admin`. First phone demo: English agent ↔ French caller. Deployment is one Render Docker service with FFmpeg, login, and persistent storage. The implementation uses a bidirectional caller stream plus a separate browser audio connection, not the earlier speculative SDK/conference combination. See [implementation contract](docs/implementation-contract.md) and [Render deployment](docs/render-deployment.md) for the current contract. Older “desk only,” three-route, and SDK/conference passages below describe the earlier concept and are superseded by this update.


**Status:** locked vision, 12 Sep 2026.  
**This file is the idea.** The build spec is [`docs/hold-project.md`](docs/hold-project.md).

NoteFIsh is not a chatbot, not a WhatsApp gadget, and not a “platform.” It is a **desk**.


## Language scope — updated 12 Sep 2026

NoteFIsh supports customer languages covered by the selected Fish Audio cloning/TTS model, rather than a Dutch-only workflow. English is the initial agent-language default; the desk has an agent language and a customer language. Dutch/English is only an example pair wherever it appears in older descriptions.

Fish currently documents 83 languages for S2.1-Pro and the same language coverage for `s2.1-pro-free`. This is provider coverage, not proof that NoteFIsh works equally well in all 83. A usable pair must also work with transcription and translation, and the enrolled voice must be checked in the target language. Keep provider-supported and phone-tested language pairs distinct. Do not claim every accent or dialect works.

For the first implementation, select the customer language explicitly, with a queue default and an agent override. Captions target the agent language; replies target the customer language. Source transcripts retain their actual language. All English-specific pipeline examples below use the initial default and must not become hardcoded restrictions.

Source checked 12 Sep 2026: [Fish model coverage](https://docs.fish.audio/developer-guide/models-pricing/models-overview).


---

## One sentence

A real phone rings a Chrome desk. The agent reads English. They hold a button and the customer hears speech in the customer’s language in an enrolled voice.

---

## The scene

A customer in the Netherlands dials a number. That number is Twilio. In a browser, an agent is sitting on **one page**: the desk.

The phone rings **in that page**. The agent hits **Answer**. Now there is a live call.

The customer speaks in their language. Two things happen at once for the agent:

1. They **hear** the line (headset, Twilio Voice JS SDK).
2. They **read** English captions on the ticket (`agent language ← customer language`).

When it is their turn to talk, they do not type. They **hold Space** (push-to-talk). They speak English. OpenAI turns that English into the short reply in the customer language that a dispatcher would actually say. Fish speaks those words in the voice admin assigned to this queue — the agent’s own clone, or a licensed voice such as “Anna.” The **customer’s handset** plays that translated reply. The agent’s raw English never hits the earpiece.

They **release**. They are listening again.

They hang up. The **ticket keeps the transcript**. If the job is a dispatch, they hit **Confirm**.

The customer never opened a website. They only had a phone.

---

## Why this is the product

Call centers already have phones, tickets, and people who speak one language while the street speaks another. The usual “AI” answer is always-on translation: both sides talk, a bot morphs the audio in both directions, everyone sounds like a demo.

That demo is Twilio’s sample. It is full-duplex Google-Translate-on-the-call. It is not a desk, and it does not sound like a person the customer already knows.

NoteFIsh takes the opposite bet:

| Always-on translate | NoteFIsh |
|---|---|
| Both mouths open | Radio discipline: listen **or** speak |
| Generic TTS | Enrolled / licensed voice |
| “Look, AI” | The job: answer, understand, dispatch |
| A widget on a hub | The site **is** the desk |

Half-duplex is not a limitation you apologize for. It is how a dispatch desk works. You hear the street. You press to talk. You let go.

---

## The three engines (do not collapse them)

| Layer | Who | Job |
|---|---|---|
| **Twilio** | Voice + JS SDK + Media Streams | Real number, ring, headset, audio in and out of the call |
| **OpenAI** | `gpt-4o-mini-transcribe` + `gpt-4o-mini` | Speech → text; Customer language→English captions; English→short speech in the customer language |
| **Fish** | `s2.1-pro-free` + `reference_id` | Clone + TTS so it is **that** voice |

**OpenAI = the words. Fish = who it sounds like. Twilio = the call.**

Realtime APIs are optional later. If you drop Fish and speak with Twilio’s built-in voice, you have rebuilt the sample. The product disappeared.

---

## What the agent sees (one SPA)

Three routes. That is the whole site.

### `/desk` — the product

Four regions, one job:

1. **Line** — Answer / End. Softphone lives here (Twilio Voice JS SDK).
2. **Ticket** — issue, address, dispatch. Confirm dispatch is a first-class action, not a later CRM.
3. **Captions** — English from the customer’s language, scrolling with the call.
4. **PTT** — hold Space (or the button). Hold = talk. Release = listen.

No sidebar of apps. No connector marketplace. No “home” that is a hub.

### `/admin`

Queue → voice. Which inbound queue uses which `reference_id`. Only enrolled or licensed voices. Admin never clones a random person off the call.

### `/enroll`

Fifteen seconds, **off-call**. Agent (or licensed talent) reads a line. Fish trains. Hear it. Done. That id is what the desk speaks as.

---

## Voices (the ethical cut)

You may clone:

- the **agent**, enrolled on `/enroll`
- a **licensed** voice the company paid for (e.g. “Anna”)

You may not clone:

- the **caller**
- a **coworker** captured from the room or the line
- a celebrity, a manager who did not enroll, a voice scraped from voicemail

Admin assigns `reference_id`s to queues. The desk does not pick a face from the live audio and steal it.

---

## What “done” means

Not a slide. Not a mock.

1. A **real phone** dials the Twilio number.
2. **Captions move** in English on the desk.
3. Agent **holds**, speaks English, and **that phone hears speech in the customer’s language** in the enrolled voice.

Until those three are true, NoteFIsh is not NoteFIsh.

---

## Scope

**In**

- Inbound call to a Twilio number
- Answer / End in Chrome
- Captions (`agent language ← customer language`)
- Push-to-talk → cloned speech in the customer language into the handset
- One ticket + Confirm dispatch
- Enroll voice (off-call, ~15s)
- Admin: queue → voice

**Out**

- Integration hub (Slack, email, wiki, CRM as a product surface)
- Flex / Genesys rebuild
- Outbound dialer
- WhatsApp / Telegram / Instagram overlays
- Cloning callers or coworkers
- Always-on two-way translate on the call

---

## Ancestor (so you do not confuse the repos)

A Saturday hackathon cut named **VoiceNote** proved the *mechanic*: hold a key → STT → rewrite into their language → Fish TTS in **your** clone → land it in the habitat. The habitat there was WhatsApp Web. That is a different repo and a different product.

NoteFIsh keeps the mechanic and changes the habitat to the **only** one that matters for this idea: a live inbound call.

Do not port the Chrome extension into this folder. Do not rebuild WhatsApp. The customer has a phone.

---

## How it should feel

Idle desk: quiet. A ring. Answer. The customer’s language in the headset, English on the glass. Hold. Your voice, their language, in their handset. Release. Confirm. End.

You do not “open NoteFIsh.” You sit the desk. The phone rings it.
