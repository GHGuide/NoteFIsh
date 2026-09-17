# Deploy NoteFish on Render

First demo: the agent speaks **English**, the caller speaks **French**. One Docker web service serves the website, HTTP API, and WebSocket endpoints. The caller opens a private link on their phone; the agent answers in the laptop desk. Fish speaks the translated replies; OpenAI transcribes/translates. Twilio is not required for this demo.

The user requested a temporary shared demo without sign-in. The Docker image explicitly opts in with `NOTEFISH_PUBLIC_DEMO=true`. Anyone with the website URL can access the shared voice library, create/name voices with permission, change settings, and use the desk. Keys stay on the server. To restore login, set the Render environment variable `NOTEFISH_PUBLIC_DEMO=false`; the existing desk password remains available. No infrastructure, disk, billing or account schema changes are needed.

## Files

- `Dockerfile`: builds the website and includes Node 22+, production dependencies, and FFmpeg.
- `.dockerignore`: excludes local credentials, recordings/state, dependencies, and Git metadata from the image context.
- `render.yaml`: one Docker web service with a persistent disk.
- `.env.example`: exact configuration names, with credential values intentionally blank.

## Render service settings

| Setting | Value |
| --- | --- |
| Service type | Web Service |
| Runtime / Language | Docker |
| Dockerfile path | `./Dockerfile` |
| Docker build context | Repository root (`.`) |
| Docker command | Leave empty; use the image command |
| Region | Frankfurt for the first European demo |
| Instances | 1 |
| Health check | `/healthz` |
| Persistent disk name | `notefish-data` |
| Disk mount path | **`/var/data`** |
| Initial disk size | 1 GB |
| Instance plan | A paid web service; the Blueprint selects `0.5c-512mb` |

The server binds to `0.0.0.0` and uses Render's `PORT`. Render normally supplies `10000`; there is no need to add a separate frontend port. [Render port binding](https://render.com/docs/web-services#port-binding).

The persistent file is **`/var/data/notefish.json`**. It stores voice references and labels, queue/language settings, tickets, and transcripts. Fish hosts the actual voice models. Uploads and conversion audio are transient; this service does not archive raw call recordings. Only files beneath the disk mount survive redeploys. A disk requires a paid service and supports a single instance; redeploying stops that instance, so finish calls before deploying. [Render persistent disks](https://render.com/docs/disks).

## Exact environment variables

Set secrets in Render's Environment page, never in Git, the Dockerfile, frontend variables, or build arguments.

| Variable | Value / purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Supplied by Render; server reads it directly |
| `DATA_DIR` | `/var/data` |
| `NOTEFISH_PUBLIC_DEMO` | `true` for the approved shared demo; `false` restores protected access. Source defaults to false; Docker/Blueprint explicitly opt in. |
| `NOTEFISH_DESK_PASSWORD` | Existing unique password retained for protected mode, at least 16 characters; username `desk`. Not required to open shared-demo mode. |
| `FISH_API_KEY` | Your Fish Audio API key |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `TWILIO_ACCOUNT_SID` | Optional future phone-number transport; leave unset for browser demo |
| `TWILIO_AUTH_TOKEN` | Optional; leave unset for browser demo |
| `TWILIO_PHONE_NUMBER` | Optional; leave unset for browser demo |
| `PUBLIC_BASE_URL` | Exact public HTTPS origin, such as `https://your-service.onrender.com`; no path or trailing slash |
| `FISH_MODEL` | `s2.1-pro-free` for the first demo, or an available paid Fish model |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` |
| `OPENAI_TRANSLATION_MODEL` | `gpt-4o-mini` |

`RENDER_EXTERNAL_URL` is supplied by Render and is used when `PUBLIC_BASE_URL` is unset. If you add a custom domain, set `PUBLIC_BASE_URL` to that HTTPS origin. Invitation links and origin validation use this URL.

Browser readiness requires Fish, OpenAI, FFmpeg, a public HTTPS URL, an approved selected voice, and a configured access mode. Protected mode additionally requires the desk password. Twilio configuration does not block this demo. Presence of keys is not verification of a real conversation. No `VITE_*` key variables are used. Same-origin checks, caller invitation verification, bounded uploads/audio requests, and voice permission checks apply in both modes.

## Deployment steps

1. Put the source in a private Git repository that Render can access. Keep `.env`, `data/`, and credentials excluded.
2. In Render, choose **New → Blueprint** and select the repository to use `render.yaml`. Alternatively create a **Web Service**, choose **Docker**, and enter the service settings above.
3. Set `FISH_API_KEY` and `OPENAI_API_KEY` in Render's secret environment fields. Retain `NOTEFISH_DESK_PASSWORD` to allow restoring protected mode. Leave Twilio variables unset. Confirm the paid service and disk cost before creating a new service.
4. Deploy the service. Docker builds the website and starts one Node server with FFmpeg. No separate static site, Redis, or database service is needed for this single-agent demo.
5. Open `/voices` or `/desk` at the Render HTTPS URL. The approved shared demo opens directly. If `NOTEFISH_PUBLIC_DEMO=false`, the workspace/API/desk socket require login with username **`desk`** and the configured password. `/healthz` and the caller shell remain public in either mode; the caller connection still requires an invitation.
6. Open **Create voice**, record/upload your own or licensed speech with permission, and wait for Fish readiness. Alternatively import an approved Fish voice from your account. Preview it in French and select **Use for calls**.
7. Set agent language **English** and caller language **French** in the desk. Enable desk audio. Generate a new caller invitation and copy its complete link, including the `#` fragment.
8. Open that link in Safari or Chrome on a real phone. Tap **Call** and allow microphone access. Keep the page in the foreground. The invitation expires after ten minutes and is consumed by one call; create a new link for another call.
9. When the laptop rings, choose **Answer**. Speak French on the phone, then use the laptop's hold-to-speak control for an English reply. Release triggers translation and Fish playback.
10. End from either device. Reopen the retained call in the desk to inspect both source and translated text.

Render supports WebSockets on the same service. A server restart ends an active call; use a new invitation afterward. [Render WebSockets](https://render.com/docs/websocket). Docker runtime configuration and build steps follow [Render's Docker documentation](https://render.com/docs/docker).

## Real-phone acceptance

Use a real phone browser and a laptop with real microphone audio. Two tabs on one laptop or generated test speech do not establish this acceptance.

1. Caller opens the generated HTTPS invitation on their phone and taps Call. NoteFish rings on the laptop; the agent answers.
2. Caller says: **« Bonjour, je voudrais modifier ma réservation. »**
3. Agent hears the caller and reads the English caption. Record any incorrect names, numbers, or meanings rather than treating plausible text as a pass.
4. Agent holds Space, says: **“Of course. What name is the booking under?”**, then releases.
5. Caller hears the French reply in the selected Fish voice. Confirm the caller never hears the agent's original English microphone recording.
6. Repeat several turns, try stop-playback, then end the call. The ticket and both sides of the transcript remain available.
7. Restart the service after the call, and confirm the voice library, language settings, and completed ticket persist.

The demo is complete only when these handset observations are recorded. Passing a build, a provider request, or a simulated WebSocket test alone is insufficient. A playback acknowledgement records that the browser finished playback; a person must still confirm they heard intelligible French in the intended voice.

## Check the image locally before deploying

With Docker running:

```sh
npm test
docker build -t notefish:demo .
npm run test:docker
```

The container check uses a temporary password and temporary Docker volume, without real API keys. It checks a non-default `PORT`, protected mode, shared-demo access without a login challenge, FFmpeg, the application process user, and persistence across container replacement. It cleans up its temporary resources and writes a redacted receipt under `data/evidence/`. It does not call a person or verify real provider audio.

## Troubleshooting

- **No port detected:** confirm `HOST=0.0.0.0`, preserve the image command, and use Render's `PORT`.
- **Startup refuses access:** protected mode needs a `NOTEFISH_DESK_PASSWORD` of at least 16 characters; shared mode needs the explicit `NOTEFISH_PUBLIC_DEMO=true` and a valid public HTTPS origin.
- **Unexpected sign-in prompt:** inspect `/api/status` access mode or the Render `NOTEFISH_PUBLIC_DEMO` override. The approved shared demo uses true; false deliberately restores login.
- **Caller cannot connect:** generate a fresh invitation, copy the complete fragment, and use the configured HTTPS origin. An invitation is single-use and expires after ten minutes.
- **Data disappears:** attach the disk at `/var/data` and set `DATA_DIR=/var/data`; an ordinary container directory is ephemeral.
- **French speech fails:** inspect the page's provider error, refresh the selected voice, and preview it before calling. Confirm the account permits the selected Fish model and OpenAI models.
- **No microphone/audio:** allow microphone access, tap Call/Answer to unlock audio, and keep both pages foregrounded. Use a headset or separate rooms to avoid acoustic echo. An expired invite needs a new link from the desk.

No credentials are included in this guide or the deployment artifacts.

## Optional Twilio transport later

Set the three Twilio variables only when using a real phone number. Incoming voice webhook: POST `https://your-service.onrender.com/twilio/incoming`; status callback: POST `/twilio/status`. The server returns the signed-call stream URL `/ws/twilio`. Do not add the desk password to these URLs. The browser-call demo does not use these endpoints.
