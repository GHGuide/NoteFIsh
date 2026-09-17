# Integration surfaces — how NoteFIsh fits into any call centre, meeting, or HR stack

16 Sep 2026. A survey, not a plan. It answers one question: what are *all* the
ways NoteFIsh can attach to the environments where calls already happen, and
which of them are worth building first.

The product's one mechanic never changes across any of these: **hear the other
person → read captions in your language → hold to speak → they hear your cloned
voice in theirs.** Every surface below is a different way of getting audio into
that loop and out of it again. Nothing here changes the half-duplex rule, the
"clone only enrolled voices" rule, or the "only Fish speech reaches the other
side" rule.

## The one idea that covers most of the market

Wispr Flow does not integrate with Zoom, Meet, or Teams. It sits at the
operating-system audio layer, notices that a call is happening, and works
*through* whatever app is on screen. That is the approach with the widest reach
for NoteFIsh, and it is called the **Companion** below.

A small desktop app on the agent's machine:

```
   softphone / CCaaS / Zoom / Teams / browser   (unchanged, any vendor)
          │ plays caller audio           ▲ reads its microphone
          ▼                              │
   [ app-audio capture ]         [ virtual microphone ]
          │                              ▲
          ▼                              │  only Fish speech, only after release
   ──────────────── NoteFIsh Companion (menu bar) ────────────────
          │  captions in agent language      ▲  hold global hotkey → speak
          ▼                                  │
   ┌──────────────────────────────────────────────────┐
   │  NoteFIsh server: transcribe → translate → Fish  │   (existing)
   └──────────────────────────────────────────────────┘
```

The agent's real microphone never reaches the softphone. The virtual
microphone is silent except while a translated reply plays. The softphone is
simply configured to use "NoteFIsh Microphone" as its input device and never
knows anything is different.

Why it is the highest-leverage surface: it needs **no vendor API, no vendor
approval, no per-platform adapter**, and it works for Genesys, Five9,
Talkdesk, Amazon Connect, 3CX, RingCentral, Zoom Phone, Teams Phone, Aircall,
Dialpad, a WebRTC tab in Chrome, and a Zoom meeting alike. It also opens a
second market that the desk never could: multilingual *meetings*, not only
inbound support calls.

## Every surface, by layer

### Layer 1 — where the call audio comes from

| Surface | How | Reach | Effort | Notes |
|---|---|---|---|---|
| **Companion (desktop, OS audio layer)** | Capture the app's output audio; inject replies through a virtual microphone | Any softphone, CCaaS desktop, meeting app, on any vendor | Medium–high | macOS: Core Audio process taps (14.2+) or ScreenCaptureKit app audio (13+); a userspace HAL plug-in for the virtual mic (BlackHole-style, needs signing/notarisation, not a kext). Windows: WASAPI loopback for capture; a virtual audio driver for the mic. The hard part is the driver, not the AI. |
| **Twilio number** | Built. `<Connect><Stream>` bidirectional μ-law | Anyone who can point a number at a URL | Done, untested on a handset | Also covers BYOC: keep the existing carrier, route via SIP to Twilio. |
| **Other CPaaS** | Same media-stream shape: Vonage, Telnyx, SignalWire, Plivo | Companies already on one of these | Low per provider | One adapter each behind the existing `handleStream` contract. Telnyx and SignalWire are near drop-ins for the Twilio code. |
| **SIP endpoint** | NoteFIsh registers as a SIP user agent / extension, or sits behind a small media gateway (FreeSWITCH, drachtio) | Every on-prem or hosted PBX: Asterisk, FreePBX, 3CX, Cisco CUCM, Avaya, Mitel | Medium | The universal answer for call centres that own their phone system. "Transfer to extension 700" puts any call on the desk. |
| **CCaaS live audio streams** | Vendor APIs that fork call audio to a WebSocket in real time | Cloud contact centres | Medium each | Amazon Connect (live media streaming to Kinesis Video Streams), Genesys Cloud AudioHook, Five9 VoiceStream. Mostly *receive*-oriented — captions are easy, returning the reply into the call is vendor-specific and sometimes not possible without the Companion or a SIP leg. Verify bidirectionality per vendor before promising it. |
| **Meeting bots** | A participant bot joins Zoom/Meet/Teams and relays audio both ways | Meetings, no install on the agent's machine | Low via a bot vendor (Recall.ai-style), high self-built | Zoom Meeting SDK raw audio; Teams via Graph real-time media; Google Meet Media API (preview). A bot is visible in the participant list, which suits interpreting and does not suit a support agent. |
| **Browser caller link** | Built. Phone browser opens an invitation | Demos, field use, one-off callers | Done | Stays. |
| **Browser extension on web softphones** | Overlay + hold-key + inject on any web-based agent desktop | Genesys Cloud, Five9, Talkdesk, Amazon Connect CCP, Aircall — all web | Medium | This is the mechanic the VoiceNote extension already proved on WhatsApp. `AGENTS.md` currently bars porting it here; it is the lightest cousin of the Companion for web-only shops. Decision needed if it is ever wanted. |
| **Headset SDK** | Jabra / Poly / EPOS SDKs expose call state and button events | Any desk with a supported headset | Low | Not an audio path — a *signal*: "off-hook" starts the session, the headset's own button becomes push-to-talk. Pairs well with the Companion. |

### Layer 2 — detecting that a call is happening (the "meeting detector")

The Companion is only useful if it knows when to wake up. Signals, cheapest
first; use several and let any one of them start the session:

1. **Audio session activity.** An app is both playing audio and holding the
   microphone → almost certainly a call. Core Audio / WASAPI expose this without
   any vendor knowledge. This is the Wispr signal.
2. **Foreground app / window title.** Whitelist of known softphones and meeting
   apps; window titles carry caller names and numbers on many of them.
3. **Headset off-hook** (above).
4. **Calendar.** Google / Microsoft calendar says a meeting is scheduled now;
   use it to pre-load the expected language pair, not to start capture.
5. **Vendor events.** Twilio status callbacks (built), Genesys Notifications,
   Amazon Connect contact events — exact, but one per vendor.
6. **Browser tab WebRTC.** An extension can see `getUserMedia` in a tab.

Rule: detection may *offer* to start; capture starts on an explicit gesture the
first time per session. Silently recording the agent's machine is how a product
gets uninstalled by IT.

### Layer 3 — where the agent reads and speaks

| Surface | Today | Notes |
|---|---|---|
| Web desk | Built | Stays the full-featured surface: ticket, transcript, floor. |
| Companion HUD | — | A floating pill/panel like Wispr's: captions, state, one hotkey. The desk becomes optional. |
| Embedded widget in the CCaaS desk | — | Genesys Interaction Widget, Five9 Adapter, Amazon Connect CCP custom panel, Salesforce Open CTI, Zendesk Talk app. An `<iframe>` of the desk plus a postMessage bridge covers most of them with one build. |
| Headset button as PTT | — | Via Layer 1 headset SDK. |
| Mobile app | — | Field agents, later. |

### Layer 4 — where a finished call goes (outbound, one-way)

Built: signed webhook, Zendesk adapter, export API with CSV. The `deliver(call)`
interface takes one file per new destination:

- Helpdesk: Freshdesk, Intercom, ServiceNow, Jira Service Management, HubSpot Service.
- CRM activity: Salesforce, HubSpot, Dynamics — log a call activity with transcript.
- CCaaS record write-back: attach the transcript to the vendor's own
  interaction record (Genesys, Connect contact attributes) so their QA sees it.
- QA / analytics: Observe.ai, Balto, or plain S3/GCS/BigQuery drops.
- Recording storage with a retention policy (compliance, not a feature).

Inbound context ("screen pop": who is calling, their history) is the one
place the outbound-only rule bites. A minimal, read-only lookup — CRM contact
by phone number, shown as one line on the desk — is worth allowing later. It is
still not a hub.

### Layer 5 — HR and workforce

This is where "a seat is not an account" gets fixed properly, and where the
roster stops being hand-typed.

| Need | Integration | Notes |
|---|---|---|
| Real identity | **SSO via OIDC / SAML** (Okta, Entra ID, Google Workspace) | `session.mjs` was built so an OIDC subject replaces the roster id with no routing changes. First thing to do; unlocks everything below. |
| Roster provisioning | **SCIM 2.0** from Okta/Entra, or direct HRIS pull (Workday, Personio, HiBob, BambooHR, Rippling) | Agents appear when hired. **Offboarding must archive the agent and revoke their voice** — a cloned voice outliving employment is a real liability. |
| Languages and skills | HRIS profile → per-agent language defaults → skill-based routing | "French callers ring French-speaking seats" comes from HR data, not from admin typing it. |
| Shifts and presence | WFM (Calabrio, NICE WFM, Verint) or calendar | Scheduled break → auto-pause; shift end → leave seat. Adherence out. |
| Onboarding | Voice enrolment as an onboarding step, with the consent record filed with HR | Voice is biometric-adjacent under GDPR; consent, purpose, and retention belong in the HR system, not only in NoteFIsh's JSON. |
| Stats out | Calls handled, languages served, handle time → HRIS / WFM / payroll | Multilingual-premium pay and coaching both want this. It is the export API plus a few fields. |
| Erasure | Right-to-erasure request → delete transcripts, archive voice, delete the Fish model | Needs a documented, tested path. |

### Layer 6 — bring-your-own AI, data residency

Enterprises have contracted vendors. `providers.mjs` is the boundary:
Deepgram / AssemblyAI / Azure / Google for STT, DeepL / Azure for MT, an
EU-region endpoint for all of them. Fish stays for the voice — dropping it
turns the product back into a Twilio sample.

### Layer 7 — how it is packaged so IT says yes

Docker and Render are built. Add, roughly in order of how often a buyer asks:
Helm chart, an OpenAPI spec for the existing API, a machine-client token for
the audio bridge (so the Companion and a SIP gateway are not using single-use
caller invitations), Terraform for AWS/GCP, a signed and notarised Companion
installer, an MDM profile that pre-approves the audio permissions.

## What to build, in order

1. **OIDC SSO + SCIM.** Small, closes the identity gap, makes HR provisioning
   real, and every later surface assumes it.
2. **A documented machine-client audio bridge.** `/ws/caller` already takes
   PCM16 and returns Fish MP3; give it a long-lived token auth and a written
   contract. The Companion, a SIP gateway, and every CCaaS stream adapter are
   then thin clients of one endpoint.
3. **The Companion, macOS first.** Core Audio process tap for capture, a
   userspace HAL virtual microphone, global hotkey, floating captions. This is
   the Wispr-style detector the user asked for and the single largest expansion
   of where NoteFIsh can be used. Windows second.
4. **SIP endpoint** for on-prem centres, then **Amazon Connect and Genesys**
   stream adapters for cloud ones — chosen by whichever prospect appears first.
5. **More `deliver()` targets and a read-only screen pop.**

Items 3 and 4 both need a real phone test to count as done, per `AGENTS.md`.

## Risks specific to this direction

- **Virtual audio drivers are the whole difficulty of the Companion.** Signing,
  notarisation, and IT approval, not code. Budget for it.
- **Consent.** Capturing call audio on an agent's machine touches recording law
  in every jurisdiction a call centre operates in. Detection must be visible and
  the start explicit.
- **Latency.** The desk has one hop; the Companion adds capture, virtual device
  and hotkey. Measure release-to-first-audio before calling it usable.
- **The ancestor rule.** `AGENTS.md` and `finalidea.md` say do not port the
  Chrome extension. The Companion is not that — it is an OS-level app — but the
  browser-extension row above is. Decide deliberately rather than by accident.
