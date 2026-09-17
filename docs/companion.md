# NoteFish companion — your voice inside any call

The desk works with phone numbers and caller links. The **companion** makes it work
inside whatever you already use: Zoom, Google Meet, Teams, WhatsApp, FaceTime,
Instagram, Messenger, Discord, Slack huddles — any app that uses the microphone.

It runs on the agent's Mac next to the call. It listens to what the other side
says (captions and translation appear on the desk as usual), and it speaks your
translated replies **into the call as the microphone**. Your real voice never
enters the call — only the Fish voice does, same as on the phone desk.

## Hearing the call — nothing to install

On macOS 14.2+ the companion taps what the Mac is playing with a Core Audio process
tap (`companion/system-audio-tap.swift`, built on first run). No virtual device, no
Audio MIDI Setup; the call keeps playing through your speakers or headphones.
macOS asks once for **System Audio Recording**. Pass `--bundle us.zoom.xos` to tap
one app only, or `--in "device"` to use a capture device instead.

## Speaking into the call — one virtual microphone

The call app needs a microphone that carries the Fish voice. Install **NoteFish
Voice** (our own driver, MIT, see [driver/README.md](../driver/README.md)):

```bash
sh driver/install.sh
```

then set the call app's **microphone** to *NoteFish Voice*. The companion finds it
by name and streams into it. BlackHole (`brew install blackhole-2ch`, GPL) works as
an alternative with `--out "BlackHole 2ch"`.

Check what the companion sees:

```bash
npm run companion -- --list-devices
```

Other devices: `--in "Name or index"` to listen to a capture device instead of the tap, `--out "Name or index"` to speak somewhere else. Never use one device for both — you would hear your own replies as captions.

## Run it

```bash
npm run companion -- --watch
```

Watches for a call every few seconds: known apps and browser tabs, plus the one signal every call shares — the microphone in use (a tiny Swift probe, built on first run when `swiftc` is present). When a call appears, the desk rings with the app's name ("Zoom", "WhatsApp"); answer it on the desk like any call, or start with `--auto-answer` (on a desk with a roster, add `--as <name>` so the companion holds that seat). The bridge ends on its own when the call is gone.

```bash
npm run companion -- --start "Zoom"                  # bridge right now, whatever is running
npm run companion -- --watch --as Nina --auto-answer # hands-free: sign in as Nina on the roster and pick up
```

The desk is where you talk: hold to speak or type, pick a **Sound**, use canned lines. Captions from the call print in the terminal as well. Captions are live (OpenAI Realtime, the phrase lands ~0.4 s after they pause) and replies stream from Fish (first sound in ~1 s, played as it arrives).

## How it joins

The companion asks the desk for a *local* caller invitation (`POST /api/caller-invitations {transport:'companion', label}`), which the desk only grants to requests from the same machine, then joins `/ws/caller` exactly as a phone would: 20 ms PCM frames in, MP3 replies out. It uses the desk password from `.env` (`NOTEFISH_DESK_PASSWORD`) or `--password`. No public HTTPS address is needed.

## Limits

- macOS 14.2+ (Core Audio taps). `ffmpeg` is only needed for `--in`/`--out` devices other than the driver.
- Half-duplex, like the desk: while a reply plays, the call's audio is not captioned.
- Detection is a best guess: tab titles and process names, then the microphone light. A false start is harmless — decline it on the desk.
- Windows/Linux: the same bridge would run on VB-Cable / PulseAudio loopback; not built.
