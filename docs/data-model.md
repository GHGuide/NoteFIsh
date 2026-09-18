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
for the desk. Version 2 added `agents: Agent[]`, a roster of seats; version 3
takes it out again, handing the last seat's voice and languages to the desk's own
settings so nothing that was in use is lost.

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

`settings.registers` holds the per-register map for the desk. `Call` gains
`detectedLanguage` (set from the first caller phrase when the customer language is
`auto`). `agentId` is always null now and stays only so old rows still load;
`agentName` is written at answer with the name of the voice the caller heard, which
is what the history and the outbound webhook show.

A call's voice and language pair is the desk's, captured when the call is answered,
so changing a voice mid-call does not disturb the call in progress.
