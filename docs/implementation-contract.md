# NoteFish implementation contract

12 Sep 2026. The latest user explicitly approves a phone-browser caller page and removes Twilio from the first demo. The website includes voice library, cloning, management, call desk, setup, and invitation-only caller. English agent / French caller is the acceptance pair.

## Runtime

Node 22+ ESM, local Express on 127.0.0.1:3001, Vite dev on 5173; built site served by Express from dist. Render binds 0.0.0.0 on process.env.PORT and persists under DATA_DIR=/var/data. Local state is in gitignored data/. Provider keys server-side only. Audio conversion uses ffmpeg. First demo defaults to English agent and French caller.

Latest access update: the user explicitly requests no sign-in for the temporary shared demo. The deployed Docker image sets `NOTEFISH_PUBLIC_DEMO=true`; anyone with the site URL can create/name voices, use the shared library, and access the desk. The source defaults to protected mode, and a Render environment value of `NOTEFISH_PUBLIC_DEMO=false` restores the existing desk password. This is a shared workspace, not separate private user accounts.

## Browser API (JSON except audio/multipart)

All API errors: `{error: string, code?: string}`. Server may add fields; retain these names for client compatibility.

- Workspace/API/desk WebSocket: shared access without a Basic challenge when `NOTEFISH_PUBLIC_DEMO=true`. Otherwise HTTP Basic login uses username `desk` and `NOTEFISH_DESK_PASSWORD`; strict local-only development can be passwordless. Mutations and desk/caller WebSockets still require an allowed Origin. Public `/caller` serves the caller shell, and a single-use capability authorizes caller transport. API keys never reach either browser.
- GET /api/session -> `{authenticated,loginRequired:false,method:'shared-demo'|'basic'|'local'}` after the access gate. Shared demo visitors are not represented as authenticated users.
- GET /api/status -> `{providers:{fish:{configured},openai:{configured},twilio:{configured}}, access:{mode:'shared-demo'|'protected',loginRequired}, phoneNumber, publicUrl, webhookUrl, streamUrl, ready, blockers: string[], model}`. Configured does not mean verified.
- GET /api/voices?archived=true -> `{voices: Voice[]}` (include archived when requested).
- POST /api/voices/clone multipart: `audio` file, `name`, `description`, `transcript`, `language`, `register?` (`calm`|`warm`|`energetic`|`reassuring`|`apologetic`|`firm`, default calm; `brisk` is accepted as the old name for energetic), `consent=true` -> `{voice}`. Min 3s audio, recommend 45-60s read from the per-language script, max 30MB and bounded duration. The sample is measured (`baseline: {loudness dBFS, rate words/s}`) and rejected 422 `NOISY_SAMPLE` when speech sits under 15 dB above its own pauses. If the caller is seated, the voice is attached as that agent's take for the register.
- GET /api/voices/export -> voice pack (`{kind:'notefish-voice-pack',version,voices:[{referenceId,name,description,language,kind,register?,baseline?}]}`) as a download; GET /api/voices/:id/export -> a one-voice pack. POST /api/voices/import-pack `{pack, consent:true}` -> `{imported:[voice], skipped:[name]}`; each reference is verified on Fish, existing references are skipped, `brisk` takes import as `energetic`.
- POST /api/voices/import `{referenceId,name,description,language,consent:true}` -> `{voice}`. Only enrolled/licensed voices, verified model lookup; user attestation required.
- PATCH /api/voices/:id `{name?,description?,archived?}` -> `{voice}`. Archive locally, never silently delete remote model.
- POST /api/voices/:id/refresh -> `{voice}`.
- POST /api/voices/:id/preview `{text,language}` -> audio/mpeg (or audio/wav).
- GET /api/settings -> `{settings:{voiceId,agentLanguage,customerLanguage,queueName,registers?}}`. `persona` (≤300 chars, optional) is the house style the interpreter words replies in — length, politeness, phrasing; never facts. `layout` (`{side,main,hidden}` of panel ids, see `server/layout.mjs`; unknown ids dropped, forgotten panels hidden) and `phrases` (`[{id,text}]`, ≤30 × ≤300 chars) are the single desk's arrangement and canned lines; a seated agent's own `agent.layout`/`agent.phrases` win over them and are set with `PATCH /api/agents/:id`. `registers` are the single desk's takes (`calm|warm|brisk|apologetic` -> own ready voice id); a seated agent's `agent.registers` win over them. An unseated enrolment with a `register` lands in this map and never changes `voiceId`. `customerLanguage` may be `'auto'`: the caller's language is detected from their first phrase and the reply targets it. `agentLanguage` is always a fixed code; captions are always shown in it.
- PUT /api/settings same settings object -> `{settings}`.
- POST /api/caller-invitations `{label?, transport?}` -> `{url,expiresAt,label?}`; `label` (≤40 chars) becomes the call's `from` ("Zoom", "WhatsApp"). `transport:'companion'` is the desktop companion on the same machine: local requests only, no public address needed, the response carries `token` instead of a link. A same-origin workspace visitor issues a ten-minute, single-use caller link with the token in its fragment. Protected mode also requires desk login. Up to eight outstanding links; no token in logs, API query strings, persisted calls, or desk broadcasts.
- GET /api/calls -> `{calls: Call[]}`.
- POST /api/calls/:id/answer -> `{call}`.
- POST /api/calls/:id/end -> `{call}`.
- POST /api/calls/:id/stop -> `{call}`.
- POST /api/calls/:id/reply multipart `audio` OR JSON `{text}`, either with optional `feeling` (`auto`|`calm`|`warm`|`energetic`|`reassuring`|`apologetic`|`firm`; a chosen feeling overrides the desk's decision); derive voice/languages from current settings server-side -> `{call}`. No overlapping generation. On `auto` the reply is 409 until a caller phrase has been detected. A spoken reply is measured against the agent's enrolment baseline (loudness, rate), interpreted once for translation + tone, voiced with the agent's register take when one exists (`agent.registers[register]`, else the base voice), given the register's S2 bracket tag on its first sentence plus the interpreter's per-sentence tags (allowlist in `server/emotion.mjs`), and synthesized with matching `temperature` and `prosody.speed`. The register is `chooseRegister()`: a `feeling` the agent chose wins; else an upset caller (`call.callerTone`, from their last caption) or a >2 min wait on the first reply earns an apology; else how the agent said it. `why` on the line says which.
- PATCH /api/calls/:id/ticket `{issue,address,dispatch,confirmDispatch?}` -> `{call}`.

Voice: `{id,referenceId,name,description,language,kind:'enrolled'|'licensed',status:'training'|'ready'|'failed',archived,createdAt,error?,register?,baseline?:{loudness,rate}}`. Local id may equal referenceId. Preview only ready/nonarchived.

Call: `{id,callSid,transport:'browser'|'twilio',from,state:'ringing'|'in_call'|'ended',phase:'listening'|'translating'|'playing',startedAt,endedAt,voiceId,agentLanguage,customerLanguage,detectedLanguage?,callerTone?,transcript:[{id,t,speaker:'customer'|'agent',sourceLang,textSource,textShown,register?,feeling?,tag?,why?}],ticket:{issue,address,dispatch,dispatchConfirmedAt?,dispatchConfirmedBy?},error?}`.

## WebSockets and audio

Same-origin browser /ws/desk, subject to the configured workspace access mode: server JSON `{type:'snapshot',calls:[...],settings:{...}}`, `{type:'call',call}`, `{type:'language',callId,language}` (first detection on an `auto` call), `{type:'audio',callId,payload}` (base64 mulaw 8k mono from caller, browser decodes/plays after user gesture), `{type:'error',error}`. No agent raw audio can enter the Twilio socket. Optional `{type:'ping'}` heartbeat. Replies stream: the caller's socket gets `{type:'audio-start', playbackId, sampleRate:16000}`, then `{type:'audio-chunk', playbackId, payload}` (base64 PCM16 16 kHz) as Fish produces them, then `{type:'audio-end', playbackId}`; it answers `{type:'played', playbackId}` after the last chunk has played. Twilio gets G.711 `media` frames as they arrive and a `mark`. A provider without the live socket, or a socket that fails before the first chunk, falls back to the one-shot `{type:'audio'}` MP3. Live captions: while a Realtime transcription session is up, caller frames go to it instead of the segmenter and each phrase lands as a caption line; the desk also receives `{type:'caption-partial', callId, text}` (empty text clears it). The caller's own socket (browser transport) also receives `{type:'caption', id, who:'you'|'agent', text}` for its own call only — what the caller said, as heard, and what the desk answered, in the caller's language; the phone can hide them. Desk notes, voice ids and other calls never reach it.

Public caller `/ws/caller`: same-origin, first JSON message `{type:'join',token}` within a short deadline. Consume an unexpired invitation and create one ringing call. Caller then sends binary signed PCM16LE, mono16kHz, chunks up to3200bytes (100ms). The server converts caller audio for desk playback and uses original16k audio for OpenAI transcription/translation. No microphone audio is forwarded before Answer or during translated reply playback.

Caller receives sanitized `{type:'state',callId,state,phase,...}` updates and `{type:'audio',payload,mimeType,playbackId}` containing Fish-generated MP3. Caller acknowledges `{type:'played',playbackId}` only when playback ends. `{type:'clear'}` cancels playback; `{type:'end'}` from caller ends the call. Caller does not receive the transcript, ticket, other calls, voice inventory, or provider configuration. End/disconnect aborts pending generation, releases microphone, and persists transcript. Unknown playback delivery remains unconfirmed.

One agent and one active call. Waiting calls time out after60seconds; a call is bounded to one hour. A restart ends active calls and expires invitations; completed calls remain persisted.

Optional Twilio transport: `/twilio/incoming` returns `<Connect><Stream>` pointing at `/ws/twilio`, and `/twilio/status` handles final status. All requests have Twilio signature and call/account identity validation. Browser demo readiness does not depend on Twilio credentials.

## Floor, seats and outbound delivery — 15 Sep 2026

Added at the user's explicit request: multi-agent with a queue, a real phone
number, and delivery into existing systems.

State version 2 keeps the existing `settings` row as the **workspace defaults**
and adds `agents: Agent[]`. A version 1 file is migrated on load by adding an
empty roster. Agent: `{id,name,voiceId,agentLanguage,customerLanguage,registers?,archived,createdAt}`,
where a null override inherits the workspace default and `registers` maps
`calm|warm|energetic|reassuring|apologetic|firm` to that agent's own ready voice for the register
(`PATCH /api/agents/:id {registers}`). Call gains
`agentId` and `agentName`.

- Seats are presence, not authentication. `POST /api/agents/:id/session` sets a
  signed `HttpOnly; SameSite=Strict` cookie (`Secure` in production) naming the
  roster entry this browser acts as; workspace access is decided separately and
  unchanged. `NOTEFISH_SESSION_SECRET` (32+ chars) makes seats survive a
  restart; without it seats last only as long as the process, reported as
  `persistentSessions:false`.
- Multi-agent requires protected mode. Under `NOTEFISH_PUBLIC_DEMO=true` every
  roster route answers 409 `SINGLE_DESK`.
- An empty roster needs no seat: the desk behaves exactly as it did before.
  Once any agent exists, answering without a seat is 409 `NO_SEAT`.
- `GET /api/agents` -> `{agents, floor, agentId}`. `POST /api/agents {name,voiceId?,agentLanguage?,customerLanguage?}`,
  `PATCH /api/agents/:id`, `DELETE /api/agents/:id` (archive; 409 while that
  agent is on a call). Names are unique among active agents, capped by
  `NOTEFISH_MAX_AGENTS` (default 20, max 50).
- `DELETE /api/agents/session` leaves the seat. `POST /api/agents/session/pause {reason}`
  and `/resume` take a seat out of and back into the rotation.
- `GET /api/floor` -> `{floor:{waiting:[{id,from,transport,startedAt,position}],agents:[{id,name,online,paused,pauseReason,callId,state}]}}`,
  state being `available|on_call|paused|offline`.
- `POST /api/calls/:id/answer` assigns the caller to the seat making the
  request. A second agent answering the same call gets 403 `NOT_YOUR_CALL`; an
  agent already on a call gets 409. Reply, stop, end and ticket edits are
  refused for another agent's call with 403 `NOT_YOUR_CALL`. A confirmed
  dispatch records the answering agent's name.
- Concurrency: one live call per agent and `NOTEFISH_MAX_CONCURRENT_CALLS`
  (default 20) per process; the Twilio and caller socket caps follow the same
  number. Beyond it a new caller is refused with "Every line is busy."
- Desk WebSocket: `{type:'snapshot',...,agents,floor,agentId}` on connect and
  `{type:'floor',floor}` on change. `{type:'audio'}` is addressed to the
  assigned agent only; other desks never receive another caller's audio. When
  the last tab for a seat closes, that seat's live browser calls end after a ten
  second grace.
- Twilio no longer requires `NOTEFISH_DESK_PASSWORD`. The request signature is
  what authenticates Twilio, so a shared demo can take real phone calls;
  `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL` are still required.
- Outbound delivery, one-way. A completed call is sent to every configured
  adapter: a signed webhook (`NOTEFISH_WEBHOOK_URL` + `NOTEFISH_WEBHOOK_SECRET`,
  header `X-NoteFish-Signature: sha256=HMAC(secret,"<timestamp>.<raw body>")`
  with `X-NoteFish-Timestamp` for replay rejection) and Zendesk
  (`ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`), which files one
  ticket per call keyed by `external_id`. Retries are 1s/5s/20s; a 4xx other
  than 429 is not retried. Delivery failure never affects the call.
- `GET /api/export/calls` sits outside the workspace gate, is read-only, and
  takes `Authorization: Bearer NOTEFISH_EXPORT_TOKEN`. Supports `since`,
  `cursor`, `limit` (1-500) and `format=csv`; ordering is oldest-ended first so
  a cursor never skips a call. CSV cells beginning `= + - @` are prefixed with
  an apostrophe so caller text cannot execute in a spreadsheet.

## Success evidence

Build/tests/UI are intermediate evidence. Finish requires a real phone browser opening an HTTPS link and calling a laptop: ringing, answer, audible real caller microphone at the desk, English captions, real English agent microphone reply heard in the selected approved Fish voice in French on the phone, end call, and retained transcript. Same-machine tabs, mock providers, generated test input, or successful build/container checks are intermediate evidence only.

## Live language changes and microphone recovery — 12 Sep 2026

Settings updates immediately synchronize the active call's language pair and notify its caller through the existing sanitized state message. A partial caller phrase is flushed under its previous language hint; queued captions and a reply already underway keep the pair captured when they started. Future phrases and replies use the new pair. Transcript rows preserve sourceLang/targetLang independently of the current call defaults.

Caller startup requests microphone access within the Call tap, with a 30-second preparation timeout and cancellation that releases late-arriving streams. AudioContext activation cannot indefinitely block a granted microphone. If sound remains suspended, the existing explicit Enable audio control resumes it. Denied/missing/busy/unsupported microphone states have separate guidance and full-link copying; the site does not grant browser or OS permission itself.

Browser references: [getUserMedia permission and pending requests](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [WebKit embedded-browser capture requirements](https://webkit.org/blog/11353/mediarecorder-api/).
