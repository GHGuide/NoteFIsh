# Data model

Names to use in API, DB, and the SPA. Do not rename casually.

## Call

| Field | Notes |
|---|---|
| `id` | Internal |
| `callSid` | Twilio |
| `from` | Caller E.164 |
| `queueId` | Inbound queue |
| `voiceId` | Fish `reference_id` used for PTT |
| `state` | ringing / in_call / ended |
| `startedAt` / `endedAt` | UTC |

## Ticket

One per inbound call.

| Field | Notes |
|---|---|
| `id` | Internal |
| `callId` | FK |
| `issue` | Agent-editable |
| `address` | Agent-editable |
| `dispatch` | Flag or small enum |
| `dispatchConfirmedAt` | Set by Confirm dispatch |
| `dispatchConfirmedBy` | Agent identity |

## TranscriptLine

| Field | Notes |
|---|---|
| `id` | Internal |
| `ticketId` | FK |
| `t` | UTC |
| `speaker` | `customer` \| `agent` |
| `sourceLang` | BCP-47 language tag (for example `nl`, `en`, `es`) |
| `textSource` | STT |
| `textShown` | Caption or speech in the customer language |

## VoiceProfile

| Field | Notes |
|---|---|
| `id` | Fish `reference_id` |
| `title` | “My voice”, “Anna” |
| `kind` | `enrolled` \| `licensed` |
| `createdAt` | UTC |

## QueueBinding

| Field | Notes |
|---|---|
| `queueId` | e.g. `intake` |
| `twilioNumber` | E.164 |
| `voiceId` | Fish `reference_id` |

Admin never stores a caller recording as a `VoiceProfile`.
