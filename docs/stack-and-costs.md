# Stack and costs

What NoteFish runs on, what each piece costs, and what a minute of call actually
bills. Vendor choices here are the intended production shape, which is not in
every case what the code does today: see [Gaps against the code](#gaps-against-the-code).

## Voice pipeline

| Stage | Use | Fallback | Per call minute |
| --- | --- | --- | --- |
| Live caller transcription | ElevenLabs Scribe v2 Realtime | Deepgram Flux | $0.0065 |
| Agent clip transcription | OpenAI gpt-transcribe | ElevenLabs batch | $0.0023 |
| Translation and tone, 3-turn context | OpenAI gpt-4o-mini | Claude or Gemini | $0.0005 |
| Speech output | Fish s2.1-pro | ElevenLabs Flash v2.5 | $0.0104 |
| Post-call transcript for the ticket | OpenAI gpt-transcribe, offline | none needed | $0.0045 |
| **Total** | | | **about $0.024** |

Roughly **$1.45 per hour of call**.

Enrol every agent's voice in **both** Fish and ElevenLabs at record time and store
both reference IDs. Otherwise the voice fallback plays a stranger.

## Everything else

| | Use | Monthly |
| --- | --- | --- |
| Hosting | Render Standard, Frankfurt region | about $25 |
| Database and auth | Supabase Pro, EU region | about $25 |
| Email mailboxes | Google Workspace, one user with free aliases | €6 |
| Product email | Resend, free tier at first | €0, then about $20 |
| DNS, CDN, tunnels | Cloudflare | free |
| Errors | Sentry, free tier | free |
| Payments | Polar or Paddle for self-serve, Stripe for enterprise | 4 to 5% of revenue |
| Phone numbers | Twilio, only for real phone calls | per minute, extra |
| **Fixed total** | | **about €55 a month** |

Plus about **€140 a year** for the four domains.

### On Render specifically

Do not use the free tier. It spins down when idle, and a voice product that takes
thirty seconds to wake up is dead on the first call. The Starter plan at around $7
is fine for development but tight for real traffic, because the server holds
persistent websockets and spawns ffmpeg for every audio conversion. Standard at
around $25 is the realistic floor once anyone depends on it. Put it in Frankfurt so
it sits next to Supabase.

Verify both Render's and Supabase's current prices at signup. Those are from
memory, unlike the call-minute figures, which came from the vendors' own pricing
pages the day before this was written.

## What it costs in practice

| Monthly call volume | Variable | Fixed | Total |
| --- | --- | --- | --- |
| 1,000 minutes | $24 | €55 | about €78 |
| 10,000 minutes | $240 | €55 | about €275 |
| 100,000 minutes | $2,400 | €55 | about €2,250 |

At a hundred thousand minutes the infrastructure is a rounding error.

## Gaps against the code

Recorded here so the difference between the plan and the build stays visible.

- **The speech fallback is wired.** Set `ELEVENLABS_API_KEY` and every voice
  recorded from then on is enrolled at both Fish and ElevenLabs, keeping both
  reference IDs, and speech falls back when Fish cannot speak. Two caveats: voices
  recorded before the key was set have no second reference and cannot fail over,
  and the fallback is one-shot rather than streamed, so it is slower than a normal
  reply. Leave the key unset and Fish failing is simply a failure.
- **Live captions come from OpenAI Realtime**, not ElevenLabs Scribe. Agent clip
  transcription and the translate-and-tone step already match the table.
- **Postgres is wired, as one document rather than tables.** Set `DATABASE_URL` to a
  Supabase connection string and the desk keeps its state there instead of a file on
  the Render disk, moving the existing file across on the first start. What this buys
  is managed backups and data that outlives the machine. What it does not buy is a
  relational schema: accounts, roster, voices and calls are still one JSONB document,
  because splitting them into tables means rewriting all 53 places that read and write
  the store. Worth doing when queries or per-row concurrency start to matter.
- **No Sentry, no Resend, no payments.** Invitations are sent by the operator's own
  mail client from a `mailto:` link rather than by a product mailer.
- **The marketing site is on Cloudflare Pages**, not Render, so it costs nothing and
  adds nothing to the hosting line. The desk itself still runs on Render. The site is
  a single static file and needs neither the app server nor its Content Security Policy.
