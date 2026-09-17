# Third-party notices

Checked on 2026-09-12. This file records the illustration assets and selected UI components used by NoteFish. Other dependencies retain their own licenses in their packages; this is not a complete dependency license inventory.

## unDraw illustrations

Copyright 2026 Katerina Limpitsouni. License: [official unDraw license](https://undraw.co/license), checked on 2026-09-12.

| Title | Local file | Official download | Original SVG size |
| --- | --- | --- | --- |
| Audio conversation | [undraw-audio-conversation.svg](../web/assets/undraw-audio-conversation.svg) | [Official CDN SVG](https://cdn.undraw.co/illustrations/audio-conversation_zg3f.svg) | 14,500 bytes; viewBox 0 0 922 383.58267 |
| Recording | [undraw-recording.svg](../web/assets/undraw-recording.svg) | [Official CDN SVG](https://cdn.undraw.co/illustration/recording_1q6x.svg) | 7,209 bytes; viewBox 0 0 799.546 398.675 |

Both were selected from the official [voice illustration search](https://undraw.co/search/voice). The downloaded SVG files are unchanged. For a monochrome appearance, apply CSS `filter: grayscale(1)` to the decorative images; use an empty alternative text when adjacent text already supplies their meaning.

The license permits free commercial and noncommercial decorative project use, including modification, without attribution or permission. It excludes competing illustration services, asset-pack redistribution and unapproved integrations. It expressly prohibits AI/ML training, fine-tuning, development, datasets, validation and testing without separate written permission. These files are decorative website artwork only: they are not voice samples, model inputs, training data or evaluation material. The linked official license governs their use.

## UI component sources and package versions

| Component or dependency | Source and license | Use in NoteFish |
| --- | --- | --- |
| shadcn/ui | [Repository](https://github.com/shadcn-ui/ui); [LICENSE.md](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md), MIT; copyright 2023 shadcn | Accessible composition patterns adapted in `web/components/ui.jsx`; local CSS |
| Motion Primitives, Animated Background | [Source](https://github.com/ibelick/motion-primitives/blob/main/components/core/animated-background.tsx); [LICENCE.md](https://github.com/ibelick/motion-primitives/blob/main/LICENCE.md), MIT; copyright 2024 ibelick | Adapted in `web/components/animated-background.jsx` |
| Motion 13.2.0 and framer-motion 13.2.0 | [Repository](https://github.com/motiondivision/motion); installed `LICENSE.md`, MIT; copyright 2024 Motion B.V. | Interface animation |
| Radix Primitives: react-dialog 1.1.23, react-dropdown-menu 2.1.24, react-tabs 1.1.21, react-tooltip 1.2.16 | [Repository](https://github.com/radix-ui/primitives); installed package `LICENSE`, MIT; copyright 2022 WorkOS | Accessible dialogs, menus, tabs and tooltips |
| lucide-react 0.468.0 | [Repository](https://github.com/lucide-icons/lucide); installed `LICENSE`, ISC with the stated Feather provenance | Interface icons |

Motion Primitives source and license filenames were verified through the official GitHub API. The Animated Background source Git blob is `ae0a1ffc5b375ee59744089c83527cdbe6acec8b`; its license blob is `1a911b3bb726a0ceb00a6270853fdab52dff598d`. The original source was downloaded for adaptation reference. The shadcn/ui license Git blob is `fad4d887a681dd49233e5ed01ee2c7a1513089a0`.

## MIT notices

The following copyright notices apply to their respective components listed above. The common MIT permission and warranty text below is reproduced for each of those components collectively.

- shadcn/ui: Copyright (c) 2023 shadcn
- Motion Primitives: Copyright (c) 2024 ibelick
- Motion and framer-motion: Copyright (c) 2024 [Motion](https://motion.dev) B.V.
- Radix Primitives: Copyright (c) 2022 WorkOS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Lucide notice

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
