# NoteFIsh

A voice workspace and multilingual phone desk. Create approved Fish voices, manage your library, and use a selected voice to reply to a real caller in their language. First demo: **English-speaking agent ↔ French-speaking caller**.

The website uses Fish Audio's clean voice-library design language, with NoteFIsh branding. In the current demo, the caller opens a private link in their phone browser and taps Call. The agent uses the laptop desk and a headset. Twilio is optional and is not required for this browser-call demo.

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
| `/voices` | Find, preview, rename, archive/restore, import, and select approved voices |
| `/enroll` | Record or upload a permitted voice sample and create a private Fish clone |
| `/desk` | Answer/end, hear the caller, read captions, hold Space to reply, retain a ticket |
| `/admin` | Demo setup, language/voice settings, and integration readiness |
| `/caller` | Invitation-only phone calling, microphone, translated playback, and end call |

Generate a caller invitation in the desk and open it on the phone. Hold Space records the agent's reply. Release submits it for transcription, translation, Fish synthesis, and playback on the phone. Only generated Fish speech reaches the caller. The desk receives the caller's original microphone audio and translated captions over a separate desk connection.

## Create and keep your voice

Open **Create voice** from the sidebar or call desk. Press **Record my voice** and read the visible passage at a natural pace (about 30–40 seconds). Stop, listen back, name it, confirm that it is your voice or that you have permission, then choose **Create voice**. Existing recordings remain available under a collapsed option. Fish processes the sample and the named voice is saved in the library; training status continues updating when you switch pages. Once ready, preview it and choose **Use at call desk**. You can rename it later, and the library and selected voice survive service restarts.

The current no-login demo is a **shared workspace**. Everyone who can open the site can access its voice library, settings, and saved calls. Fish models are created with private provider visibility, but this does not make the demo's library private to an individual visitor.

## Record the demo

The home page opens the call desk. Select a voice, choose the two languages, and click **Create call link**. This enables desk audio and requests microphone permission before the first reply. Copy the link to your partner. Answer when they call; the live transcript stays on the right, beside the speaking controls. **Focus view** hides the surrounding navigation for the video. Call notes are collapsed, and saved transcripts remain available from **Saved conversations**.

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
