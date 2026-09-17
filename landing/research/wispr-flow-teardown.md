# wisprflow.ai — teardown (17 Sep 2026)

Captured with headless Chrome at 1440×900 and 390×844 (`clone-ui` phase 0): 20 desktop viewports, 4 mobile, computed styles, animation inventory. Numbers below are measured, not guessed.

## Tokens (theirs — reference only; NoteFish keeps its own palette)
- Page `rgb(255,255,235)`; ink `rgb(26,26,26)`; panel `rgb(228,228,208)`; CTA lavender `rgb(240,215,255)`; deep band `rgb(3,79,70)`; accents orange `#FFA946`, coral `#FF6C4C`, pink `#FFBCF2`, mint (testimonial), grey `#9D9C98`.
- Display: **EB Garamond** 400 — h1/h2 96px / 91.2px line / −2.88px tracking, `em` italic for the emphasised half; h3 48px/52.8px. Body **Figtree** 500 20px/26px; nav links 16px/600; small 14px at 70% ink.
- Containers 1240 / 1024 / 912 / 864 px. Nav card ≈ 912 wide, 66 tall, 1px `rgba(26,26,26,.15)` border, cream fill, fixed at top (wrapper 156px tall).
- Bands: dark logo band radius 80/80/0/0; testimonial band radius ~76 top; final CTA band radius 80 bottom; cards radius 24.

## Section order and devices
1. Announcement bar (deep green) → fixed nav card: wordmark · segmented Dictation | Notetaker · Business Pricing Lab · lavender CTA with ink border.
2. Hero 782px, centered: eyebrow, 96px serif with italic half, 20px sub, CTA, availability line. Motion: sentence on a **curved SVG text path** (spiral), two **angled marquee ribbons** (one ink, one cream), a mic pill with waveform and a "Grammar corrected" chip.
3. Dark band "Used by professionals at": **logo ticker** (`logoTicker1 40s linear infinite`).
4. Deep-green band "4x faster than typing": two cards — narrow outlined "Keyboard 45 wpm" and a wide blurred-photo card "Flow 220 wpm" with a ribbon of text across it and the mic pill.
5. **Scroll-pinned feature sequence** (≈7000px of scroll): sticky stage with a left vertical tab list (coral indicator), a centre phone-shaped card (400×466) whose content changes per step, and heading + paragraph on the right; wavy SVG paths in the background. Steps: Speak naturally → Edits as you speak (filler words coloured then fade, `.flow_w` opacity .12s) → Use it anywhere.
6. "Built around how you work" (1859px): serif heading with an underline stroke under the italic; rows that scroll on the right (100+ languages, vocabulary, snippets, sound like you) while a **sticky tilted card** on the left changes content; inactive rows dimmed.
7. Privacy panel card: three columns — serif "Your voice stays yours.", copy + arrow link, three outlined badge circles.
8. Dark band testimonials: huge serif heading, then a **collage of tilted, overlapping cards** (lavender case study with photo + metrics, cream press quotes rotated ±4°, orange quote over photo, mint card).
9. FAQ: serif "Good questions." then a two-panel card — deep-green question list (selected item highlighted) and an answer bubble panel with the product avatar.
10. Full-bleed blurred-photo band (rounded bottom): "You have a way with words. Now, two." + CTA. Then two product cards (Dictation / Notetaker).
11. Footer: four link columns, a **giant wordmark** spanning the width, legal + social.

## Motion inventory (computed)
- 146× `.pill-ch` spans: `transition: opacity .2s, transform .28s` — word-by-word chip text.
- 66× `.flow_w`: opacity .12s — filler-word highlighting in the editing demo.
- Logo ticker keyframes 40s; tabs/headings opacity+transform .4–.5s; arrow links transform .35s; FAQ rows background .2s.
- 13 Webflow interaction ids drive the scroll-linked sections; 86 elements carry inline transforms.

## What NoteFish keeps / swaps
Keep: the skeleton and every motion device above. Swap: type (DM Serif Display / DM Sans), palette (paper, ink, deep-sea navy, blue-tint CTA, puff accents), the curved-path sentence (the caller's French), the demo content (a live two-language call), testimonials → product artefacts from a real call (no invented people or logos), badges → product facts.
