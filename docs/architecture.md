# Architecture

NoteFish is three providers and a desk. Do not add a fourth product surface.

```
                    PSTN
                      │
                 Twilio number
                      │
          ┌───────────┴────────────┐
          │     Twilio Voice       │
          │  conference / call     │
          └───────────┬────────────┘
                      │
        ┌─────────────┼─────────────────┐
        │             │                 │
   JS SDK          Media             TwiML
   /desk           Streams           webhooks
   headset         wss://            Answer token
        │             │
        │             ▼
        │        NoteFish server
        │        ├─ stt (OpenAI transcribe)
        │        ├─ copy (gpt-4o-mini)
        │        ├─ tts (Fish reference_id)
        │        └─ tickets
        │             │
        │             └── Fish audio ──► caller handset
        └─ PTT mic (English, browser only)
```

The diagram is conceptual, not a validated simultaneous conference/stream topology. See [product-review.md](product-review.md) before implementing call routing.

## Adapter rule

Every external provider sits behind a thin module. HTTP handlers do not call Fish, OpenAI, or Twilio REST directly except through those modules.

| Module | Provider | Calls |
|---|---|---|
| `voice/` | Twilio Voice | TwiML, tokens, Answer/End |
| `streams/` | Twilio Media Streams | frames in, audio out |
| `stt/` | OpenAI | `gpt-4o-mini-transcribe` |
| `copy/` | OpenAI | `gpt-4o-mini` |
| `tts/` + `clone/` | Fish | `/v1/tts`, `/model` |

## Why Fish stays

Twilio can already speak. If TTS is Twilio, the customer hears a demo voice. Fish `reference_id` is the product difference: **who it sounds like**.

## Why half-duplex

Full-duplex translate requires barge-in, echo, overlapping TTS, and usually a generic voice. NoteFish is a desk: the agent listens to the street, then keys the mic. That matches dispatch work and keeps Fish clips clean.

## SPA

One app, three routes (`/desk`, `/admin`, `/enroll`). The Voice JS SDK is initialized on `/desk` only. `/enroll` uses the browser mic for Fish, never Twilio.

See [`hold-project.md`](hold-project.md) for the build order and env list.
