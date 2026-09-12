# UI polish verification

Verified on 12 September 2026. This receipt covers the NoteFIsh interface update and its regression checks; it is not a complete live-call acceptance result. The original release checks below predate the later, explicitly requested shared-demo access change.

## Changes

The voice library, enrollment, call desk, setup and invitation-only caller share the updated visual style. Radix composition, Motion transitions, local unDraw SVGs and Lucide icons provide the interface. Microphone and playback waveforms use real audio samples. Voice imports still require a licensed or enrolled reference and explicit permission. That original visual release preserved call transport, server authentication and transcript persistence.

## Verified

- The full Node test suite passes: 41 tests. Tests cover caller invitation isolation, bounded PCM/worklet encoding, mute/device interruption, actual-completion playback acknowledgements, cancelled playback, persisted calls, and recording cancellation followed by a delayed release event. Provider and transport fixtures are used where indicated by the tests; FFmpeg conversion is exercised locally.
- The production Vite build succeeds. Docker builds and its isolated smoke check passes: injected port, non-root application process, FFmpeg availability, anonymous API denial, authenticated access and settings retained across container recreation. The image contains the required third-party license notices and excludes local keys and data.
- Secret-hygiene checks scan source and staged content against configured local secrets; no matches or missing ignore rules were found. No provider keys are included in the browser build.
- The UI reviewer checked laptop voice library, enrollment and setup views, plus 390-pixel mobile library, enrollment, setup, desk and caller views. Those inspected views had no horizontal overflow. Keyboard/focus smoke checks and text/placeholder contrast review passed; this is not an exhaustive accessibility certification.
- The approved stock licensed Kyoko voice produced a real Fish French preview. The final browser preview completed: duration 3.082375 seconds, currentTime equalled duration, the native audio element reached its ended state, and readyState was 4. The recorded waveform showed 39 of 48 bars above the silent baseline; the modal Close control remained visible while scrolling. English agent / French caller remains the demo pair. This does not attest ownership of, or permission for, any personal voice.

Screenshots and provider/container receipts are kept in the ignored `data/evidence/` directory. Third-party sources and notices are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Shared-demo and voice-creation follow-up

The user subsequently requested removal of the sign-in popup and direct access to creating and naming a voice. The Docker demo now explicitly enables shared access with `NOTEFISH_PUBLIC_DEMO=true`; setting it to false restores the existing password gate. The interface labels the shared library, links directly from the desk to creation/library pages, and keeps checking training status across page navigation. Creation success shows the saved name and provides preview and desk-selection actions when ready.

- Backend and enrollment regression checks pass, including anonymous workspace/desk WebSocket access, rejected cross-origin changes, and unchanged caller invitation checks. Missing audio or consent returns a validation error before a provider call.
- Multipart enrollment tests cover chosen name, training, readiness, selection, and persistence after reopening the HTTP server and store. These tests use a provider fixture, not a new personal Fish clone.
- The updated Docker smoke passes in both protected and shared modes, including no `WWW-Authenticate` challenge in shared mode, FFmpeg, non-root startup, and persistent settings.
- The existing Fish multipart creation fields were checked against the current [official voice-cloning documentation](https://docs.fish.audio/features/voice-cloning). No personal voice was created without a supplied sample and the speaker's permission.

The live deployment and browser checks for this follow-up are recorded separately under ignored `data/evidence/` release receipts. They do not replace the physical-device acceptance test below.

## Still unverified

The complete workflow on a physical caller phone and laptop has not been demonstrated: real caller microphone heard at the desk, English captions, real English agent push-to-talk heard as French on the phone, then hangup with the completed transcript retained. Automated audio/transport tests, screenshots and the French voice preview are intermediate evidence, not substitutes for that acceptance test.
