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

Generate a private caller link in the desk and open it on the phone. Hold Space records the agent's reply. Release submits it for transcription, translation, Fish synthesis, and playback on the phone. Only generated Fish speech reaches the caller. The desk receives the caller's original microphone audio and translated captions over a separate authenticated connection.

## Deploy

Use [the complete Render deployment guide](docs/render-deployment.md), [Dockerfile](Dockerfile), and [Render Blueprint](render.yaml).

One Docker web service includes Node and FFmpeg, serves the built website/API/WebSockets on Render's `PORT`, listens on `0.0.0.0`, and stores state on a persistent disk at **`/var/data`**. Workspace access requires the `desk` login. The caller page uses a short-lived invitation instead of sharing that password. Provider keys belong in Render Environment, never frontend code or build arguments.

## Verification

```sh
npm test
npm run build
```

Tests exercise provider boundaries, audio conversion, call/stream behavior, cancellation, persistence, and access controls. Provider and simulated protocol checks are intermediate evidence. The actual demo still requires a real phone, captions, translated Fish audio heard on that phone, and a retained transcript.

Current contracts: [implementation](docs/implementation-contract.md), [Render and handset acceptance](docs/render-deployment.md). Earlier concept material: [vision](finalidea.md), [original build specification](docs/hold-project.md), [product review](docs/product-review.md). Current implementation updates at the top of those documents supersede the earlier three-page/conference sketch.
