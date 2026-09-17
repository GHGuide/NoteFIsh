# NoteFish browser-call demo

The caller uses a real phone browser; the agent uses a laptop and headset. Twilio is optional. OpenAI transcribes and translates the words, and Fish renders the agent's reply in the selected approved voice.

## Run with temporary HTTPS

For development only, keep the laptop awake and both processes running. A temporary Cloudflare URL depends on this laptop and changes when the tunnel is replaced. It is not a Render deployment.

1. Configure the ignored `.env` using `.env.example`. Set the actual Fish and OpenAI keys. Do not put them in client code or URLs.
2. Run `npm ci` and `npm run build`.
3. Start `cloudflared tunnel --url http://127.0.0.1:3002` and copy its generated HTTPS origin.
4. Stop any previous NoteFish process using the same data directory, then run:

   ```sh
   node scripts/start-browser-demo.mjs https://your-generated-host.trycloudflare.com --port=3002
   ```

   The helper preserves provider keys, creates a private desk password if absent, and stores it in `.env` with mode0600. It does not persist the temporary public origin or port override.
5. Open `http://127.0.0.1:3002/desk` on the laptop. Local development access is permitted only from the actual loopback interface without proxy headers. The HTTPS desk requires username `desk` and the password from `.env`.
6. Import or create a voice you own or have permission to use. Select the ready voice for calls. Set English agent and French caller. Preview the voice before the conversation.
7. Choose **Create call link**, which also enables desk audio. Open the entire invitation on the phone, including its fragment. Do not give callers the desk password.
8. On the phone, tap **Appeler / Call** and allow the microphone. Keep both pages foregrounded. The invitation is valid for ten minutes and one call.
9. Answer the ringing laptop. The phone sends its real microphone audio; the desk plays it and shows translated captions. The caller's audio is never used to clone a voice.
10. Hold Space or the talk button on the laptop, speak English, then release. The phone hears the French Fish reply. During reply processing/playback, caller capture pauses to avoid echo.
11. End from either side. Completed calls remain selectable in the desk. This local mode stores transcripts, voice references, settings and notes in ignored `data/notefish.json`.

The browser permission prompt must be accepted in the browser and, if required, macOS. NoteFish shows denied, pending, suspended, and disconnected states rather than substituting generated microphone input. If audio pauses, use the page's Enable audio action. Use a new invitation after a disconnect or server restart.

## Conversation acceptance

Record these observations from a real phone and laptop:

- Phone taps Call; the enabled laptop rings; Answer connects both pages.
- Caller says: « Bonjour, je voudrais modifier ma réservation. » The agent hears the caller and reads the matching English caption.
- Agent holds to say: “Of course. What name is the booking under?” then releases. The caller hears the correct French response in the selected Fish voice, and never the original English recording.
- Repeat with a name and a number, check stop/cancel, and end from the phone.
- Both pages show ended. The desk retains the original and translated transcript after reload.
- Restart between calls and confirm the completed transcript/settings survive.

A browser playback acknowledgement reports completion at the audio source. A person must still confirm intelligibility, correct language, and the intended voice. Same-laptop tabs, mock-provider tests and network-only tests do not establish the real-phone acceptance above.

## Permanent hosting

Use [the Render deployment guide](render-deployment.md), `Dockerfile`, and `render.yaml`: one Docker web service, Node22+, FFmpeg, `HOST=0.0.0.0`, Render's `PORT`, and a persistent disk at `/var/data`. The disk requires a paid Render service. Set the provider keys and desk password only in Render Environment.
