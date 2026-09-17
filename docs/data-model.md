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

## Agents and assignment — 15 Sep 2026

State version 2. The existing `settings` row is now the **workspace default**
that every agent inherits, and `agents: Agent[]` is the roster. Loading a
version 1 file adds an empty roster and rewrites it.

```
Agent {
  id            uuid
  name          1-100 chars, unique among active agents
  voiceId       voice id | null   (null = use the workspace voice)
  agentLanguage code | null       (null = use the workspace default)
  customerLanguage code | 'auto' | null
  registers     {calm?,warm?,energetic?,reassuring?,apologetic?,firm?: voice id}  (own take per register; files saying brisk load as energetic)
  layout        {side: [panel id], main: [...], hidden: [...]}  (this agent's desk; server/layout.mjs)
  phrases       [{id, text}]        (canned lines, ≤30)
  archived      boolean           (removal is archival; history keeps the name)
  createdAt     ISO timestamp
}
```

`settings.registers` holds the same per-register map for a desk without a
roster. `Call` gains `detectedLanguage` (set from the first caller phrase when the
customer language is `auto`), and `agentId` (null until answered) and `agentName` (captured at
answer, so a later rename does not rewrite history). Resolution order for a
call's voice and language pair is agent override, then workspace default,
captured when the call is answered.

Seats are not stored. Presence lives in memory for the life of the process:
who is connected, who is paused, and which call each agent holds. A restart
empties the floor, which is correct — nobody is actually sitting there.
