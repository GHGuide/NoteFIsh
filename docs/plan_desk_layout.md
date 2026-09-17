## Goal
Every agent arranges their own call desk: panels in two columns, drag or arrow keys, hide/show, three presets. Layout and canned lines follow the seat.

## Current state (17 Sep 2026)
Desk was a fixed two-column grid. Now `server/layout.mjs` names the panels and presets; `settings.layout` / `agent.layout` store an arrangement; `settings.phrases` / `agent.phrases` store canned lines.

## Changes
- Server: `layout.mjs` (panels, presets, normalize, move), store validation, `PUT /settings` + `PATCH /agents/:id` accept `layout` and `phrases`.
- Web: `desk-panels.jsx` — `DeskPanel` (motion drag + layout animation, grip, arrows, hide), `ArrangeBar`, `HiddenTray`, `CallerPanel`, `PhrasesPanel`, `QueuePanel`, `AgentsPanel`, `TranscriptLog`.
- Text: `@chenglou/pretext` via `web/text-fit.js` measures caption text without the DOM: new transcript lines animate open at their exact height; past 120 lines the log windows itself (`web/transcript-window.js`).

## Verification
`npm test` (layout normalize/move, store validation, windowing); `vite build`; browser: Arrange → drag a panel across columns, hide, preset, reload keeps it.
