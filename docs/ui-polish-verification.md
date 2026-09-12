# UI polish verification

Verified on 12 September 2026. This receipt covers the NoteFIsh interface update and its regression checks; it is not a complete live-call acceptance result.

## Changes

The voice library, enrollment, call desk, setup and invitation-only caller share the updated visual style. Radix composition, Motion transitions, local unDraw SVGs and Lucide icons provide the interface. Microphone and playback waveforms use real audio samples. Voice imports still require a licensed or enrolled reference and explicit permission. Call transport, server authentication and transcript persistence contracts are unchanged.

## Verified

- The full Node test suite passes: 41 tests. Tests cover caller invitation isolation, bounded PCM/worklet encoding, mute/device interruption, actual-completion playback acknowledgements, cancelled playback, persisted calls, and recording cancellation followed by a delayed release event. Provider and transport fixtures are used where indicated by the tests; FFmpeg conversion is exercised locally.
- The production Vite build succeeds. Docker builds and its isolated smoke check passes: injected port, non-root application process, FFmpeg availability, anonymous API denial, authenticated access and settings retained across container recreation. The image contains the required third-party license notices and excludes local keys and data.
- Secret-hygiene checks scan source and staged content against configured local secrets; no matches or missing ignore rules were found. No provider keys are included in the browser build.
- The UI reviewer checked laptop voice library, enrollment and setup views, plus 390-pixel mobile library, enrollment, setup, desk and caller views. Those inspected views had no horizontal overflow. Keyboard/focus smoke checks and text/placeholder contrast review passed; this is not an exhaustive accessibility certification.
- The approved stock licensed Kyoko voice produced a real Fish French preview. The final browser preview completed: duration 3.082375 seconds, currentTime equalled duration, the native audio element reached its ended state, and readyState was 4. The recorded waveform showed 39 of 48 bars above the silent baseline; the modal Close control remained visible while scrolling. English agent / French caller remains the demo pair. This does not attest ownership of, or permission for, any personal voice.

Screenshots and provider/container receipts are kept in the ignored `data/evidence/` directory. Third-party sources and notices are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Still unverified

The complete workflow on a physical caller phone and laptop has not been demonstrated: real caller microphone heard at the desk, English captions, real English agent push-to-talk heard as French on the phone, then hangup with the completed transcript retained. Automated audio/transport tests, screenshots and the French voice preview are intermediate evidence, not substitutes for that acceptance test.
