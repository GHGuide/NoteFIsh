# NoteFish

A voice workspace and multilingual phone desk. Create approved Fish voices, manage your library, and use a selected voice to reply to a real caller in their language. First demo: **English-speaking agent ↔ French-speaking caller**.

The website uses Fish Audio's clean voice-library design language, with NoteFish branding. In the current demo, the caller opens a private link in their phone browser and taps Call. The agent uses the laptop desk and a headset. Twilio is optional and is not required for this browser-call demo.

## Run locally

Requires Node 22.12+ and FFmpeg.

```sh
npm ci
cp .env.example .env
```

Skip the copy if `.env` already exists. Fill in your own provider configuration without committing it. Build and run one server:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:3001`. For frontend development, run `npm run dev` and `npm run dev:web` in separate terminals; Vite uses port 5173.

## Website

| Page | Purpose |
| --- | --- |
| `/floor` | Read-only view of who is waiting and which agent is on which call |
| `/voices` | Find, preview, rename, archive/restore, import, and select approved voices |
| `/enroll` | Read the 45–60 s script in your language (one take per feeling: calm, warm, energetic, reassuring, apologetic, firm) and create a private Fish clone |
| `/desk` | Answer/end, hear the caller, read captions, hold Space to reply, retain a ticket |
| `/admin` | Demo setup, language/voice settings, and integration readiness |
| `/caller` | Invitation-only phone calling, microphone, translated playback, and end call |

Generate a caller invitation in the desk and open it on the phone. Hold Space records the agent's reply. Release submits it for transcription, translation, Fish synthesis, and playback on the phone. Only generated Fish speech reaches the caller. The desk receives the caller's original microphone audio and translated captions over a separate desk connection.

## Inside any call — the companion

`npm run companion -- --watch` runs on the agent's Mac and detects a call in Zoom, Google Meet, Teams, WhatsApp, FaceTime, Instagram, Messenger, Discord, Slack — or any app using the microphone — then bridges it through the desk: the other side becomes captions, your replies go into the call as its microphone in your cloned voice. One-time audio setup and options in [docs/companion.md](docs/companion.md).

## The Mac app

**First run.** A five-step setup opens once: languages, the voice callers hear, say a line and hear it come back in their language (`POST /api/try`), then the checks for calls on this Mac (microphone, the NoteFish Voice driver, system audio, ⌥ Space). Settings › Setup runs it again.

**Accounts.** The first person to open the desk creates it (name, work email, password); everyone after that signs in. Passwords are scrypt-hashed in the store, the session is a signed HttpOnly cookie (set `NOTEFISH_SESSION_SECRET` to keep sign-ins across restarts, else a secret is minted once and kept in the store). Google sign-in is a button and a promise for now. The desk password (`NOTEFISH_DESK_PASSWORD`) still works for API clients.

`npm run app:dev` opens NoteFish as a Mac app (Tauri 2, `src-tauri/`): the desk in a window, a **pill** under the menu bar with call state and the last caption, **⌥ Space** as a system-wide hold-to-speak key, and a **menu-bar menu** with the current call and its timer, the last five calls, a *Listen for calls* switch that runs the companion for Zoom, WhatsApp, Meet and the rest, and the caption language. The pill stays hidden until a call needs it; on a MacBook with a notch it *is* the notch, a black island that grows out of it above the menu bar and never takes focus from the call app. The strip under the menu bar is the same component's other look, kept for Windows and for Macs without a notch. Hover either one for options: the caller's language, the caption language, the desk, hide, end. It starts the local server if nothing answers on port 3001 (set `NOTEFISH_ROOT` when the checkout is elsewhere). `npm run app:build` makes the `.app`/DMG. Signing and notarization need a Developer ID.

## Voice files

Any voice exports as a small JSON file (`⋯ › Export voice file`, or **Export library**) holding the Fish reference and what the library knows about it — the take it was recorded for, its baseline. Import it on another desk from **Import Fish voice › From a NoteFish voice file**; Fish confirms the model exists before it joins the library.

## People, roles and who owns a voice

The first account created on a desk is its **admin**; after that the desk is invitation-only. Admins invite people by email from **Settings › Agents** (the link signs them up as that seat), set roles, and offboard. **Supervisors** keep the glossary, phrases and house style and watch the floor. **Agents** answer calls with their own seat and voice. A desk reached without an account, on this Mac or with the shared desk password, is treated as admin.

A recorded voice belongs to whoever recorded it. Only they, or an admin, can use it on a seat, share it as a file, archive it or delete it for good (**⋯ › Delete for good** removes the model at Fish). Licensed voices are shared by everyone. Offboarding an account deletes every voice they recorded at Fish, frees their seat and removes the account.

## Run a floor of agents

Leave the roster empty and NoteFish is one desk, exactly as before. Add names
under **Setup → Put agents on the floor** and it becomes a small call centre:
each agent picks their name in the sidebar, takes a seat, and every waiting
caller is offered to whoever is seated and free. The first agent to answer gets
the call; the others see it disappear. An agent can hold one call at a time, can
pause to step away, and hears only their own caller — audio is addressed to the
assigned seat, never to the whole floor. Each agent can override the workspace
voice and caller language for their own calls.

**A roster entry is a seat, not an account.** Anyone who can open the workspace
can take any name, so the workspace password is what actually controls who
answers calls. Multi-agent requires the protected mode; the shared demo stays a
single desk. Set `NOTEFISH_SESSION_SECRET` (32+ characters) so seats survive a
restart. Defaults are twenty agents and twenty concurrent calls
(`NOTEFISH_MAX_AGENTS`, `NOTEFISH_MAX_CONCURRENT_CALLS`); the single process and
JSON file are the real ceiling, so this suits a room of five to twenty seats.

## Send finished calls to your own systems

A completed call can leave NoteFish so an existing helpdesk stays the system of
record. Nothing comes back the other way, and no integration surface appears in
front of the agent.

| Destination | Configure |
| --- | --- |
| Signed webhook | `NOTEFISH_WEBHOOK_URL`, `NOTEFISH_WEBHOOK_SECRET` |
| Zendesk ticket | `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN` |
| Pull API (JSON or CSV) | `NOTEFISH_EXPORT_TOKEN` |

Verify a webhook with
`sha256=HMAC(secret, "<X-NoteFish-Timestamp>.<raw body>")` and reject a
timestamp that is not recent. Pull instead with
`curl -H "Authorization: Bearer $NOTEFISH_EXPORT_TOKEN" "$BASE/api/export/calls?format=csv"`.

## Create and keep your voice

Open **Create voice** from the sidebar or call desk. Press **Record my voice** and read the visible passage at a natural pace (about 30–40 seconds). Stop, listen back, name it, confirm that it is your voice or that you have permission, then choose **Create voice**. Existing recordings remain available under a collapsed option. Fish processes the sample and the named voice is saved in the library; training status continues updating when you switch pages. Once ready, preview it and choose **Use at call desk**. You can rename it later, and the library and selected voice survive service restarts.

The current no-login demo is a **shared workspace**. Everyone who can open the site can access its voice library, settings, and saved calls. Fish models are created with private provider visibility, but this does not make the demo's library private to an individual visitor.

## Record the demo

The home page opens the call desk. Select a voice, choose your language, set the partner's language or leave it on **Detect automatically**, and click **Create call link**. Captions always arrive in your language; when you push to talk, NoteFish measures how loud and fast you spoke, picks the matching register take of your voice, and speaks the reply in the caller's language with that feeling. This enables desk audio and requests microphone permission before the first reply. Copy the link to your partner. Answer when they call; the live transcript stays on the right, beside the speaking controls. **Focus view** hides the surrounding navigation for the video. Call notes are collapsed, and saved transcripts remain available from **Saved conversations**.

See the [two-person demo script and verification checklist](docs/demo-video.md).

## Deploy

Use [the complete Render deployment guide](docs/render-deployment.md), [Dockerfile](Dockerfile), and [Render Blueprint](render.yaml).

One Docker web service includes Node and FFmpeg, serves the built website/API/WebSockets on Render's `PORT`, listens on `0.0.0.0`, and stores state on a persistent disk at **`/var/data`**. The Docker demo sets `NOTEFISH_PUBLIC_DEMO=true` to open the workspace without a sign-in popup. Set it to `false` in Render Environment to restore the `desk` login using the existing password. The caller page still uses a short-lived invitation. Provider keys belong in Render Environment, never frontend code or build arguments.

## Verification

```sh
npm test
npm run build
```

Tests exercise provider boundaries, audio conversion, call/stream behavior, cancellation, persistence, and access controls. Provider and simulated protocol checks are intermediate evidence. The actual demo still requires a real phone, captions, translated Fish audio heard on that phone, and a retained transcript.

Current contracts: [implementation](docs/implementation-contract.md), [Render and handset acceptance](docs/render-deployment.md). Earlier concept material: [vision](finalidea.md), [original build specification](docs/hold-project.md), [product review](docs/product-review.md). Current implementation updates at the top of those documents supersede the earlier three-page/conference sketch.
