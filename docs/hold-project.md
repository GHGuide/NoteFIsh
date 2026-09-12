# NoteFIsh — project spec

> **Latest demo direction — 12 Sep 2026:** The user explicitly approved a browser caller page and removed Twilio from the first demo. A real phone opens an invitation link, taps Call, and speaks French; a laptop desk answers, hears the caller, and displays English captions. Holding/releasing the agent microphone produces French Fish speech in the selected approved voice. Ending retains the transcript. This supersedes older “customer never uses the site” and mandatory Twilio passages below. See the current implementation contract and Render deployment guide.

> **Current implementation update — 12 Sep 2026:** The user now requests a Fish Audio-style voice library with cloning, previews, editing, archiving, and voice selection, alongside the call desk. Routes are `/voices`, `/enroll`, `/desk`, and `/admin`. First phone demo: English agent ↔ French caller. Deployment is one Render Docker service with FFmpeg and persistent storage. The user now explicitly requests a temporary shared workspace without sign-in: NOTEFISH_PUBLIC_DEMO=true enables public library, voice creation and desk access; false restores the retained desk login. Keys, voice-permission checks and caller invitation verification stay server-side. The implementation uses a bidirectional caller stream plus a separate browser audio connection, not the earlier speculative SDK/conference combination. See [implementation contract](implementation-contract.md) and [Render deployment](render-deployment.md) for the current contract. Older “desk only,” three-route, and SDK/conference passages below describe the earlier concept and are superseded by this update.


**Canonical vision:** [`../finalidea.md`](../finalidea.md)  
**Locked:** 12 Sep 2026.  
**Done:** a real phone in, captions moving, hold heard in the customer’s language on that phone.

This file is the full write-up for building NoteFIsh. Another IDE should be able to implement from here without the chat history.


## Language scope — updated 12 Sep 2026

NoteFIsh supports customer languages covered by the selected Fish Audio cloning/TTS model, rather than a Dutch-only workflow. English is the initial agent-language default; the desk has an agent language and a customer language. Dutch/English is only an example pair wherever it appears in older descriptions.

Fish currently documents 83 languages for S2.1-Pro and the same language coverage for `s2.1-pro-free`. This is provider coverage, not proof that NoteFIsh works equally well in all 83. A usable pair must also work with transcription and translation, and the enrolled voice must be checked in the target language. Keep provider-supported and phone-tested language pairs distinct. Do not claim every accent or dialect works.

For the first implementation, select the customer language explicitly, with a queue default and an agent override. Captions target the agent language; replies target the customer language. Source transcripts retain their actual language. All English-specific pipeline examples below use the initial default and must not become hardcoded restrictions.

Source checked 12 Sep 2026: [Fish model coverage](https://docs.fish.audio/developer-guide/models-pricing/models-overview).


---

## 1. The project

Customer dials your **Twilio number**. Agent hits **Answer** in Chrome. They talk **the customer’s language**; the agent hears the line and reads **English** on the ticket. Agent **holds Space**, speaks **English** → their phone plays **speech in the customer’s language**, sounding like the voice admin assigned (the agent’s clone or licensed “Anna”). **Release = listen.** Hang up. Ticket keeps the transcript.

The site is the **desk**, not a hub.

```
Customer phone  --PSTN-->  Twilio number  --Voice-->  Chrome /desk (JS SDK)
                                |
                                +-- Media Streams --> server --> OpenAI (words)
                                                           --> Fish (voice)
                                                           --> audio back into the call
```

---

## 2. Scope

### In

| Item | Meaning |
|---|---|
| Inbound call | One Twilio number rings `/desk` |
| Answer / End | Softphone controls on the Line panel |
| Captions | Customer language → English on the ticket (`agent language ← customer language`) |
| PTT | Hold Space → English mic → short speech in the customer language → Fish → **handset** |
| Ticket | Issue, address, dispatch + **Confirm dispatch** |
| Enroll | `/enroll`, ~15s, off-call, Fish `reference_id` |
| Admin | Queue → voice (`reference_id` only) |

### Out

- Integration hub
- Flex / Genesys rebuild
- Outbound dialer
- WhatsApp / chat overlays
- Cloning callers or coworkers from the live line
- Always-on Google-Translate-on-the-call (Twilio’s sample; full-duplex)

**NoteFIsh is half-duplex on purpose.** Listen or speak. Not both mouths open with a bot in the middle.

---

## 3. Frontend

**One SPA.** Customer has **no site** — only a phone.

| Route | Who | What |
|---|---|---|
| `/desk` | Agent | The product |
| `/admin` | Supervisor | Queue → voice |
| `/enroll` | Agent / talent | 15s clone, off-call |

### Desk layout (do not invent a fourth column)

```
┌─────────────────────────────────────────────────────────┐
│  LINE          Answer                    End            │
│  (Twilio Voice JS SDK = the softphone in this page)     │
├──────────────────────────────┬──────────────────────────┤
│  TICKET                      │  CAPTIONS                │
│  issue                       │  agent language ← customer language                 │
│  address                     │  scrolling lines         │
│  dispatch                    │                          │
│  [ Confirm dispatch ]        │                          │
├──────────────────────────────┴──────────────────────────┤
│  PTT     hold Space to talk     release to listen       │
└─────────────────────────────────────────────────────────┘
```

- **Line:** ringing, in-call, ended. Answer / End. Headset via the SDK.
- **Ticket:** structured fields + transcript after hangup. Confirm dispatch is in-scope.
- **Captions:** English, attributed to the customer. Update as STT+rewrite lands. Not a raw source-language transcript unless you also keep the source transcript on the ticket internally.
- **PTT:** bottom of the page. Visual pressed state. Holding Space is the same as holding the button. Repeat keydown must not stack overlapping TTS.

Suggested stack for the SPA: whatever is fastest to ship a three-route app (Vite + React or Vite + Vue). Do not add a design system “because call center.” The desk should look like a desk: large type, obvious Answer, obvious hold.

---

## 4. Stack

| Role | Choice | Why |
|---|---|---|
| Real number, ring, headset in Chrome | **Twilio Voice + JS SDK** | The call *is* the product |
| Pull audio out / push TTS back in | **Twilio Media Streams** | Fork customer audio; inject Fish audio |
| Speech → text | **OpenAI `gpt-4o-mini-transcribe`** | Same job as whisper, current model |
| Customer language→English captions; English→short speech in the customer language | **OpenAI `gpt-4o-mini`** | Words, register, brevity |
| Clone + TTS with `reference_id` | **Fish `s2.1-pro-free`** | It is *that* voice |

**OpenAI = words. Fish = who it sounds like. Twilio = the call.**

Realtime (OpenAI Realtime, Twilio ConversationRelay, etc.) is **optional later**. It is not required for done. If you replace Fish with Twilio `<Say>` / generic TTS, you sound like every Twilio demo. Do not.

---

## 5. Audio pipeline

Half-duplex. Two modes. Never mix the agent’s raw English onto the customer ear.

### Mode A — Listen (PTT up)

1. Customer talks in their language into the PSTN.
2. Agent **hears** that audio via Voice JS SDK (headset).
3. Media Streams forks the customer audio to **our server**.
4. Server: `gpt-4o-mini-transcribe` (language hint from the selected customer language) → source-language text.
5. Server: `gpt-4o-mini` → short English caption.
6. Desk appends the caption. Ticket stores both (source-language text + English).

Agent mic to the customer is **muted** while listening (or the English track is not mixed onto the customer leg). The customer must not hear office noise or English.

### Mode B — Talk (PTT down)

1. Agent holds Space, speaks English into the browser mic (this recording is for OpenAI, not for Twilio as raw voice).
2. Desk shows a pressed / “On air” state.
3. On release (or in chunked mode if you later stream): STT English → `gpt-4o-mini` writes **one or two sentences in the customer language** (dispatch register: clear, appropriate formality if it can be inferred, no essay).
4. Fish TTS: `{ text, reference_id, format }` using the queue’s assigned voice.
5. Server pushes that audio **into the customer leg** (Media Streams inbound audio, or a conference participant that plays the clip). The handset hears speech in the customer’s language in the enrolled voice.
6. Agent releases → back to Listen.

### Hard rules

- During PTT, customer must **not** hear the agent’s English.
- During listen, Fish must **not** talk over the customer.
- Failures never hang the call. If STT/TTS dies: show it on the desk, keep the line up, offer **read the translated reply as text** only as a last resort (the success path is audio in the handset).
- One `runId` per hold. A second Space while speaking is ignored or queues, never overlapping Fish.

### Earlier Twilio topology sketch — unverified

This sketch is not a proven wiring recipe. In particular, a unidirectional stream cannot inject audio, and `<Connect><Stream>` blocks later TwiML while connected. Do not assume a caller can simultaneously remain in this stream and execute a subsequent conference join. See [the product review](product-review.md) for verified constraints and a proposed first topology to test.

Earlier candidate (requires topology validation):

1. Inbound webhook returns TwiML that puts the caller in a **conference** (or a bidirectional Media Stream on the call).
2. Agent Answers via JS SDK and joins the same conference.
3. A **Media Stream** on the caller leg sends μ-law 8 kHz mono frames to `wss://your-server/stream`.
4. Your server captions from those frames.
5. To speak: your server injects Fish audio into that stream / a Twilio `<Play>`-equivalent participant so **only the caller** hears it.

If conference mixing fights you, mute the agent participant toward the caller and treat Fish as the only agent-to-caller audio. That matches the product.

---

## 6. Copy / rewrite (OpenAI)

### Captions (customer language → agent language)

System intent: write what the agent needs on the ticket, not a literary translation. Short. Names, addresses, numbers preserved. Output the English line only (store the source language separately).

### PTT (agent language → customer language)

System intent: *what a dispatcher would say into a radio*. One or two sentences. Speech in the customer’s language. Match formality appropriate to the selected language (for example, jij/u in Dutch) from the customer’s last lines if possible. No preamble, no quotes, no “as an AI.”

Temperature low (~0.2). This is a desk, not a novelist.

---

## 7. Fish

### Enroll (`/enroll`)

- Off-call. Never during Answer.
- Script on screen (~15s of varied speech).
- Record ≥ ~3s (target ~15s). PCM → WAV.
- `POST https://api.fish.audio/model` with `type=tts`, `visibility=private`, `train_mode=fast`, voice WAV + matching text, `enhance_audio_quality=true`.
- Poll `GET /model/{id}` until `state=trained` (timeout ~120s).
- **Hear it:** TTS a short line with that `reference_id`. **Done** saves the id.
- Title e.g. “My voice” or “Anna (licensed).”

### Speak

- `POST https://api.fish.audio/v1/tts`
- Headers: Bearer key, `model: s2.1-pro-free`
- Body: `{ text, reference_id, format, normalize, latency: "balanced" }`
- Format into the call: raw headerless μ-law at 8 kHz, base64-encoded for Twilio Media Streams; convert on the server. Do not send a browser preview *instead of* the handset.

### Retries

Timeouts and retries on 429/5xx. 401/402 (bad key / no credits) fail visibly on the desk. Never retry those in a loop.

---

## 8. Admin: queue → voice

`/admin` is a small table, not a people-clone studio.

| Queue | Number / webhook | Voice |
|---|---|---|
| Intake | +31… | `reference_id` of agent Leo |
| After hours | +31… | licensed Anna |

Rules:

- Dropdown of **enrolled / licensed** ids only.
- No “clone from this recording of the caller.”
- Changing the mapping mid-call: next PTT uses the new id; do not hot-swap a clip already playing.

---

## 9. Ticket

Minimum fields:

- `callSid` / Twilio ids
- From (caller number)
- Queue
- Voice id used
- Issue (text; agent can edit)
- Address
- Dispatch (yes/no or a simple enum)
- Confirm dispatch (button + timestamp + who)
- Transcript: ordered lines `{ t, speaker: customer|agent, sourceLang, textSource, textShown }`
- Recording: only if you later add Twilio recording; **not** required for done

On hangup, freeze the transcript. Confirm dispatch can happen during or right after the call.

---

## 10. Backend sketch

Keep providers behind thin adapters. Routes stay thin.

```
server/
  api/           # HTTP: tickets, enroll status, admin mappings, Twilio webhooks
  voice/         # TwiML, conference/join, Answer token for JS SDK
  streams/       # WebSocket Media Streams: frames in, Fish audio out
  stt/           # OpenAI transcribe
  copy/          # gpt-4o-mini captions + PTT rewrite
  tts/           # Fish speak
  clone/         # Fish enroll + poll
  tickets/       # one ticket per inbound call
  admin/         # queue → reference_id
web/             # SPA: /desk /admin /enroll
```

**Twilio capability token** is minted by `voice/` for the logged-in agent. The JS SDK uses that token to Answer.

The current user-approved demo uses explicit shared access without sign-in. Protected mode remains available with the retained desk password by setting NOTEFISH_PUBLIC_DEMO=false. Do not build SSO as the first milestone.

Persistence: SQLite is enough (tickets, voices, queue map). Postgres later.

---

## 11. Env (never commit values)

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_APP_SID=          # TwiML app / API key as you wire Voice
TWILIO_CALLER_ID=        # the inbound number
TWILIO_API_KEY=
TWILIO_API_SECRET=
OPENAI_API_KEY=
FISH_API_KEY=
PUBLIC_WS_URL=           # wss://… for Media Streams
```

`.env` is gitignored. Example file with empty placeholders only.

---

## 12. Pages vs Twilio

| User | Surface |
|---|---|
| Customer | PSTN handset only |
| Agent | `/desk` in Chrome, headset |
| Agent voice | `/enroll` when not on a call |
| Supervisor | `/admin` |

There is no customer web app, no IVR science project, no SMS bot as the wow.

---

## 13. Build order (stop when done is true)

1. **Ring + Answer + End** — Twilio number → JS SDK on `/desk`. Agent hears the caller in the customer’s language. Hang up. (No AI yet.)
2. **Captions** — Media Streams → transcribe the customer language → English on the ticket.
3. **PTT** — hold Space, English STT → line in the customer language → Fish (enrolled id) → **audio in the handset**.
4. **Ticket + Confirm dispatch** — fields persist with the transcript.
5. **Enroll + admin map** — 15s clone off-call; queue points at that id (or Anna).

Do not start with a hub, a component library, or Realtime.

---

## 14. Verification (the only demo that counts)

1. Enroll (or assign licensed Anna) on `/enroll` / `/admin`.
2. From a **real phone**, dial the Twilio number.
3. `/desk` rings. Answer. Speak in the selected customer language into the phone. **Captions move in English.**
4. Hold Space, speak English. **That phone plays speech in the customer’s language in the enrolled voice.**
5. End. Ticket still has the transcript. Confirm dispatch works.

If the “customer” is another browser tab pretending to be PSTN, you have not hit done yet. A second Twilio client is a debug tool, not the demo.

---

## 15. Failure behavior

| Failure | Desk | Call |
|---|---|---|
| STT empty / timeout | “Didn’t catch that” | Stay up; try hold again |
| Fish 401 / 402 | “Couldn’t speak” (key/credits) | Stay up |
| Fish / network after retries | “Couldn’t speak” | Stay up; do not inject silence loops |
| Mic blocked | Ask for mic; do not start PTT | Stay up |
| Stream drop | Show reconnecting; captions pause | Prefer keeping the raw Twilio audio path |

Never hang the browser on a spinner because an LLM timed out.

---

## 16. What this folder is

Documentation-only snapshot of the **final vision**, so a new IDE can continue.

Not in this folder (and must not be copied in as the product):

- VoiceNote Chrome extension (WhatsApp overlay)
- Twin / org-change simulator
- Rehearsal `voice-note-ext` trees

The *mechanic* (STT → rewrite → Fish clone TTS) is the ancestor. The *habitat* is a live inbound call.
