# Flows

## Inbound call (happy path)

1. Customer dials Twilio number from a real phone.
2. Twilio hits the inbound webhook. TwiML connects Media Streams and the agent client.
3. `/desk` rings (Line panel).
4. Agent **Answer**. Headset hears the caller.
5. Customer speaks in their language. Captions append English (`agent language ← customer language`). Ticket opens with `from`, `callSid`, queue, voice id.
6. Agent holds **Space**, speaks English. Server: STT → line in the customer language → Fish → audio into the **handset**.
7. Release. Listen again. Repeat.
8. Agent fills issue / address, **Confirm dispatch** if needed.
9. **End**. Transcript stays on the ticket.

## Enroll (off-call)

1. Open `/enroll` while **not** in a call.
2. Read the script (~15s).
3. Stop. Fish trains. **Hear it**. **Done**.
4. `/admin` maps a queue to that `reference_id` (or to licensed Anna).

## Admin

1. Open `/admin`.
2. Each queue has one voice dropdown (enrolled / licensed ids only).
3. Next inbound on that number uses that `reference_id` for PTT.

## PTT (detail)

```
keydown Space
  → mute agent English toward caller (if it was live)
  → capture mic
keyup Space
  → stop capture
  → transcribe English
  → rewrite short reply in the customer language
  → Fish TTS with queue reference_id
  → inject into caller leg
  → return to listen
Escape
  → abort capture, inject nothing
```

## Failure

Call stays up. Desk shows a short status (`Didn't catch that` / `Couldn't speak`). No modal that blocks End.
