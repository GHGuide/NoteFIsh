# NoteFIsh implementation contract

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
- POST /api/voices/clone multipart: `audio` file, `name`, `description`, `transcript`, `language`, `consent=true` -> `{voice}`. Min 3s audio, recommend 15-30s, max 30MB and bounded duration.
- POST /api/voices/import `{referenceId,name,description,language,consent:true}` -> `{voice}`. Only enrolled/licensed voices, verified model lookup; user attestation required.
- PATCH /api/voices/:id `{name?,description?,archived?}` -> `{voice}`. Archive locally, never silently delete remote model.
- POST /api/voices/:id/refresh -> `{voice}`.
- POST /api/voices/:id/preview `{text,language}` -> audio/mpeg (or audio/wav).
- GET /api/settings -> `{settings:{voiceId,agentLanguage,customerLanguage,queueName}}`.
- PUT /api/settings same settings object -> `{settings}`.
- POST /api/caller-invitations -> `{url,expiresAt}`. A same-origin workspace visitor issues a ten-minute, single-use caller link with the token in its fragment. Protected mode also requires desk login. Up to eight outstanding links; no token in logs, API query strings, persisted calls, or desk broadcasts.
- GET /api/calls -> `{calls: Call[]}`.
- POST /api/calls/:id/answer -> `{call}`.
- POST /api/calls/:id/end -> `{call}`.
- POST /api/calls/:id/stop -> `{call}`.
- POST /api/calls/:id/reply multipart `audio` OR JSON `{text}`; derive voice/languages from current settings server-side -> `{call}`. No overlapping generation.
- PATCH /api/calls/:id/ticket `{issue,address,dispatch,confirmDispatch?}` -> `{call}`.

Voice: `{id,referenceId,name,description,language,kind:'enrolled'|'licensed',status:'training'|'ready'|'failed',archived,createdAt,error?}`. Local id may equal referenceId. Preview only ready/nonarchived.

Call: `{id,callSid,transport:'browser'|'twilio',from,state:'ringing'|'in_call'|'ended',phase:'listening'|'translating'|'playing',startedAt,endedAt,voiceId,agentLanguage,customerLanguage,transcript:[{id,t,speaker:'customer'|'agent',sourceLang,textSource,textShown}],ticket:{issue,address,dispatch,dispatchConfirmedAt?,dispatchConfirmedBy?},error?}`.

## WebSockets and audio

Same-origin browser /ws/desk, subject to the configured workspace access mode: server JSON `{type:'snapshot',calls:[...],settings:{...}}`, `{type:'call',call}`, `{type:'audio',callId,payload}` (base64 mulaw 8k mono from caller, browser decodes/plays after user gesture), `{type:'error',error}`. No agent raw audio can enter the Twilio socket. Optional `{type:'ping'}` heartbeat.

Public caller `/ws/caller`: same-origin, first JSON message `{type:'join',token}` within a short deadline. Consume an unexpired invitation and create one ringing call. Caller then sends binary signed PCM16LE, mono16kHz, chunks up to3200bytes (100ms). The server converts caller audio for desk playback and uses original16k audio for OpenAI transcription/translation. No microphone audio is forwarded before Answer or during translated reply playback.

Caller receives sanitized `{type:'state',callId,state,phase,...}` updates and `{type:'audio',payload,mimeType,playbackId}` containing Fish-generated MP3. Caller acknowledges `{type:'played',playbackId}` only when playback ends. `{type:'clear'}` cancels playback; `{type:'end'}` from caller ends the call. Caller does not receive the transcript, ticket, other calls, voice inventory, or provider configuration. End/disconnect aborts pending generation, releases microphone, and persists transcript. Unknown playback delivery remains unconfirmed.

One agent and one active call. Waiting calls time out after60seconds; a call is bounded to one hour. A restart ends active calls and expires invitations; completed calls remain persisted.

Optional Twilio transport: `/twilio/incoming` returns `<Connect><Stream>` pointing at `/ws/twilio`, and `/twilio/status` handles final status. All requests have Twilio signature and call/account identity validation. Browser demo readiness does not depend on Twilio credentials.

## Success evidence

Build/tests/UI are intermediate evidence. Finish requires a real phone browser opening an HTTPS link and calling a laptop: ringing, answer, audible real caller microphone at the desk, English captions, real English agent microphone reply heard in the selected approved Fish voice in French on the phone, end call, and retained transcript. Same-machine tabs, mock providers, generated test input, or successful build/container checks are intermediate evidence only.

## Live language changes and microphone recovery — 12 Sep 2026

Settings updates immediately synchronize the active call's language pair and notify its caller through the existing sanitized state message. A partial caller phrase is flushed under its previous language hint; queued captions and a reply already underway keep the pair captured when they started. Future phrases and replies use the new pair. Transcript rows preserve sourceLang/targetLang independently of the current call defaults.

Caller startup requests microphone access within the Call tap, with a 30-second preparation timeout and cancellation that releases late-arriving streams. AudioContext activation cannot indefinitely block a granted microphone. If sound remains suspended, the existing explicit Enable audio control resumes it. Denied/missing/busy/unsupported microphone states have separate guidance and full-link copying; the site does not grant browser or OS permission itself.

Browser references: [getUserMedia permission and pending requests](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [WebKit embedded-browser capture requirements](https://webkit.org/blog/11353/mediarecorder-api/).
