# Plan — NoteFIsh for Mac (native shell, smooth end to end)

Written 17 Sep 2026; built the same day. Status:
- Step 1 Tauri shell — built (`src-tauri/`, `npm run app:dev`): window, tray, pill window (`/pill`), ⌥Space push-to-talk → `ptt` event the desk listens to, starts the server. Unsigned dev build only.
- Step 2 Process-tap capture — built and verified (`companion/system-audio-tap.swift`), default input of the companion.
- Step 3 Global PTT + call watcher — built (Tauri shortcut; watcher stays in the companion).
- Step 4 NoteFIsh Voice virtual mic — written (`driver/`, libASPL), needs `sh driver/install.sh` (password) and a real-call check.
- Step 5 Streaming captions + streaming TTS — built and verified live (`server/live-captions.mjs`, `server/fish-live.mjs`).
- Step 6 Polish — pill done; ⌘K palette, permissions walkthrough not done.

## Goal
One Mac app: the desk you have, living in a window and a menu-bar pill, that
hears any call (Zoom, Meet, WhatsApp, FaceTime, Instagram, anything on the
mic) without third-party drivers, speaks your Fish voice into it, and feels as
immediate as Wispr Flow — captions while the caller is still talking, your
reply starting to play within ~300 ms of releasing the key.

## Current state
- Web desk (React 19 + Vite, `motion`, `@chenglou/pretext`, Radix, lucide) served by the Node/Express server. Works in a browser tab.
- `companion/` CLI bridges a call through ffmpeg and needs BlackHole installed by hand.
- Captions and replies are batch: segment → transcribe → translate → full MP3 → play. Reply latency is Fish's full-clip time (2–4 s) plus a transcript round trip.

## The pieces (what to use, why)

### App shell — Tauri 2 (Rust core, system WebView, our existing React UI)
- 3–10 MB bundle, ~50 MB RAM, native window + menu bar; Wispr Flow itself ships as Electron (`com.electron.wispr-flow`) but we do not need Chromium: everything we render already runs in WKWebView.
- Plugins: `tauri-plugin-global-shortcut` (push-to-talk — it reports `Pressed` / `Released`, so hold-to-speak works system-wide), `tray-icon` + `tauri-plugin-positioner` (the pill under the menu bar), `tauri-plugin-autostart`, `tauri-plugin-updater` (signed updates), `tauri-plugin-notification`, `tauri-plugin-store` (local prefs).
- Sidecar: the existing Node server runs as a Tauri sidecar (single binary via `node --experimental-sea` or `pkg`), so nothing in `server/` is rewritten. Fish/OpenAI keys move to the macOS Keychain (`tauri-plugin-stronghold` or Keychain via a small Rust command).
- Fallback if a Rust plugin is missing: Electron. Same React code; 10× the size.

### Hearing the call — Core Audio process taps (macOS 14.2+), no BlackHole
- `AudioHardwareCreateProcessTap` + `CATapDescription`: capture the audio of one process (the call app) or of the whole system, mixed to mono, while it keeps playing to the speakers. macOS 26 adds `bundleIDs` so we tap "us.zoom.xos" / "net.whatsapp.WhatsApp" by name.
- Written as a Rust command (`coreaudio-sys` bindings) or a small Swift helper the sidecar spawns; delivers 16 kHz PCM16 frames straight into the same segmenter the phone path uses.
- Needs the **System Audio Recording** permission prompt (Sonoma 14.4+); one prompt, once.
- Known trap: do not route the tap through `AVAudioEngine`; read the aggregate device with `AudioDeviceCreateIOProcIDWithBlock`.

### Speaking into the call — one virtual microphone, ours
- A virtual mic is the only piece macOS does not provide. Options: BlackHole (GPL-3: bundling it makes the app GPL), Rogue Amoeba Loopback (paid, per user), or **our own Audio Server Plug-in built on `libASPL` (MIT, C++17)** — a single input device named "NoteFIsh Voice" that the app writes PCM into. ~300 lines on top of the library's `SinewaveDevice` example.
- Installed with the app (needs one admin prompt, driver goes in `/Library/Audio/Plug-Ins/HAL`), signed and notarized with the app.
- Interim: keep the BlackHole path as a documented manual option.

### Detecting the call — three signals, cheapest first
1. Default-input `DeviceIsRunningSomewhere` (the mic light) — already built (`companion/mic-in-use.swift`), works for any app.
2. `NSWorkspace.runningApplications` bundle ids (Zoom, Teams, WhatsApp, FaceTime, Discord, Slack…) — replaces `ps`.
3. Browser tabs via AppleScript (Meet, Instagram, Messenger, Zoom web) — already built; add Safari.
- Fold into a Rust/Swift `watch` command that emits `call-started {app}` / `call-ended` events to the UI.

### Making it smooth — streaming everywhere
- **Captions while they talk**: OpenAI Realtime transcription over WebSocket (`gpt-4o-mini-transcribe`, partial results) instead of segment-then-POST. Partial captions appear as words land; the interpreter still runs per sentence for the translation + tone. Alternative to evaluate: `gpt-realtime-translate` (speech in → translated text out in one hop).
- **Replies that start immediately**: Fish WebSocket TTS (`wss://api.fish.audio/v1/tts/live`, MessagePack `start/text/flush/stop`, PCM/opus out, `latency: low`, supports `reference_id`, `temperature`, `prosody`, S2 model header). We send the translated sentences as they arrive and play the first PCM chunk within ~150 ms; today we wait for the whole MP3.
- **Local first hop**: optional on-device transcription with `whisper.cpp` (Metal) for the agent's own push-to-talk (short, one language) — removes a network round trip; keep OpenAI for the caller side where quality matters.
- **Audio path**: one AudioWorklet (already) for capture; playback through a ring buffer into the virtual mic, never through `<audio>` elements; 20 ms frames end to end.
- **UI**: `motion` layout/enter animations (installed); `@chenglou/pretext` for caption measurement and transcript windowing (installed); `cmdk` for a ⌘K "say a canned line" palette; `sonner` for toasts; `react-hotkeys-hook` for in-app keys; keep Radix for menus/dialogs. No new animation library needed.
- **Menu-bar pill**: a second Tauri window (transparent, always-on-top, click-through outside the pill) showing state + last caption, like the companion board in the design canvas.

## Steps
1. **Tauri shell around the current web app** (2 d): window, tray pill, sidecar server, Keychain keys, DMG + notarization. Ship: the desk as a Mac app, phone links and Twilio unchanged.
2. **Process-tap capture** (2 d): Swift/Rust helper → PCM frames → existing caller socket path. Replaces the ffmpeg input side of the companion. Ship: hear any call without BlackHole.
3. **Global push-to-talk + call watcher** (1 d): hold a key anywhere, call detected → desk rings with the app's name. Ship: the Wispr-style flow.
4. **NoteFIsh Voice virtual mic** (3–4 d incl. signing): libASPL driver + installer step. Ship: speak into any call without BlackHole. Until then, BlackHole stays the manual path.
5. **Streaming captions + streaming TTS** (3 d): Realtime transcription socket; Fish live socket with sentence-by-sentence flush; play-as-it-arrives. Ship: sub-second turns.
6. **Polish** (1–2 d): pill window, ⌘K palette, sounds, first-run permissions walkthrough (mic, system audio, accessibility for the hotkey).

Rough total: 2½–3 weeks of focused work. Steps 1–3 give a usable Mac app in the first week.

## Risks and open questions
- Apple permissions are the real friction: microphone, system-audio recording, accessibility (global hotkey), and a driver install. Each is one prompt; the first-run flow must walk the user through all four.
- The virtual mic driver must be notarized with the app; a Developer ID certificate is required before step 4 can ship.
- Fish free tier has no latency guarantee; the streaming numbers assume a paid model.
- Half-duplex stays: while your reply plays, the caller's audio is captured but not captioned (echo into their own captions otherwise).
- Windows/Linux: Tauri runs there, but the audio pieces (WASAPI loopback, VB-Cable) are separate work.

## Verification
- Real calls in each app on the list with a second device; measure caption delay and reply-start delay (target: caption < 1 s after a phrase, reply audio < 500 ms after key release).
- Permission-denied paths: app degrades to captions-only or desk-only with a clear message, never silent.
- `npm test` stays green; new Rust/Swift pieces get a smoke test that spawns them against a fixture.

## Sources
- Tauri 2 vs Electron size/RAM: https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026 · global shortcut Pressed/Released: https://v2.tauri.app/plugin/global-shortcut/ · menu-bar app: https://dev.to/hiyoyok/complete-guide-to-building-a-macos-menu-bar-app-with-tauri-v2-aji
- Core Audio taps: https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps · deep dive: https://www.recall.ai/blog/core-audio-taps · 2026 notes: https://dgrlabs.co/blog/2026-04-25-capturing-system-audio-on-macos-in-2026.html
- libASPL (MIT): https://github.com/gavv/libASPL · BlackHole (GPL-3): https://github.com/inguyendo/BlackHole-macos
- Fish live TTS: https://docs.fish.audio/api-reference/endpoint/websocket/tts-live · S2 latency: https://fish.audio/s2/
- OpenAI realtime transcription: https://developers.openai.com/api/docs/guides/realtime-transcription
- Wispr Flow is Electron: https://macupdater.net/app_updates/appinfo/com.electron.wispr-flow/index.html
