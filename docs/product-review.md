# NoteFIsh — feasibility and suggested changes

Reviewed 12 Sep 2026. This is documentation research, not a tested integration.

## Adopted changes

- Product name: **NoteFIsh**. Existing `hold-project.md` filename remains so links keep working.
- Customer languages: those supported by the chosen Fish model, with transcription, translation, and target-language voice testing required before claiming working support. English is the initial agent default.
- The product remains a website for agents, backed by a server. Customers use ordinary phones.

## Connecting a website to Twilio

For a first prototype, obtain a voice-capable Twilio number. Deploy the NoteFIsh website and a backend with a public HTTPS incoming-call endpoint and a persistent WSS audio endpoint. Configure the number's incoming-call webhook to point to that backend. The backend returns TwiML telling Twilio how to handle the call. NoteFIsh then handles ringing/answering, captions, agent microphone capture, and translated audio playback through the chosen topology.

This requires application code; pasting a website homepage into Twilio does not build the audio bridge. A static website alone cannot host the persistent media processing. No account was connected and no number was purchased during this review.

An existing business number can potentially forward to the prototype number if its carrier supports forwarding; confirm carrier costs and behavior. Later, Twilio BYOC can retain the existing carrier and numbers if that carrier supports direct SIP interoperability. Start with one test number before attempting company-wide phone migration.

Sources: [incoming voice webhooks](https://www.twilio.com/docs/usage/webhooks/voice-webhooks), [Voice SDK requirements](https://www.twilio.com/docs/voice/sdks), [BYOC requirements](https://www.twilio.com/docs/voice/bring-your-own-carrier-byoc).

## Verified routing constraints

- Twilio Voice JS SDK can receive calls in a browser.
- `<Start><Stream>` is receive-only for our server; it cannot send generated speech back.
- `<Connect><Stream>` supports audio in both directions but blocks subsequent TwiML while connected. It receives the caller's inbound track.
- Returned Media Streams audio must be raw, headerless, base64-encoded μ-law at 8 kHz. Playback buffering supports `mark` and `clear` messages.

Sources: [browser SDK](https://www.twilio.com/docs/voice/sdks/javascript), [Media Streams](https://www.twilio.com/docs/voice/media-streams), [stream messages and audio format](https://www.twilio.com/docs/voice/media-streams/websocket-messages).

## Proposed first topology — not yet adopted or tested

Test a caller connected to a bidirectional Twilio stream, with the NoteFIsh backend forwarding caller audio and call events to the agent website over a separate browser connection. Capture agent push-to-talk separately; return only Fish speech to the caller. The browser Answer action would be an application-level acceptance action; the server must implement caller waiting, no-answer handling, and audio playback timing explicitly. This differs from answering a Twilio SDK call and may affect when Twilio considers the phone call answered.

This avoids mixing a conference and a bidirectional stream on the same caller leg, but adds browser audio transport/playback work. Compare it against an SDK-based design in a small phone experiment before replacing the existing SDK requirement. Do not claim either design works without a handset test.

## Suggested product changes — proposals, not locked scope

1. Describe the value as helping a human answer calls across languages while keeping a consistent voice. Voice cloning supports the value; measure whether it helps customers.
2. Support multiple languages in the design but start quality testing with two or three pairs and one ordinary support workflow. Add pairs after real-call testing.
3. Preserve meaning exactly. Do not let shortening or polishing invent prices, promises, addresses, or arrival times. Highlight critical details for confirmation.
4. Show distinct states: Listening, Recording your reply, Translating, and Playing to caller. Holding the key records; the caller hears the result after release in the first implementation.
5. Keep push-to-talk, but add a stop-playback control and define what happens if a caller interrupts. A caller cannot be prevented from speaking merely because the desk is half-duplex.
6. Add an optional typed reply on the same desk for microphone failures, plus a short caller explanation that translation can introduce pauses. Retain a human fallback path when a language pair fails.
7. Start with a licensed voice so voice enrollment does not block the first call experiment. Keep agent enrollment as the personalized option.
8. Make dispatch optional for general support queues. Do not imply that Confirm dispatch actually assigns a vehicle or worker unless a real downstream action is implemented.
9. Measure release-to-first-audio delay, complete-turn time, translation accuracy, caller comprehension, interruptions, and cost per completed call. Provider first-audio latency is only one part of total delay.
10. Prove the risky path first: one real phone hears one Fish-generated reply, then add browser listening/captions/PTT around it. A polished desk alone will not validate the product.

Fish documents 83 languages for S2.1-Pro, including the same coverage in its free development variant. It recommends the paid model for production requirements; the free variant has fair-use limits and no time-to-first-audio guarantees. This is provider information, not a NoteFIsh performance measurement. [Fish model documentation](https://docs.fish.audio/developer-guide/models-pricing/models-overview).
