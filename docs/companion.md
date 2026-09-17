# NoteFIsh companion — your voice inside any call

The desk works with phone numbers and caller links. The **companion** makes it work
inside whatever you already use: Zoom, Google Meet, Teams, WhatsApp, FaceTime,
Instagram, Messenger, Discord, Slack huddles — any app that uses the microphone.

It runs on the agent's Mac next to the call. It listens to what the other side
says (captions and translation appear on the desk as usual), and it speaks your
translated replies **into the call as the microphone**. Your real voice never
enters the call — only the Fish voice does, same as on the phone desk.

## One-time audio setup (macOS)

Two virtual audio devices, one to hear the call and one to speak into it:

```bash
brew install blackhole-2ch blackhole-16ch
```

Then in **Audio MIDI Setup** (Applications › Utilities):

1. `+` › **Create Multi-Output Device**: tick your speakers/headphones **and** `BlackHole 16ch`. Name it *Call + NoteFIsh*.
2. In the call app, set the **speaker** to *Call + NoteFIsh* (or make it the system output). You still hear the call; the companion hears it too.
3. In the call app, set the **microphone** to `BlackHole 2ch`. That is where NoteFIsh speaks.

Check what the companion sees:

```bash
npm run companion -- --list-devices
```

Other devices work too: `--in "Name or index"` for what to listen to, `--out "Name or index"` for where to speak. Never use one device for both — you would hear your own replies as captions.

## Run it

```bash
npm run companion -- --watch
```

Watches for a call every few seconds: known apps and browser tabs, plus the one signal every call shares — the microphone in use (a tiny Swift probe, built on first run when `swiftc` is present). When a call appears, the desk rings with the app's name ("Zoom", "WhatsApp"); answer it on the desk like any call, or start with `--auto-answer` (on a desk with a roster, add `--as <name>` so the companion holds that seat). The bridge ends on its own when the call is gone.

```bash
npm run companion -- --start "Zoom"                  # bridge right now, whatever is running
npm run companion -- --watch --as Nina --auto-answer # hands-free: sign in as Nina on the roster and pick up
```

The desk is where you talk: hold to speak or type, pick a **Sound**, use canned lines. Captions from the call print in the terminal as well.

## How it joins

The companion asks the desk for a *local* caller invitation (`POST /api/caller-invitations {transport:'companion', label}`), which the desk only grants to requests from the same machine, then joins `/ws/caller` exactly as a phone would: 20 ms PCM frames in, MP3 replies out. It uses the desk password from `.env` (`NOTEFISH_DESK_PASSWORD`) or `--password`. No public HTTPS address is needed.

## Limits

- macOS only for now (CoreAudio, AppleScript, `ffmpeg` with avfoundation + audiotoolbox — the Homebrew build has both).
- Half-duplex, like the desk: while a reply plays, the call's audio is not captioned.
- Detection is a best guess: tab titles and process names, then the microphone light. A false start is harmless — decline it on the desk.
- Windows/Linux: the same bridge would run on VB-Cable / PulseAudio loopback; not built.
