#!/usr/bin/env python3
"""NoteFish design artboards, structured 1:1 after the reference screenshot:
a 1000x622 desktop window, 158px sidebar, inset content sheet, document column
of 535px with title / date / tabs / read bar / body / ask input.
Colours and type are NoteFish's own tokens from web/styles.css."""
import pathlib

OUT = pathlib.Path(__file__).parent

# ---- NoteFish tokens (web/styles.css) ----
PAPER, PANEL, CARD = "#FAF9F7", "#F3F2EF", "#FEFDFC"
LINE, INK, MUTED = "#D8D6D1", "#242424", "#66645F"
GREEN, RED, AMBER = "#386149", "#A53332", "#815A25"
NAVTEXT, AVATAR_BG = "#5C5A55", "#E6E4DE"
SHEET, SHEET_LINE, NAV_ACTIVE, BAR = "#FCFBFA", "#E8E6E1", "#ECEBE8", "#F1F0ED"
SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
SERIF = "'DM Serif Display', Georgia, serif"

def tpl(s, **kw):
    for k, v in kw.items():
        s = s.replace("[[" + k + "]]", str(v))
    return s

# ---- icons: stroke-based, one style, 24 grid ----
PATHS = {
    "audio": '<path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4"/>',
    "mic": '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>',
    "mic-off": '<path d="m2 2 20 20M18.9 13.6A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M12 19v3M8 22h8"/><path d="M15 9.3V5a3 3 0 0 0-5.9-.7M9 9v3a3 3 0 0 0 5.1 2.1"/>',
    "disc": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
    "chart": '<path d="M3 3v18h18"/><path d="M8 17V9M13 17V5M18 17v-7"/>',
    "book": '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    "quote": '<path d="M3 21c3 0 7-1 7-8V5c0-1.3-1-2-2-2H4c-1 0-2 .7-2 2v6c0 1.3 1 2 2 2h3M15 21c3 0 7-1 7-8V5c0-1.3-1-2-2-2h-4c-1 0-2 .7-2 2v6c0 1.3 1 2 2 2h3"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    "gift": '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    "help": '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    "panel-left": '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
    "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    "user-circle": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3.2"/><path d="M6.2 18.8a6.5 6.5 0 0 1 11.6 0"/>',
    "chev-left": '<path d="m15 18-6-6 6-6"/>',
    "chev-right": '<path d="m9 18 6-6-6-6"/>',
    "chev-down": '<path d="m6 9 6 6 6-6"/>',
    "more": '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    "share": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    "link": '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    "expand": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M15 5v14"/>',
    "lightbulb": '<path d="M9 18h6M10 22h4"/><path d="M15.1 14a5.7 5.7 0 0 0 1.9-4.3 5 5 0 0 0-10 0c0 1.7.7 3.2 1.9 4.3.6.6 1.1 1.4 1.1 2.3V17h4v-.7c0-.9.5-1.7 1.1-2.3z"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "plus": '<path d="M5 12h14M12 5v14"/>',
    "send": '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    "phone": '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.8 2z"/>',
    "phone-off": '<path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.8 2v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1M5.2 8.6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9"/><path d="M23 1 1 23"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    "play": '<path d="m6 3 14 9-14 9V3z"/>',
    "pause": '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    "volume": '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    "globe": '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    "trash": '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    "monitor": '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    "x": '<path d="M18 6 6 18M6 6l12 12"/>',
    "zap": '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    "arrow-right": '<path d="M5 12h14M12 5l7 7-7 7"/>',
}

def icon(name, size=16, color="currentColor", sw="1.65"):
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>'
            % (size, size, color, sw, PATHS[name]))


# ---- avatars made of dashes: a silhouette sampled into vertical bars ----
import math
SHAPES = ["round", "squircle", "square", "wide", "triangle", "hexagon", "cloud", "drop"]
SWATCHES = [("ink", "#242424"), ("brown", "#7A4E2D"), ("red", "#C43B36"), ("orange", "#E2732A"), ("amber", "#E7A72F"), ("green", "#3C8A4E"),
            ("teal", "#2E9E86"), ("blue", "#2F6FE0"), ("purple", "#7D4FE0"), ("pink", "#D63F8C"), ("gray", "#7A7A7A")]

def silhouette(shape, x):
    """top and bottom edge (0..1) of the shape at horizontal position x (0..1)."""
    u = abs(2 * x - 1)
    if shape == "round":
        h = math.sqrt(max(0.0, 1 - u * u)); return 0.5 - h / 2, 0.5 + h / 2
    if shape == "squircle":
        h = (max(0.0, 1 - u ** 4)) ** 0.25; return 0.5 - h / 2, 0.5 + h / 2
    if shape == "square":
        h = (max(0.0, 1 - u ** 12)) ** (1 / 12); return 0.5 - h / 2, 0.5 + h / 2
    if shape == "wide":
        h = 0.66 * (max(0.0, 1 - u ** 8)) ** (1 / 8); return 0.5 - h / 2, 0.5 + h / 2
    if shape == "triangle":
        return 0.06 + 0.86 * (u ** 1.2), 0.97
    if shape == "hexagon":
        h = min(1.0, 1.9 * (1 - u)); return 0.5 - h / 2, 0.5 + h / 2
    if shape == "cloud":
        top = 0.34 - 0.22 * abs(math.sin(math.pi * x * 3)) - 0.04 * (1 - u * u)
        return max(0.04, top), 0.9 - 0.1 * u ** 2
    if shape == "drop":
        return 0.03 + 0.62 * (u ** 1.4), 0.5 + 0.48 * math.sqrt(max(0.0, 1 - u * u))
    raise KeyError(shape)

BOTTOM_ALIGNED = {"triangle", "drop", "cloud"}

def bar_blob(shape, color, size=64, eyes=True, envelope=None, n=None):
    """A creature built from a few thick pill dashes. The silhouette sets each
    dash's height; the eyes are gaps cut into the two dashes beside the centre.
    `envelope` (0..1 per dash) shapes the dashes by loudness instead — the
    'from my voice' avatar."""
    n = n or (7 if size >= 48 else 5)
    pitch = size / n
    bw = pitch * 0.72
    bars = []
    for i in range(n):
        x = (i + 0.5) / n
        if envelope:
            a = envelope[i % len(envelope)]
            top, bottom = 0.5 - 0.48 * a, 0.5 + 0.48 * a
        else:
            top, bottom = silhouette(shape, x)
        bars.append((i * pitch + (pitch - bw) / 2, top * size, bottom * size))
    box_top = min(b[1] for b in bars); box_bottom = max(b[2] for b in bars)
    eye_y = box_top + (0.58 if shape in BOTTOM_ALIGNED and not envelope else 0.36) * (box_bottom - box_top)
    eh = size * 0.15
    eye_bars = {n // 2 - 1, n // 2 + 1}
    parts = []
    for i, (bx, y0, y1) in enumerate(bars):
        if y1 - y0 < bw: continue
        segments = [(y0, y1)]
        if eyes and i in eye_bars and y0 < eye_y - eh / 2 - bw * 0.6 and y1 > eye_y + eh / 2 + bw * 0.6:
            segments = [(y0, eye_y - eh / 2), (eye_y + eh / 2, y1)]
        for a, b in segments:
            parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" fill="%s"/>' % (bx, a, bw, b - a, bw / 2, color))
    return '<svg width="%d" height="%d" viewBox="0 0 %d %d" aria-hidden="true">%s</svg>' % (size, size, size, size, "".join(parts))
# ---- document shell ----
HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&amp;family=DM+Serif+Display&amp;display=swap">
  <style>
    body { margin: 0; font-family: [[SANS]]; color: [[INK]]; background: [[PAPER]]; font-size: 13px; -webkit-font-smoothing: antialiased; }
    * { box-sizing: border-box; }
    h1, h2, h3, p, ul { margin: 0; }
    a { color: [[INK]]; text-decoration: none; } a:hover { color: #77736B; }
    svg { vertical-align: middle; flex-shrink: 0; }
  </style>
</helmet>
"""
TAIL = """</x-dc>
</body>
</html>
"""

def doc(body):
    return tpl(HEAD, SANS=SANS, INK=INK, PAPER=PAPER) + body + TAIL


# ---- soft avatars: organic silhouette, depth, ribbing that fades to the edge ----
def _hex(c): c = c.lstrip("#"); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
def _mix(c, t, k):
    a = _hex(c); b = _hex(t); return "#%02X%02X%02X" % tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(3))
def lighten(c, k): return _mix(c, "#FFFFFF", k)
def darken(c, k): return _mix(c, "#000000", k)

_WOBBLE = [1.00, 1.03, 0.98, 1.02, 0.97, 1.04, 0.99, 1.01, 0.98, 1.03, 1.00, 0.97]
def _radius(shape, th):
    sn, cs = math.sin(th), math.cos(th)
    if shape == "round": return 44
    if shape == "tall": return 44 / math.sqrt((cs / 0.78) ** 2 + (sn / 1.12) ** 2)
    if shape == "wide": return 44 / math.sqrt((cs / 1.14) ** 2 + (sn / 0.7) ** 2)
    if shape == "squarish": return 40 / (abs(cs) ** 4.5 + abs(sn) ** 4.5) ** (1 / 4.5)
    if shape == "pear": return 37 + 12 * max(0.0, sn) ** 1.3 - 6 * max(0.0, -sn) ** 1.2
    if shape == "bean": return 43 + 5 * math.cos(2 * th + 0.6) - 10 * max(0.0, math.cos(th + 2.2)) ** 4
    if shape == "cloud": return 36 + 9 * abs(math.cos(2.5 * th + 0.4)) + 3 * max(0.0, sn)
    if shape == "drop": return 38 + 15 * max(0.0, -sn) ** 3 + 4 * max(0.0, sn)
    raise KeyError(shape)

def organic_path(shape, n=12):
    pts = []
    for k in range(n):
        th = 2 * math.pi * k / n
        r = _radius(shape, th) * _WOBBLE[k % len(_WOBBLE)]
        pts.append((50 + r * math.cos(th), 51 + r * math.sin(th)))
    d = ["M%.1f,%.1f" % pts[0]]
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append("C%.1f,%.1f %.1f,%.1f %.1f,%.1f" % (c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]))
    return " ".join(d) + " Z"

SOFT_SHAPES = ["round", "tall", "wide", "squarish", "pear", "bean", "cloud", "drop"]
_sid = [0]

def blob_soft(shape, color, size=64, eyes=True):
    _sid[0] += 1; u = "s%d" % _sid[0]
    path = organic_path(shape)
    light, deep, rib = lighten(color, 0.28), darken(color, 0.22), darken(color, 0.38)
    dy = {"pear": 3, "drop": 6, "cloud": 2}.get(shape, 0)
    ribs = "".join('<rect x="%.1f" y="0" width="3.4" height="100" rx="1.7" fill="%s"/>' % (x, rib) for x in [8 + i * 8.4 for i in range(11)])
    ink = "#141414" if color != "#F1EEE7" else "#2A2A2A"
    face = ""
    if eyes:
        ey = 45 + dy
        face = ('<g transform="rotate(-7 41 %d)"><rect x="38.6" y="%d" width="4.8" height="13" rx="2.4" fill="%s"/><circle cx="40" cy="%d" r="1.2" fill="#FFF" fill-opacity=".75"/></g>'
                '<g transform="rotate(7 59 %d)"><rect x="56.6" y="%d" width="4.8" height="13" rx="2.4" fill="%s"/><circle cx="58" cy="%d" r="1.2" fill="#FFF" fill-opacity=".75"/></g>'
                % (ey, ey - 6, ink, ey - 3, ey, ey - 6, ink, ey - 3))
    return tpl("""<svg width="[[S]]" height="[[S]]" viewBox="0 0 100 100" aria-hidden="true">
<defs>
  <clipPath id="[[U]]c"><path d="[[PATH]]"/></clipPath>
  <linearGradient id="[[U]]g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="[[LIGHT]]"/><stop offset=".55" stop-color="[[COLOR]]"/><stop offset="1" stop-color="[[DEEP]]"/></linearGradient>
  <radialGradient id="[[U]]m" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="#FFF"/><stop offset=".45" stop-color="#FFF"/><stop offset="1" stop-color="#000"/></radialGradient>
  <mask id="[[U]]k"><rect width="100" height="100" fill="url(#[[U]]m)"/></mask>
  <radialGradient id="[[U]]h" cx=".32" cy=".26" r=".5"><stop offset="0" stop-color="#FFF" stop-opacity=".55"/><stop offset="1" stop-color="#FFF" stop-opacity="0"/></radialGradient>
  <filter id="[[U]]n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix type="saturate" values="0"/></filter>
</defs>
<g clip-path="url(#[[U]]c)">
  <rect width="100" height="100" fill="url(#[[U]]g)"/>
  <g mask="url(#[[U]]k)" opacity=".26">[[RIBS]]</g>
  <rect width="100" height="100" fill="url(#[[U]]h)"/>
  <rect width="100" height="100" filter="url(#[[U]]n)" opacity=".13"/>
</g>
[[FACE]]
</svg>""", S=size, U=u, PATH=path, LIGHT=light, COLOR=color, DEEP=deep, RIBS=ribs, FACE=face).replace("\n", "")


# ---- waveform avatars: the bars are the art. No blob, no face. ----
def _profile(name, n):
    out = []
    for k in range(n):
        i = k - (n - 1) / 2; t = i / ((n - 1) / 2)          # t in -1..1
        if name == "bell": a = math.exp(-(t / 0.45) ** 2)
        elif name == "pulse": a = math.exp(-(t / 0.22) ** 2) + 0.1
        elif name == "twin": a = max(math.exp(-((t - 0.5) / 0.26) ** 2), math.exp(-((t + 0.5) / 0.26) ** 2)) + 0.08
        elif name == "plateau": a = 1.0 if abs(t) <= 0.42 else (0.42 if abs(t) <= 0.65 else 0.2)
        elif name == "rising": a = 0.12 + 0.88 * ((t + 1) / 2) ** 1.3
        elif name == "echo": a = 0.14 + 0.86 * math.exp(-((t + 1) / 0.62))
        elif name == "ripple": a = 0.95 if k % 2 == 0 else 0.34
        elif name == "burst": a = [0.3, 0.72, 0.45, 0.95, 0.58, 1.0, 0.5, 0.86, 0.4, 0.76, 0.3, 0.62, 0.36, 0.8, 0.28][k % 15]
        else: raise KeyError(name)
        out.append(min(1.0, max(0.14, a)))
    return out

PROFILES = ["bell", "pulse", "twin", "plateau", "rising", "echo", "ripple", "burst"]
_wid = [0]

def wave_glyph(profile, color, w=64, h=64, n=None, envelope=None):
    """Symmetric bars around the midline, lit from above by a single gradient."""
    _wid[0] += 1; u = "w%d" % _wid[0]
    n = n or (13 if w >= 100 else 11 if w >= 56 else 9)
    heights = envelope if envelope else _profile(profile, n)
    pitch = w / n; bw = pitch * 0.56
    top, mid, deep = lighten(color, 0.38), color, darken(color, 0.28)
    bars = []
    for k, a in enumerate(heights):
        bh = max(bw, a * h * 0.94)
        bars.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" fill="url(#%sg)"/>' % (k * pitch + (pitch - bw) / 2, (h - bh) / 2, bw, bh, bw / 2, u))
    return ('<svg width="%d" height="%d" viewBox="0 0 %d %d" aria-hidden="true"><defs><linearGradient id="%sg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="%d"><stop offset="0" stop-color="%s"/><stop offset=".5" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>%s</svg>'
            % (w, h, w, h, u, h, top, mid, deep, "".join(bars)))


# ---- Puff: the chosen avatar. A fluffy circle of bumps, dot eyes, a small smile. ----
PUFFS = ["fish", "puff", "cloud", "sheep", "bloom", "tuft", "pom", "squish"]
def _ring(n, ring_x, ring_y, r, cy=51, start=0.0, rfn=None):
    out = []
    for k in range(n):
        a = start + 2 * math.pi * k / n
        rr = rfn(a) if rfn else r
        out.append((50 + ring_x * math.cos(a), cy + ring_y * math.sin(a), rr))
    return out
def _puff_parts(v):
    """(bumps, cores, face_dy). Cores are drawn after bumps so the interior is solid."""
    if v == "fish":
        body = [(42 + 25 * math.cos(a), 51 + 23 * math.sin(a), 14) for a in [2 * math.pi * k / 8 for k in range(8)]]
        tail = [(80, 36, 12), (80, 66, 12), (71, 51, 11)]
        return body + tail, [("e", 42, 51, 30, 26)], 0
    if v == "puff": return _ring(8, 26, 26, 17), [("c", 50, 51, 30)], 0
    if v == "cloud":
        top = [(50 + 25 * math.cos(math.radians(a)), 50 + 25 * math.sin(math.radians(a)), 16 if a != 270 else 19) for a in (200, 235, 270, 305, 340)]
        return top, [("c", 50, 56, 30), ("c", 27, 62, 15), ("c", 73, 62, 15)], 6
    if v == "sheep": return _ring(12, 30, 30, 11), [("c", 50, 51, 32)], 0
    if v == "bloom": return _ring(6, 25, 25, 19, start=-math.pi / 2), [("c", 50, 51, 26)], 0
    if v == "tuft": return _ring(8, 26, 26, 17) + [(41, 13, 7), (50, 8, 7.5), (59, 13, 7)], [("c", 50, 52, 30)], 1
    if v == "pom": return _ring(16, 34, 34, 8.5), [("c", 50, 51, 36)], 0
    if v == "squish": return _ring(8, 33, 22, 15), [("e", 50, 51, 36, 26)], 0
    if v == "pear": return _ring(8, 26, 27, 13, cy=53, rfn=lambda a: 12 + 7 * max(0.0, math.sin(a))), [("c", 50, 55, 28)], 4
    raise KeyError(v)

def puff(variant, color, size=64, face=True):
    bumps, cores, dy = _puff_parts(variant)
    parts = ["".join('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (x, y, r, color) for x, y, r in bumps)]
    for c in cores:
        parts.append('<circle cx="%d" cy="%d" r="%d" fill="%s"/>' % (c[1], c[2], c[3], color) if c[0] == "c" else '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="%s"/>' % (c[1], c[2], c[3], c[4], color))
    if face:
        eye = "#F3F1EC" if color == "#242424" else "#1B1B1B"; ey = 48 + dy; cx = 42 if variant == "fish" else 50
        parts.append('<circle cx="%d" cy="%d" r="2.8" fill="%s"/><circle cx="%d" cy="%d" r="2.8" fill="%s"/><path d="M%d,%d Q%d,%d %d,%d" fill="none" stroke="%s" stroke-width="2.4" stroke-linecap="round"/>' % (cx - 8, ey, eye, cx + 8, ey, eye, cx - 5, ey + 9, cx, ey + 12, cx + 5, ey + 9, eye))
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s</svg>' % (size, size, "".join(parts))


# ---- the logo: the fish puff on a tile, slit eyes cut out ----
def _fish_body(color):
    bumps, cores, _ = _puff_parts("fish")
    out = "".join('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (x, y, r, color) for x, y, r in bumps)
    for c in cores:
        out += '<circle cx="%d" cy="%d" r="%d" fill="%s"/>' % (c[1], c[2], c[3], color) if c[0] == "c" else '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="%s"/>' % (c[1], c[2], c[3], c[4], color)
    return out

def logo_mark(size=24, tile=True, fg="#F3F1EC", bg="#242424", radius=26):
    slits = ('<g transform="rotate(-9 34 47)"><rect x="31.4" y="40" width="5.2" height="14" rx="2.6" fill="%s"/></g>'
             '<g transform="rotate(9 50 47)"><rect x="47.4" y="40" width="5.2" height="14" rx="2.6" fill="%s"/></g>' % (bg, bg))
    fish = '<g transform="translate(8 9) scale(.84)">%s%s</g>' % (_fish_body(fg), slits)
    base = ('<rect width="100" height="100" rx="%d" fill="%s"/>' % (radius, bg)) if tile else ""
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s%s</svg>' % (size, size, base, fish)

# ---- the window: traffic lights, 158px sidebar, inset sheet ----
NAV = [("desk", "Desk", "mic"), ("calls", "Calls", "disc"), ("insights", "Insights", "chart"), ("glossary", "Glossary", "book"),
       ("phrases", "Phrases", "quote"), ("voice", "Voice", "audio"), ("floor", "Floor", "users")]
BOTTOM = [("free", "Get a free month", "gift"), ("settings", "Settings", "settings"), ("help", "Help", "help")]

def nav_row(label, ico, active):
    bg = ("background: %s; color: %s; font-weight: 600;" % (NAV_ACTIVE, INK)) if active else ("color: %s; font-weight: 500;" % NAVTEXT)
    return '<a href="#" style="display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 8px; border-radius: 8px; font-size: 13px; letter-spacing: -.1px; white-space: nowrap; %s">%s<span>%s</span></a>' % (bg, icon(ico, 16), label)

def window(active, sheet_inner, overlay=""):
    nav = "".join(nav_row(l, i, k == active) for k, l, i in NAV)
    bottom = "".join(nav_row(l, i, k == active) for k, l, i in BOTTOM)
    return doc(tpl("""<div style="position: relative; width: 1000px; height: 622px; background: [[PAPER]]; overflow: hidden;">
  <div style="position: absolute; left: 20px; top: 16px; display: flex; gap: 8px;"><span style="width: 12px; height: 12px; border-radius: 50%; background: #FF5F57;"></span><span style="width: 12px; height: 12px; border-radius: 50%; background: #FEBC2E;"></span><span style="width: 12px; height: 12px; border-radius: 50%; background: #28C840;"></span></div>
  <span style="position: absolute; left: 68px; top: 12px; color: [[NAVTEXT]];">[[PANEL]]</span>
  <div style="position: absolute; right: 22px; top: 10px; display: flex; align-items: center; gap: 14px; color: [[NAVTEXT]];">[[BELL]][[USER]]</div>
  <aside style="position: absolute; left: 0; top: 0; width: 158px; height: 622px; padding: 44px 8px 14px; display: flex; flex-direction: column;">
    <div style="display: flex; align-items: center; gap: 7px; padding: 0 10px; height: 24px; margin-bottom: 14px; font-size: 19px; font-weight: 650; letter-spacing: -.6px;">[[MARK]]<span>NoteFish<span style="color: #77736B;">.</span></span></div>
    <div style="display: flex; align-items: center; gap: 8px; margin: 0 2px 14px; padding: 6px 8px; border-radius: 10px; background: [[SHEET]]; border: 1px solid [[SHEET_LINE]];">[[SEAT]]<div style="flex: 1; min-width: 0;"><strong style="display: block; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Nina Okafor</strong><span style="display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: [[GREEN]];"><span style="width: 5px; height: 5px; border-radius: 50%; background: [[GREEN]];"></span>On the floor</span></div></div>
    <nav style="display: flex; flex-direction: column; gap: 0;">[[NAV]]</nav>
    <nav style="display: flex; flex-direction: column; gap: 0; margin-top: auto;">[[BOTTOM]]</nav>
  </aside>
  <section style="position: absolute; left: 158px; top: 38px; width: 844px; height: 600px; background: [[SHEET]]; border: 1px solid [[SHEET_LINE]]; border-radius: 12px 0 0 0; overflow: hidden; display: flex; flex-direction: column;">
[[INNER]]
  </section>
[[OVERLAY]]
</div>
""", OVERLAY=overlay, SEAT=puff("fish", "#2F6FE0", 26), GREEN=GREEN, PAPER=PAPER, NAVTEXT=NAVTEXT, PANEL=icon("panel-left", 16), BELL=icon("bell", 16), USER=icon("user-circle", 18),
        MARK=logo_mark(22), NAV_ACTIVE=NAV_ACTIVE, MUTED=MUTED, NAV=nav, BOTTOM=bottom, SHEET=SHEET, SHEET_LINE=SHEET_LINE, INNER=sheet_inner))

# ---- document pieces, in the reference's rhythm ----
def toolbar(back=True, right=("more", "share", "link", "chev-left", "chev-right", "expand")):
    left = ('<span style="display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: %s;">%s</span>' % (BAR, icon("chev-left", 16))) if back else '<span></span>'
    parts = []
    for name in right:
        if name == "share":
            parts.append('<span style="display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 8px; background: %s; font-size: 13px; font-weight: 500;">%sShare</span>' % (BAR, icon("share", 14)))
        elif name == "link":
            parts.append('<span style="display: grid; place-items: center; width: 34px; height: 30px; border-radius: 8px; background: %s;">%s</span>' % (BAR, icon("link", 15)))
        else:
            parts.append('<span style="display: grid; place-items: center; width: 30px; height: 30px; color: %s;">%s</span>' % (NAVTEXT, icon(name, 16)))
    return '<div style="height: 60px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 38px 0 38px;">%s<div style="display: flex; align-items: center; gap: 4px;">%s</div></div>' % (left, "".join(parts))

def column(inner, extra=""):
    return '<div style="width: 535px; margin: 0 auto; %s">%s</div>' % (extra, inner)

def title(text, date):
    return column('<h1 style="font: 400 29px/1.2 %s; letter-spacing: -.6px;">%s</h1><p style="font-size: 13px; color: %s; margin-top: 8px;">%s</p>' % (SERIF, text, MUTED, date))

def tabs(items):
    """items: [(label, active, plus)] — the row's rule spans the whole sheet like the reference."""
    out = []
    for label, active, plus in items:
        p = (icon("plus", 13) + " ") if plus else ""
        out.append('<span style="display: inline-flex; align-items: center; gap: 4px; padding: 0 0 10px; font-size: 15px; font-weight: %s; color: %s; border-bottom: 2px solid %s; margin-bottom: -1px;">%s%s</span>' % ("600" if active else "500", INK if active else NAVTEXT, INK if active else "transparent", p, label))
    return '<div style="border-bottom: 1px solid %s; margin-top: 18px; flex-shrink: 0;">%s</div>' % (SHEET_LINE, column('<div style="display: flex; gap: 18px;">%s</div>' % "".join(out)))

def readbar(left, right_icons=("search", "copy")):
    icons = "".join('<span style="color: %s;">%s</span>' % (NAVTEXT, icon(i, 15)) for i in right_icons)
    return column('<div style="display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 12px; border-radius: 8px; background: %s;"><span style="display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; letter-spacing: 1.4px; color: %s;">%s</span><span style="display: flex; align-items: center; gap: 14px;">%s</span></div>' % (BAR, MUTED, left, icons), extra="margin-top: 18px; flex-shrink: 0;")

def ask(placeholder="Ask anything"):
    return column('<div style="display: flex; align-items: center; height: 36px; padding: 0 5px 0 16px; border: 1px solid %s; border-radius: 999px; background: %s;"><span style="flex: 1; font-size: 15px; color: #8F8B83;">%s</span><span style="display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%%; background: %s; color: #FFF;">%s</span></div>' % (LINE, CARD, placeholder, INK, icon("send", 12, "#FFF")), extra="margin: auto auto 22px; flex-shrink: 0;")

def body(inner):
    return column(inner, extra="margin-top: 28px; font-size: 16px; line-height: 1.6; flex: 1; min-height: 0; overflow: hidden;")

def h3(text):
    return '<h3 style="font-size: 16px; font-weight: 700; margin: 22px 0 8px;">%s</h3>' % text

def ul(items):
    return '<ul style="padding-left: 22px; display: flex; flex-direction: column; gap: 6px;">%s</ul>' % "".join('<li>%s</li>' % i for i in items)

def sub_ul(items):
    return '<ul style="list-style: square; padding-left: 22px; margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">%s</ul>' % "".join('<li>%s</li>' % i for i in items)

def mention(name):
    return '<span style="color: %s;">%s</span>' % (AMBER, name)

def chip(text, tone="muted"):
    color = {"muted": MUTED, "green": GREEN, "red": RED, "amber": AMBER}[tone]
    return '<span style="display: inline-block; padding: 2px 8px; border-radius: 999px; background: %s; color: %s; font-size: 11px; font-weight: 600;">%s</span>' % (BAR, color, text)

def row(main, sub, right="", ico=None, lead=None):
    left = lead if lead else (('<span style="display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: %s; color: %s;">%s</span>' % (BAR, NAVTEXT, icon(ico, 14))) if ico else "")
    return '<div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px dashed %s;">%s<div style="flex: 1; min-width: 0;"><strong style="display: block; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">%s</strong><span style="display: block; font-size: 12px; color: %s; margin-top: 2px;">%s</span></div>%s</div>' % (SHEET_LINE, left, main, MUTED, sub, right)

def dot(tone):
    return '<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%%; background: %s;"></span>' % {"green": GREEN, "red": RED, "amber": AMBER, "muted": "#918C81"}[tone]

def status(text, tone):
    return '<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: %s; white-space: nowrap;">%s%s</span>' % ({"green": GREEN, "red": RED, "amber": AMBER, "muted": MUTED}[tone], dot(tone), text)

def wave(color="#FFF", h=14):
    bars = "".join('<span style="display: block; width: 2.5px; height: %dpx; border-radius: 2px; background: %s;"></span>' % (hh, color) for hh in [5, 10, 14, 8, 12, 6])
    return '<span style="display: flex; align-items: center; gap: 2.5px; height: %dpx;">%s</span>' % (h, bars)

def pill(inner):
    return '<div style="display: inline-flex; align-items: center; gap: 10px; height: 40px; padding: 0 16px 0 10px; border-radius: 999px; background: #242424; color: #FFF; box-shadow: 0 10px 30px rgba(36,36,36,.28), inset 0 0 0 1px rgba(255,255,255,.08); font: 500 13px/1 %s; white-space: nowrap;">%s%s</div>' % (SANS, puff("fish", "#F3F1EC", 22, face=False), inner)

# =====================================================================
# Main — a call record (the reference page)
# =====================================================================
def main_screen():
    inner = (toolbar()
        + title("Delivery running late", "Sep 16, 2026, 10:14 AM · 4 min 12 s")
        + tabs([("Notes", False, False), ("Transcript", False, False), ("Summary", True, True)])
        + readbar(icon("lightbulb", 14) + "1 MIN READ")
        + body('<p>Marie Dubois called about order 4821, which had not arrived by 10:00. The driver was two stops away; she agreed to wait fifteen minutes and asked to be called back if it slips again.</p>'
               + h3("What was agreed")
               + ul(["Driver is two stops away; arrival expected around 10:30.",
                     "Marie will wait at the downstairs door." + sub_ul(["The buzzer is broken; the driver should call on arrival."]),
                     "If the delivery slips past 10:45, call her back on the same number."])
               + h3("Follow-up")
               + ul([mention("Nina O.") + " noted the broken buzzer on the address so the next driver knows.",
                     "Ticket #4821 sent to Zendesk at 10:19 with the transcript and summary."]))
        + ask())
    return window("calls", inner)

# =====================================================================
# Desk — the live call (Dictation's slot)
# =====================================================================
def line(who, big, small, when, agent=False, played=None):
    tag = (' <span style="font-size: 10px; padding: 2px 5px; border-radius: 4px; background: %s; color: %s;">%s</span>' % (BAR, GREEN if played == "Played to caller" else MUTED, played)) if played else ""
    return ('<div style="padding: 0 0 14px; margin-bottom: 14px; border-bottom: 1px dashed %s;"><div style="display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 5px;"><strong style="font-weight: 600; color: %s;">%s</strong>%s<span style="margin-left: auto; color: %s; font-size: 11px;">%s</span></div><p style="font-size: 16px; line-height: 1.5;">%s</p><p style="font-size: 12px; line-height: 1.5; color: %s; margin-top: 3px;"><span style="font-weight: 600; margin-right: 6px;">FR</span>%s</p></div>'
            % (LINE, AMBER if agent else INK, who, tag, MUTED, when, big, MUTED, small))

def desk_screen(holding=False):
    # one quiet strip, in the read-bar's clothes: state on the left, language pair and line controls on the right
    state = ('%s<span style="margin-left: 6px;">RECORDING</span>' % dot("red")) if holding else ('%s<span style="margin-left: 6px;">LISTENING</span>' % dot("green"))
    lang = ('<span style="display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border-radius: 999px; background: %s; border: 1px solid %s; font-size: 12px; font-weight: 600; color: %s;">English<span style="color: %s;">→</span>French%s</span>'
            % (SHEET, SHEET_LINE, INK, MUTED, icon("chev-down", 12, NAVTEXT)))
    small_pill = lambda ico, label, color, bg, border: ('<button style="display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 8px; border-radius: 999px; border: 1px solid %s; background: %s; color: %s; font: 600 12px/1 %s; white-space: nowrap;">%s%s</button>'
                % (border, bg, color, SANS, icon(ico, 13, color), label))
    controls = ('<span style="display: flex; align-items: center; gap: 8px;">%s%s%s</span>'
                % (lang, small_pill("mic-off", "Mute", NAVTEXT, SHEET, SHEET_LINE), small_pill("phone-off", "End", "#982E2D", "#FFF6F4", "#DDBBB7")))
    strip = column('<div style="display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 12px; border-radius: 8px; background: %s;"><span style="display: flex; align-items: center; font-size: 11px; font-weight: 600; letter-spacing: 1.4px; color: %s;">%s</span>%s</div>'
                   % (BAR, RED if holding else GREEN, state, controls), extra="margin-top: 18px; flex-shrink: 0;")
    # how the next reply should sound: Auto lets the desk decide from the clip and the caller; a chosen feeling wins
    def sound_pill(label, on=False):
        return ('<button aria-pressed="%s" style="display: inline-flex; align-items: center; height: 26px; padding: 0 11px; border-radius: 999px; border: 1px solid %s; background: %s; color: %s; font: %s 12px/1 %s; white-space: nowrap;">%s</button>'
                % ('true' if on else 'false', INK if on else SHEET_LINE, INK if on else SHEET, '#FFF' if on else INK, 600 if on else 500, SANS, label))
    chosen = "Apologetic" if holding else "Auto"
    pills = "".join(sound_pill(label, label == chosen) for label in ["Auto", "Calm", "Warm", "Energetic", "Reassuring", "Apologetic", "Firm"])
    sound = column('<div style="display: flex; align-items: center; gap: 6px; height: 26px;"><span style="font-size: 10px; font-weight: 600; letter-spacing: 1.3px; color: %s; margin-right: 4px;">SOUND</span>%s</div>'
                   % (MUTED, pills), extra="margin-top: 12px; flex-shrink: 0;")
    # who is calling, in one quiet line: what happened last time, and a way back to it
    fact = lambda ico, text: '<span style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis;">%s%s</span>' % (icon(ico, 13, NAVTEXT), text)
    context = column('<div style="display: flex; align-items: center; gap: 18px; height: 22px; font-size: 12px; color: %s;">%s%s<a href="Main.dc.html" style="margin-left: auto; display: inline-flex; align-items: center; gap: 3px; color: %s; font-weight: 600; white-space: nowrap; flex-shrink: 0;">Open last call%s</a></div>'
                     % (MUTED, fact("phone", "2 earlier calls · last Sep 3"), fact("check-circle", "Last ticket · Delivery running late"), INK, icon("chev-right", 12, INK)),
                     extra="margin-top: 10px; flex-shrink: 0;")
    # captions as plain reading: label, line, the other language underneath, air between
    def cap(who, big, small, agent=False, played=False):
        tag = (' <span style="display: inline-flex; align-items: center; gap: 4px; color: %s; font-size: 11px; font-weight: 500;">%s played</span>' % (GREEN, icon("check", 11, GREEN, "2.4"))) if played else ""
        return ('<div><div style="font-size: 12px; font-weight: 600; color: %s; margin-bottom: 4px;">%s%s</div><p style="font-size: 16px; line-height: 1.5;">%s</p><p style="font-size: 12.5px; line-height: 1.5; color: %s; margin-top: 3px;">%s</p></div>'
                % (AMBER if agent else INK, who, tag, big, MUTED, small))
    live = ('' if holding else
            '<div><div style="display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Caller<span style="display: inline-flex; gap: 3px; align-items: center;"><span style="width: 4px; height: 4px; border-radius: 50%%; background: %s;"></span><span style="width: 4px; height: 4px; border-radius: 50%%; background: %s; opacity: .55;"></span><span style="width: 4px; height: 4px; border-radius: 50%%; background: %s; opacity: .25;"></span></span></div><p style="font-size: 16px; line-height: 1.5; color: %s;">Is the driver going to call before he…</p><p style="font-size: 12.5px; line-height: 1.5; color: %s; margin-top: 3px;">Est-ce que le chauffeur va appeler avant de…</p></div>'
            % (GREEN, GREEN, GREEN, NAVTEXT, MUTED))
    captions = '<div style="display: flex; flex-direction: column; justify-content: flex-end; gap: 16px; height: 100%%; -webkit-mask-image: linear-gradient(to bottom, transparent, #000 44px); mask-image: linear-gradient(to bottom, transparent, #000 44px);">%s</div>' % (
        cap("Caller", "Hello, I've been waiting for my delivery since this morning and nobody came.", "Bonjour, j'attends ma livraison depuis ce matin et personne n'est venu.")
        + cap("You", "I'm sorry about that. Can you give me the order number so I can check where the driver is?", "Je suis désolée. Pouvez-vous me donner le numéro de commande pour que je vérifie où est le chauffeur ?", agent=True, played=True)
        + cap("Caller", "It's 4 8 2 1, under the name Dubois.", "C'est le 4 8 2 1, au nom de Dubois.")
        + cap("You", "Thank you. The driver is two stops away, about fifteen minutes.", "Merci. Le chauffeur est à deux arrêts, environ quinze minutes.", agent=True, played=True)
        + live)
    # one pill composer: mic on the left, the field, the target language, send
    mic = '<span style="display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%%; background: %s; color: #FFF; flex-shrink: 0;">%s</span>' % (RED if holding else INK, icon("mic", 17, "#FFF"))
    field = ('<span style="flex: 1; display: flex; align-items: center; gap: 10px; font-size: 15px; color: %s;">%s<span>Speak — release to send</span></span>' % (INK, wave(RED, 16))
             if holding else '<span style="flex: 1; font-size: 15px; color: #8F8B83;">Type in English, or hold the mic to speak</span>')
    quick = lambda text: ('<button style="display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px 0 8px; border-radius: 999px; border: 1px solid %s; background: %s; color: %s; font: 500 12px/1 %s; white-space: nowrap;">%s%s</button>'
                          % (SHEET_LINE, SHEET, INK, SANS, icon("play", 10, NAVTEXT), text))
    quick_row = ('<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; overflow: hidden;"><span style="font-size: 10px; font-weight: 600; letter-spacing: 1.3px; color: %s; flex-shrink: 0; margin-right: 2px;">QUICK</span>%s%s%s</div>'
                 % (MUTED, quick("One moment."), quick("Sending someone now."), quick("Repeat the address?")))
    composer = column(tpl("""
[[QUICK]]<div style="display: flex; align-items: center; gap: 12px; height: 54px; padding: 0 7px 0 7px; border: 1px solid [[LINE]]; border-radius: 999px; background: [[CARD]]; box-shadow: 0 8px 24px rgba(36,36,36,.06);">[[MIC]][[FIELD]]<span style="display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 999px; background: [[BAR]]; font-size: 11px; font-weight: 600; color: [[MUTED]]; white-space: nowrap;">→ FR</span><span style="display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: [[INK]]; color: #FFF;">[[SEND]]</span></div>
<p style="font-size: 11px; color: [[MUTED]]; text-align: center; margin-top: 9px;">[[HINT]]</p>""", LINE=SHEET_LINE, CARD=CARD, BAR=BAR, MUTED=MUTED, INK=INK, MIC=mic, FIELD=field, SEND=icon("send", 14, "#FFF"),
        HINT=("The caller hears French in your voice when you let go." if holding else "Hold ⌥ anywhere, or the mic. The caller hears French in your voice."), QUICK=quick_row),
        extra="margin-top: auto; padding-top: 14px; padding-bottom: 14px; flex-shrink: 0;")
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Marie Dubois", "Live · 04:12 · +33 6 12 34 56 78 · French, detected")
        + tabs([("Captions", True, False), ("Notes", False, False)])
        + strip
        + sound
        + context
        + column(captions, extra="margin-top: 14px; flex: 1; min-height: 0; overflow: hidden;")
        + composer)
    return window("desk", inner)

# =====================================================================
# Calls — the list
# =====================================================================
def calls_screen():
    rows = "".join([
        row("Delivery running late", "10:14 · Marie Dubois · FR → EN · 4:12 · Nina", status("Sent to Zendesk", "green"), lead=puff("fish", "#2F6FE0", 30)),
        row("Invoice question", "09:52 · +31 6 20 11 45 90 · NL → EN · 6:40 · Sam", status("Sent to Zendesk", "green"), lead=puff("puff", "#3C8A4E", 30)),
        row("Return label", "09:31 · +49 170 555 01 22 · DE → EN · 2:58 · Nina", status("Delivery failed", "red"), lead=puff("fish", "#2F6FE0", 30)),
        row("Missed", "09:07 · +34 612 33 44 55 · ES → EN · no agent free", status("Not answered", "muted"), lead=puff("cloud", "#9A958B", 30, face=False)),
        row("Address change", "08:48 · Léa Martin · FR → EN · 3:21 · Ines", status("Sent to Zendesk", "green"), lead=puff("bloom", "#D63F8C", 30)),
        row("Damaged parcel", "Yesterday 17:40 · +33 7 88 12 09 33 · FR → EN · 8:05 · Sam", status("Sent to Zendesk", "green"), lead=puff("puff", "#3C8A4E", 30)),
    ])
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Calls", "This week · 23 calls · 1 h 52 min translated")
        + tabs([("All", True, False), ("Mine", False, False), ("Needs attention", False, False)])
        + readbar(icon("search", 14) + '<span style="font-weight: 500; letter-spacing: 0; color: #8F8B83;">Search callers, words, or ticket numbers</span>', right_icons=())
        + body('<div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: %s; margin-bottom: 4px;">TODAY</div>%s' % (MUTED, rows))
        + ask("Ask about your calls"))
    return window("calls", inner)

# =====================================================================
# Insights
# =====================================================================
def insights_screen():
    def stat(n, label):
        return '<div style="padding: 14px 16px; border: 1px solid %s; border-radius: 10px;"><strong style="display: block; font: 400 26px/1.1 %s;">%s</strong><span style="font-size: 12px; color: %s;">%s</span></div>' % (SHEET_LINE, SERIF, n, MUTED, label)
    def bar(lang, pct):
        return '<div style="display: grid; grid-template-columns: 96px minmax(0, 1fr) 40px; align-items: center; gap: 12px; font-size: 13px;"><span>%s</span><span style="display: block; height: 8px; border-radius: 4px; background: %s; overflow: hidden;"><span style="display: block; width: %d%%; height: 100%%; background: %s;"></span></span><span style="text-align: right; color: %s; font-variant-numeric: tabular-nums;">%d%%</span></div>' % (lang, BAR, pct, INK, MUTED, pct)
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Insights", "Last 7 days · Sep 10 – 16")
        + tabs([("Overview", True, False), ("Languages", False, False), ("Agents", False, False)])
        + body('<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;">%s%s%s%s%s%s</div>' % (
                stat("142", "Calls answered"), stat("9 h 12 m", "Minutes translated"), stat("2.8 s", "Release to first audio"),
                stat("138", "Tickets delivered"), stat("6", "Languages served"), stat("4", "Waited over a minute"))
               + h3("Languages this week")
               + '<div style="display: flex; flex-direction: column; gap: 9px; margin-top: 4px;">%s</div>' % "".join([bar("French", 61), bar("Dutch", 18), bar("German", 11), bar("Spanish", 6), bar("Portuguese", 4)]))
        + ask("Ask about this week"))
    return window("insights", inner)

# =====================================================================
# Glossary — words that stay as written (Dictionary's slot)
# =====================================================================
def glossary_screen():
    rows = "".join([
        row("Dubois", "Caller surname · never translated", chip("Keep as written")),
        row("ParcelPoint", "Product name · never translated", chip("Keep as written")),
        row("Rue de la Paix 12", "Address · read digit by digit", chip("Keep as written")),
        row("delivery window", "Say in French as: créneau de livraison", chip("Translate as")),
        row("customer number", "Say in French as: numéro client", chip("Translate as")),
        row("Acme Logistics", "Company name · never translated", chip("Keep as written")),
    ])
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Glossary", "Words that stay exactly as written, in every language")
        + tabs([("All", True, False), ("Names", False, False), ("Products", False, False), ("Addresses", False, False)])
        + readbar(icon("plus", 14) + '<span style="font-weight: 500; letter-spacing: 0; color: #8F8B83;">Add a word or phrase</span>', right_icons=())
        + body(rows)
        + ask("Ask how a term will be said"))
    return window("glossary", inner)

# =====================================================================
# Phrases — saved replies (Snippets' slot)
# =====================================================================
def phrases_screen():
    def phrase(short, en, fr):
        return '<div style="padding: 12px 0; border-bottom: 1px solid %s;"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; background: %s; color: %s;">%s</span><strong style="font-size: 15px; font-weight: 600;">%s</strong></div><p style="font-size: 13px; color: %s; margin-top: 6px; padding-left: 2px;"><span style="font-size: 10px; font-weight: 600; margin-right: 6px;">FR</span>%s</p></div>' % (SHEET_LINE, BAR, INK, short, en, MUTED, fr)
    rows = "".join([
        phrase("eta", "Your delivery is on its way and should arrive within the hour.", "Votre livraison est en route et devrait arriver dans l'heure."),
        phrase("hold", "One moment please, I'm checking that for you.", "Un instant s'il vous plaît, je vérifie cela pour vous."),
        phrase("callback", "If anything changes, I'll call you back on this number.", "Si quelque chose change, je vous rappelle à ce numéro."),
        phrase("sorry", "I'm sorry for the trouble this has caused.", "Je suis désolée pour la gêne occasionnée."),
        phrase("close", "Is there anything else I can help you with today?", "Puis-je faire autre chose pour vous aujourd'hui ?"),
    ])
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Phrases", "Say the shortcut while holding ⌥. The full line is sent in your voice.")
        + tabs([("Mine", True, False), ("Workspace", False, False)])
        + readbar(icon("plus", 14) + '<span style="font-weight: 500; letter-spacing: 0; color: #8F8B83;">New phrase</span>', right_icons=())
        + body(rows)
        + ask("Ask for a phrase"))
    return window("phrases", inner)

# =====================================================================
# Voice — your clone and register (Style's slot)
# =====================================================================
def voice_screen():
    def option(label, desc, on):
        mark = ('<span style="display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%%; background: %s; color: #FFF;">%s</span>' % (INK, icon("check", 11, "#FFF", "2.4"))) if on else '<span style="width: 18px; height: 18px; border-radius: 50%%; border: 1px solid %s;"></span>' % LINE
        return '<div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid %s;">%s<div style="flex: 1;"><strong style="display: block; font-size: 15px; font-weight: 600;">%s</strong><span style="font-size: 12px; color: %s;">%s</span></div></div>' % (SHEET_LINE, mark, label, MUTED, desc)
    card = tpl("""<div style="display: flex; align-items: center; gap: 14px; padding: 16px; border: 1px solid [[LINE]]; border-radius: 12px;">
  <span style="display: grid; place-items: center; width: 56px; height: 56px;">[[AUDIO]]</span>
  <div style="flex: 1;"><strong style="display: block; font-size: 15px; font-weight: 600;">Nina · your voice</strong><span style="font-size: 12px; color: [[MUTED]];">Recorded Sep 12 · 34 s sample · French, Dutch tested</span></div>
  <span style="display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 8px; background: [[BAR]]; font-size: 13px; font-weight: 500;">[[PLAY]]Hear it</span>
  <span style="display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 8px; background: [[INK]]; color: #FFF; font-size: 13px; font-weight: 500;">[[MIC]]Re-record</span>
</div>""", LINE=SHEET_LINE, AUDIO=puff("fish", "#2F6FE0", 54), MUTED=MUTED, BAR=BAR, PLAY=icon("play", 12), INK=INK, MIC=icon("mic", 13, "#FFF"))
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Voice", "How you sound to callers, and how formal you are")
        + tabs([("Your voice", True, False), ("Avatar", False, False), ("Register", False, False), ("Library", False, False)])
        + body(card + h3("Register")
               + option("Formal", "vous · Sie · usted. The default for callers you don't know.", True)
               + option("Casual", "tu · du · tú. For repeat callers who use it first.", False)
               + option("Match the caller", "Follow whatever register the caller uses.", False))
        + ask("Ask how a reply will sound"))
    return window("voice", inner)

# =====================================================================
# Floor — queue and room
# =====================================================================
def floor_screen():
    def stat(n, label):
        return '<div style="padding: 12px 14px; border: 1px solid %s; border-radius: 10px;"><strong style="display: block; font: 400 22px/1.1 %s;">%s</strong><span style="font-size: 11px; color: %s;">%s</span></div>' % (SHEET_LINE, SERIF, n, MUTED, label)
    def waiting(pos, who, meta):
        return '<div style="display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid %s;"><span style="display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%%; background: %s; font-size: 12px; font-weight: 600;">%s</span><div style="flex: 1;"><strong style="display: block; font-size: 15px; font-weight: 600;">%s</strong><span style="font-size: 12px; color: %s;">%s</span></div><span style="display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px; background: %s; color: #FFF; font-size: 13px; font-weight: 500;">Answer</span></div>' % (SHEET_LINE, BAR, pos, who, MUTED, meta, GREEN)
    def agent(name, meta, state, tone):
        looks = {"Nina Okafor": ("fish", "#2F6FE0"), "Sam Vieira": ("puff", "#3C8A4E"), "Tomás Ferreira": ("tuft", "#E7A72F")}
        v, c = looks.get(name, ("puff", "#9A958B"))
        return row(name, meta, status(state, tone), lead=puff(v, c, 32))
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Floor", "Who is on what · read-only · no audio")
        + tabs([("Queue", True, False), ("Agents", False, False)])
        + body('<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px;">%s%s%s%s</div>' % (stat("2", "Waiting"), stat("3", "On calls"), stat("1", "Available"), stat("48 s", "Longest wait"))
               + waiting("1", "+34 612 33 44 55", "Phone · Spanish · waiting 48 s")
               + waiting("2", "+33 7 55 10 20 30", "Phone · French · waiting 12 s")
               + '<div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: %s; margin: 16px 0 2px;">AGENTS</div>' % MUTED
               + agent("Nina Okafor", "Marie Dubois · 04:12 · FR", "On a call", "amber")
               + agent("Sam Vieira", "+31 6 20 11 45 90 · 02:40 · NL", "On a call", "amber")
               + agent("Tomás Ferreira", "Speaks to ES · PT", "Available", "green"))
        + ask("Ask about the floor"))
    return window("floor", inner)

# =====================================================================
# Settings — workspace, agents, integrations, phone number
# =====================================================================
def settings_screen():
    def setting(label, value, action="Change"):
        return '<div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid %s;"><div style="flex: 1;"><strong style="display: block; font-size: 15px; font-weight: 600;">%s</strong><span style="font-size: 12px; color: %s;">%s</span></div><span style="font-size: 13px; color: %s;">%s</span></div>' % (SHEET_LINE, label, MUTED, value, NAVTEXT, action)
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Settings", "Workspace defaults every seat inherits")
        + tabs([("Workspace", True, False), ("Agents", False, False), ("Integrations", False, False), ("Phone number", False, False)])
        + body(setting("Default voice", "Kyoko · licensed · used by anyone without their own")
               + setting("Languages", "Agents speak English · callers speak French by default")
               + setting("Line name", "Main line")
               + setting("Agents on the floor", "Nina Okafor, Sam Vieira, Tomás Ferreira, Ines Rocha", "Manage")
               + setting("Zendesk", "Creates a ticket for every completed call", status("On", "green"))
               + setting("Signed webhook", "hooks.acme.example/notefish", status("On", "green"))
               + setting("Export API", "Let a system pull calls as JSON or CSV", status("Off", "muted"))
               + setting("Phone number", "No number connected · browser calls work without one", "Connect"))
        + ask("Ask about a setting"))
    return window("settings", inner)

# =====================================================================
# Companion — the floating pill on any screen
# =====================================================================
def companion_screen():
    caption = '<div style="max-width: 420px; padding: 12px 14px; border-radius: 14px; background: %s; border: 1px solid %s; box-shadow: 0 10px 30px rgba(36,36,36,.08);"><p style="font-size: 15px; line-height: 1.5;">I&#39;ve been waiting for my delivery since this morning.</p><p style="font-size: 12px; color: %s; margin-top: 4px;"><span style="font-weight: 600; margin-right: 6px;">FR</span>J&#39;attends ma livraison depuis ce matin.</p></div>' % (CARD, LINE, MUTED)
    states = [
        ("Call detected", pill('<span style="opacity: .6;">%s</span><span>Zoom · translate this call?</span><span style="display: inline-flex; align-items: center; height: 26px; padding: 0 11px; border-radius: 999px; background: #FFF; color: #242424; font-weight: 600; margin-left: 4px;">Start</span>' % icon("monitor", 14, "#FFF"))),
        ("Listening", pill(wave() + '<span>Listening</span><span style="opacity: .45;">EN ← FR</span><kbd style="font: inherit; font-size: 10px; border: 1px solid #777; padding: 2px 6px; border-radius: 4px; color: #E2E0DB;">hold ⌥</kbd>')),
        ("Holding", pill('<span style="width: 8px; height: 8px; border-radius: 50%%; background: %s; box-shadow: 0 0 0 4px rgba(165,51,50,.25);"></span><span>Recording</span>%s<span style="opacity: .55;">release to send</span>' % (RED, wave()))),
        ("Speaking", pill('%s<span>Playing in your voice</span><span style="display: inline-block; width: 80px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.18); overflow: hidden;"><span style="display: block; width: 60%%; height: 100%%; background: #FFF;"></span></span><span style="opacity: .55;">0:03</span>' % icon("volume", 14, "#FFF"))),
    ]
    strip = "".join('<div style="display: flex; flex-direction: column; align-items: center; gap: 8px;"><span style="font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: %s;">%s</span>%s</div>' % (MUTED, t.upper(), p) for t, p in states)
    return doc(tpl("""<div style="position: relative; width: 1000px; height: 622px; background: linear-gradient(180deg, #E9E6DF 0%, #DAD6CD 100%); overflow: hidden;">
  <div style="position: absolute; left: 0; top: 0; right: 0; height: 24px; background: rgba(250,249,247,.85); display: flex; align-items: center; justify-content: space-between; padding: 0 14px; font-size: 12px; font-weight: 600;">
    <span style="display: flex; align-items: center; gap: 14px;"><span></span><span>Zoom</span><span style="font-weight: 400; color: [[NAVTEXT]];">File</span><span style="font-weight: 400; color: [[NAVTEXT]];">Edit</span><span style="font-weight: 400; color: [[NAVTEXT]];">View</span></span>
    <span style="display: flex; align-items: center; gap: 12px; color: [[NAVTEXT]];">[[MARK]]<span style="font-weight: 400;">Tue 16 Sep 10:14</span></span>
  </div>
  <div style="position: absolute; left: 70px; top: 60px; width: 860px; height: 470px; border-radius: 12px; background: rgba(252,251,250,.55); border: 1px solid rgba(36,36,36,.08); display: grid; place-items: center; padding-top: 150px; color: [[MUTED]]; font-size: 13px;">
    <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;"><span style="color: #9A958B;">[[MONITOR]]</span><span>Any softphone, contact-centre desktop, or meeting app</span><span style="font-size: 11px; color: #9A958B;">Genesys · Five9 · Amazon Connect · 3CX · Zoom · Teams · a browser tab</span></div>
  </div>
  <div style="position: absolute; left: 0; right: 0; top: 92px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 24px; width: 760px; margin: 0 auto;">[[STRIP]]</div>
  <div style="position: absolute; left: 0; right: 0; bottom: 34px; display: flex; flex-direction: column; align-items: center; gap: 12px;">[[CAPTION]][[PILL]]</div>
</div>
""", NAVTEXT=NAVTEXT, MARK=logo_mark(16), MUTED=MUTED, MONITOR=icon("monitor", 26, "#9A958B", "1.3"), STRIP=strip, CAPTION=caption,
        PILL=pill(wave() + '<span>Listening</span><span style="opacity: .45;">EN ← FR</span><kbd style="font: inherit; font-size: 10px; border: 1px solid #777; padding: 2px 6px; border-radius: 4px; color: #E2E0DB;">hold ⌥</kbd>')))


# =====================================================================
# Avatar — Voice › Avatar: pick a dash-blob shape and colour
# =====================================================================
def avatar_screen():
    chosen, chosen_color = "fish", "#2F6FE0"
    def cell(v):
        ring = ("background: %s; box-shadow: 0 0 0 1.5px %s; " % (BAR, INK)) if v == chosen else ""
        return '<span style="display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%%; %s">%s</span>' % (ring, puff(v, chosen_color, 44))
    def swatch(hexv):
        ring = ("box-shadow: 0 0 0 1.5px %s, 0 0 0 4px %s; " % (SHEET, INK)) if hexv == chosen_color else ""
        return '<span style="width: 28px; height: 28px; border-radius: 50%%; background: %s; %s"></span>' % (hexv, ring)
    def ptab(label, active):
        return '<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 7px; font-size: 13px; font-weight: %s; color: %s; background: %s;">%s</span>' % ("600" if active else "500", INK if active else NAVTEXT, BAR if active else "transparent", label)
    picker = tpl("""
<div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
  <div style="display: flex; align-items: center; justify-content: center; height: 92px;">[[BIG]]</div>
  <div style="width: 100%; border: 1px solid [[LINE]]; border-radius: 14px; background: [[CARD]]; overflow: hidden;">
    <div style="display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-bottom: 1px solid [[LINE]];">[[T1]][[T2]][[T3]]<span style="flex: 1;"></span><span style="font-size: 13px; color: [[NAVTEXT]]; padding: 0 10px;">Reset</span></div>
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); justify-items: center; gap: 0; padding: 8px 56px 2px;">[[CELLS]]</div>
    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 20px 12px;">
      <div style="display: flex; gap: 22px;">[[ROW1]]</div>
      <div style="display: flex; gap: 22px;">[[ROW2]]</div>
    </div>
  </div>
  <div style="width: 100%; display: flex; align-items: center; gap: 12px; padding: 2px 4px 0;">
    <div style="flex: 1;"><strong style="display: block; font-size: 14px; font-weight: 600;">Show my face on the floor</strong><span style="font-size: 12px; color: [[MUTED]];">Off shows the puff without eyes in lists and call records.</span></div>
    [[SAMPLE]]
    <span style="position: relative; display: inline-block; width: 44px; height: 26px; border-radius: 999px; background: [[INK]];"><span style="position: absolute; right: 3px; top: 3px; width: 20px; height: 20px; border-radius: 50%; background: #FFF;"></span></span>
  </div>
</div>""", BIG=puff(chosen, chosen_color, 92), LINE=SHEET_LINE, CARD=CARD, NAVTEXT=NAVTEXT, MUTED=MUTED, INK=INK,
        T1=ptab("Shape", True), T2=ptab("Generate", False), T3=ptab("Upload", False),
        CELLS="".join(cell(v) for v in PUFFS),
        ROW1="".join(swatch(h) for _, h in SWATCHES[:6]), ROW2="".join(swatch(h) for _, h in SWATCHES[6:]),
        SAMPLE=puff(chosen, chosen_color, 32, face=False))
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Voice", "How you sound to callers, and how you look on the floor")
        + tabs([("Your voice", False, False), ("Avatar", True, False), ("Register", False, False), ("Library", False, False)])
        + column(picker, extra="margin-top: 14px; flex: 1; min-height: 0; overflow: hidden;"))
    return window("voice", inner)

# ---- three constructions for a dash avatar, for choosing between ----
_uid = [0]
def _rounded_polygon(pts, r):
    n = len(pts); d = []
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1 = math.hypot(*v1); l2 = math.hypot(*v2); rr = min(r, l1 / 2, l2 / 2)
        a = (p1[0] + v1[0] / l1 * rr, p1[1] + v1[1] / l1 * rr); b = (p1[0] + v2[0] / l2 * rr, p1[1] + v2[1] / l2 * rr)
        d.append(("M" if i == 0 else "L") + "%.1f,%.1f" % a); d.append("Q%.1f,%.1f %.1f,%.1f" % (p1[0], p1[1], b[0], b[1]))
    return " ".join(d) + " Z"

def outline(shape, attrs):
    """One SVG element for the shape's smooth silhouette in a 100x100 box."""
    if shape == "round": return '<circle cx="50" cy="50" r="47" %s/>' % attrs
    if shape == "squircle": return '<rect x="4" y="4" width="92" height="92" rx="36" %s/>' % attrs
    if shape == "square": return '<rect x="5" y="5" width="90" height="90" rx="18" %s/>' % attrs
    if shape == "wide": return '<rect x="3" y="19" width="94" height="62" rx="31" %s/>' % attrs
    if shape == "triangle": return '<path d="%s" %s/>' % (_rounded_polygon([(50, 6), (95, 88), (5, 88)], 14), attrs)
    if shape == "hexagon":
        pts = [(50 + 47 * math.cos(math.radians(a)), 50 + 47 * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
        return '<path d="%s" %s/>' % (_rounded_polygon(pts, 11), attrs)
    if shape == "cloud": return '<path d="M22,82 A17,17 0 0 1 20,50 A20,20 0 0 1 54,33 A19,19 0 0 1 86,54 A15,15 0 0 1 80,82 Z" %s/>' % attrs
    if shape == "drop": return '<path d="M50,4 C62,24 91,40 91,62 A41,41 0 1 1 9,62 C9,40 38,24 50,4 Z" %s/>' % attrs
    raise KeyError(shape)

def _eye_y(shape): return 60 if shape in ("triangle", "drop", "cloud") else 43

def blob_striped(shape, color, size=64):
    """Solid silhouette filled with dashes; eyes are slits on top."""
    _uid[0] += 1; cid = "c%d" % _uid[0]
    n = 8 if size >= 60 else 6
    pitch = 100 / n; bw = pitch * 0.74
    stripes = "".join('<rect x="%.1f" y="-4" width="%.1f" height="108" rx="%.1f" fill="%s"/>' % (i * pitch + (pitch - bw) / 2, bw, bw / 2, color) for i in range(n))
    eye = "#1B1B1B" if color != "#F1EEE7" else "#3A3A3A"; ey = _eye_y(shape)
    eyes = '<rect x="38" y="%d" width="6" height="16" rx="3" fill="%s"/><rect x="56" y="%d" width="6" height="16" rx="3" fill="%s"/>' % (ey, eye, ey, eye)
    return ('<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="%s">%s</clipPath></defs><g clip-path="url(#%s)">%s</g>%s</svg>'
            % (size, size, cid, outline(shape, ""), cid, stripes, eyes))

def blob_stitched(shape, color, size=64):
    """Only the outline, as a loop of short round dashes; a faint tint inside; two dash eyes."""
    ey = _eye_y(shape)
    eyes = '<path d="M41,%d v12 M59,%d v12" stroke="%s" stroke-width="6" stroke-linecap="round"/>' % (ey, ey, color)
    return ('<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s%s%s</svg>'
            % (size, size, outline(shape, 'fill="%s" fill-opacity=".14"' % color), outline(shape, 'fill="none" stroke="%s" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="9 8"' % color), eyes))

def blob_halftone(shape, color, size=64):
    """A matrix of small dashes that shrink toward the edge, so the shape emerges."""
    cols = 9 if size >= 60 else 7; rows = 11 if size >= 60 else 8
    pitch_x = 100 / cols; pitch_y = 100 / rows; bw = pitch_x * 0.34
    eye = "#1B1B1B" if color != "#F1EEE7" else "#3A3A3A"; ey = _eye_y(shape) + 8
    parts = []
    for i in range(cols):
        x = (i + 0.5) / cols
        top, bottom = silhouette(shape, x)
        top *= 100; bottom *= 100
        if bottom - top < pitch_y: continue
        for j in range(rows):
            cy = (j + 0.5) * pitch_y
            if cy < top or cy > bottom: continue
            edge = min(cy - top, bottom - cy, (0.5 - abs(x - 0.5)) * 100 * 1.6)
            h = max(2.2, min(pitch_y * 0.82, edge * 0.55 + 2))
            is_eye = i in (cols // 2 - 1, cols // 2 + 1) and abs(cy - ey) < pitch_y * 0.6
            parts.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s"/>' % (i * pitch_x + (pitch_x - bw) / 2, cy - h / 2, bw, h, bw / 2, eye if is_eye else color))
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s</svg>' % (size, size, "".join(parts))

RHYTHMS = {
    "even": [10] * 28,
    "pulse": [6, 8, 12, 16, 12, 8, 6] * 4,
    "spiky": [5, 16, 5, 14, 6, 17, 5] * 4,
    "soft": [8, 9, 10, 11, 12, 11, 10, 9, 8, 9, 10, 11, 12, 11] * 2,
    "double": [14, 14, 6, 6] * 7,
    "sparse": [12, 0, 12, 0, 12, 0, 12] * 4,
    "dense": [9, 11, 9, 11, 9, 11, 9] * 4,
    "wave": [int(8 + 8 * abs(math.sin(i / 28 * math.pi * 2))) for i in range(28)],
}
RHYTHM_NAMES = list(RHYTHMS)

def _face_ink(color): return "#3A3A3A" if color == "#F1EEE7" else "#1B1B1B"

def blob_orbit(rhythm, color, size=64, eyes=True):
    """A soft core with a ring of radial dashes; the ring's rhythm is the identity."""
    lens = RHYTHMS[rhythm]; n = len(lens)
    parts = ['<circle cx="50" cy="50" r="24" fill="%s"/>' % color]
    for i, L in enumerate(lens):
        if not L: continue
        a = i / n * math.pi * 2 - math.pi / 2
        r0, r1 = 31, 31 + L
        parts.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="4.6" stroke-linecap="round"/>' % (50 + r0 * math.cos(a), 50 + r0 * math.sin(a), 50 + r1 * math.cos(a), 50 + r1 * math.sin(a), color))
    if eyes:
        ink = _face_ink(color)
        parts.append('<rect x="42.5" y="44" width="4.5" height="10" rx="2.2" fill="%s"/><rect x="53" y="44" width="4.5" height="10" rx="2.2" fill="%s"/>' % (ink, ink))
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s</svg>' % (size, size, "".join(parts))

def blob_chatter(shape, color, size=64):
    """A smooth solid blob, dot eyes, and a waveform mouth — the dashes are what it says."""
    ink = _face_ink(color); dy = 14 if shape in ("triangle", "drop", "cloud") else 0
    eyes = '<circle cx="40" cy="%d" r="4.2" fill="%s"/><circle cx="60" cy="%d" r="4.2" fill="%s"/>' % (42 + dy, ink, 42 + dy, ink)
    mouth = "".join('<rect x="%.1f" y="%.1f" width="4" height="%d" rx="2" fill="%s"/>' % (50 - 17 + i * 7, 62 + dy - h / 2, h, ink) for i, h in enumerate([6, 12, 17, 12, 6]))
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s%s%s</svg>' % (size, size, outline(shape, 'fill="%s"' % color), eyes, mouth)

GLYPHS = {
    "N": ["X...X", "XX..X", "X.X.X", "X..XX", "X...X", "X...X", "X...X"],
    "S": [".XXX.", "X...X", "X....", ".XXX.", "....X", "X...X", ".XXX."],
    "T": ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
    "I": ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "XXXXX"],
    "A": [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
}

def blob_monogram(shape, color, size=64, letter="N"):
    """A coloured tile with the initial drawn in a dash-matrix font."""
    fg = "#1B1B1B" if color in ("#F1EEE7", "#E7A72F") else "#FFFFFF"
    pitch = 9.4; ox = 50 - 2.5 * pitch; oy = 50 - 3.5 * pitch + (6 if shape in ("triangle", "drop") else 0)
    cells = []
    for r, rowbits in enumerate(GLYPHS[letter]):
        for c, bit in enumerate(rowbits):
            if bit == "X": cells.append('<rect x="%.1f" y="%.1f" width="4.2" height="7.6" rx="2.1" fill="%s"/>' % (ox + c * pitch + (pitch - 4.2) / 2, oy + r * pitch + (pitch - 7.6) / 2, fg))
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s%s</svg>' % (size, size, outline(shape, 'fill="%s"' % color), "".join(cells))

ENV13 = [0.22, 0.5, 0.34, 0.86, 0.62, 1.0, 0.72, 0.92, 0.5, 0.8, 0.4, 0.6, 0.28]
BLUE = "#2F6FE0"
def _bars(w, h, n=13, ratio=0.56):
    pitch = w / n; bw = pitch * ratio
    return [(k * pitch + (pitch - bw) / 2, bw, max(bw, ENV13[k] * h * 0.94)) for k in range(n)]
def _svg(w, h, inner, defs=""):
    return '<svg width="%d" height="%d" viewBox="0 0 %d %d" aria-hidden="true">%s%s</svg>' % (w, h, w, h, ("<defs>%s</defs>" % defs) if defs else "", inner)

def aes_mono(w=160, h=120):
    return _svg(w, h, "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="#242424"/>' % (x, (h - bh) / 2, bw, bh, bw / 2) for x, bw, bh in _bars(w, h, ratio=0.62)))

def aes_glass(w=160, h=120):
    defs = '<filter id="agl" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="4.5"/></filter><linearGradient id="agg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFF" stop-opacity=".55"/><stop offset=".5" stop-color="#FFF" stop-opacity="0"/></linearGradient>'
    shadow = "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" opacity=".38"/>' % (x, (h - bh) / 2 + 7, bw, bh, bw / 2, BLUE) for x, bw, bh in _bars(w, h))
    body = "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" opacity=".82"/><rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="url(#agg)"/>' % (x, (h - bh) / 2, bw, bh, bw / 2, BLUE, x, (h - bh) / 2, bw, bh, bw / 2) for x, bw, bh in _bars(w, h))
    return _svg(w, h, '<g filter="url(#agl)">%s</g>%s' % (shadow, body), defs)

def aes_spectrum(w=160, h=120):
    hues = ["#2F6FE0", "#3F66E2", "#4F5CE3", "#5F52E4", "#6F49E3", "#7F40DF", "#9038D8", "#A231CF", "#B32CC4", "#C428B8", "#D226AB", "#DD259E", "#E52591"]
    return _svg(w, h, "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s"/>' % (x, (h - bh) / 2, bw, bh, bw / 2, hues[k]) for k, (x, bw, bh) in enumerate(_bars(w, h))))

def aes_outline(w=160, h=120):
    return _svg(w, h, "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="none" stroke="%s" stroke-width="2"/>' % (x + 1, (h - bh) / 2 + 1, bw - 2, bh - 2, (bw - 2) / 2, BLUE) for x, bw, bh in _bars(w, h, ratio=0.66)))

def aes_ring(w=160, h=120):
    cx, cy, r0 = w / 2, h / 2, 22; parts = []
    for i in range(36):
        a = i / 36 * math.pi * 2 - math.pi / 2; L = 6 + 26 * ENV13[i % 13]
        parts.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="4" stroke-linecap="round"/>' % (cx + r0 * math.cos(a), cy + r0 * math.sin(a), cx + (r0 + L) * math.cos(a), cy + (r0 + L) * math.sin(a), BLUE))
    return _svg(w, h, "".join(parts))

def aes_mirror(w=160, h=120):
    base = h * 0.62; defs = '<linearGradient id="amr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s" stop-opacity=".38"/><stop offset="1" stop-color="%s" stop-opacity="0"/></linearGradient>' % (BLUE, BLUE)
    up = "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s"/>' % (x, base - bh * 0.72, bw, bh * 0.72, bw / 2, BLUE) for x, bw, bh in _bars(w, h))
    down = "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="url(#amr)"/>' % (x, base + 3, bw, bh * 0.5, bw / 2) for x, bw, bh in _bars(w, h))
    return _svg(w, h, up + down, defs)

def aes_segmented(w=160, h=120):
    parts = []
    for x, bw, bh in _bars(w, h, ratio=0.6):
        seg, gap = 6.5, 2.5; count = max(1, int(bh / (seg + gap))); total = count * seg + (count - 1) * gap; y0 = (h - total) / 2
        for j in range(count):
            parts.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1.8" fill="%s"/>' % (x, y0 + j * (seg + gap), bw, seg, lighten(BLUE, 0.3) if j == 0 else BLUE))
    return _svg(w, h, "".join(parts))

def aes_duotone(w=160, h=120):
    a = "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" opacity=".78"/>' % (x - 3.5, (h - bh) / 2 - 3, bw, bh, bw / 2, "#2E9E86") for x, bw, bh in _bars(w, h))
    b = "".join('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" opacity=".78"/>' % (x + 3.5, (h - bh) / 2 + 3, bw, bh, bw / 2, BLUE) for x, bw, bh in _bars(w, h))
    return _svg(w, h, a + b)

def av_orb():
    return _svg(120, 120, '<circle cx="60" cy="60" r="46" fill="url(#orbg)"/><ellipse cx="46" cy="40" rx="20" ry="13" fill="url(#orbh)"/>',
        '<radialGradient id="orbg" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="%s"/><stop offset=".55" stop-color="%s"/><stop offset="1" stop-color="%s"/></radialGradient><radialGradient id="orbh"><stop offset="0" stop-color="#FFF" stop-opacity=".7"/><stop offset="1" stop-color="#FFF" stop-opacity="0"/></radialGradient>' % (lighten(BLUE, .5), BLUE, darken(BLUE, .4)))

def av_rings():
    rings = "".join('<circle cx="52" cy="66" r="%d" fill="none" stroke="%s" stroke-width="%.1f" opacity="%.2f"/>' % (r, BLUE, 3.2 - i * 0.35, 1 - i * 0.16) for i, r in enumerate([8, 18, 28, 38, 48]))
    return _svg(120, 120, '<circle cx="52" cy="66" r="3.5" fill="%s"/>%s' % (BLUE, rings))

def av_monogram():
    return _svg(120, 120, '<circle cx="60" cy="60" r="48" fill="%s"/><text x="60" y="78" text-anchor="middle" font-family="%s" font-size="56" fill="%s">N</text>' % (lighten(BLUE, .82), SERIF.replace("'", ""), BLUE))

def av_aurora():
    return _svg(120, 120, '<rect x="12" y="12" width="96" height="96" rx="30" fill="url(#aug)"/><rect x="12" y="12" width="96" height="96" rx="30" fill="url(#au2)"/>',
        '<linearGradient id="aug" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="#7D4FE0"/></linearGradient><radialGradient id="au2" cx=".25" cy=".8" r=".7"><stop offset="0" stop-color="#2E9E86" stop-opacity=".85"/><stop offset="1" stop-color="#2E9E86" stop-opacity="0"/></radialGradient>' % BLUE)

def av_bubble():
    return _svg(120, 120, '<path d="M60,18 C86,18 104,34 104,56 C104,78 86,94 60,94 C54,94 48,93 43,91 L24,102 L30,82 C20,75 16,66 16,56 C16,34 34,18 60,18 Z" fill="%s"/>' % BLUE)

def av_thread():
    return _svg(120, 120, '<path d="M22,74 C18,44 46,30 62,48 C78,66 50,92 40,72 C30,52 62,22 86,40 C104,54 96,86 72,92 C56,96 44,84 54,70" fill="none" stroke="%s" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' % BLUE)

def av_pebble():
    outer = organic_path("bean")
    return _svg(120, 120, '<g transform="translate(10 10) scale(1)"><path d="%s" fill="%s"/><path d="%s" fill="%s" transform="translate(4 5) scale(.86) translate(7 7)" opacity=".55"/></g>' % (outer, BLUE, outer, darken(BLUE, .25)))

def av_bloom():
    petals = "".join('<circle cx="%.1f" cy="%.1f" r="24" fill="%s" opacity=".55"/>' % (60 + 20 * math.cos(math.radians(a)), 60 + 20 * math.sin(math.radians(a)), BLUE) for a in range(0, 360, 60))
    return _svg(120, 120, petals + '<circle cx="60" cy="60" r="10" fill="%s"/>' % darken(BLUE, .3))

INK_EYE = "#1B1B1B"; BLUSH = "#F08A9B"
def _svg100(inner, defs="", size=120):
    return '<svg width="%d" height="%d" viewBox="0 0 100 100" aria-hidden="true">%s%s</svg>' % (size, size, ("<defs>%s</defs>" % defs) if defs else "", inner)
def _squish(): return organic_path("round")

def cb_classic():
    return _svg100('<path d="%s" fill="%s"/><g transform="rotate(-8 41 43)"><rect x="38.5" y="36" width="5" height="14" rx="2.5" fill="%s"/></g><g transform="rotate(8 59 43)"><rect x="56.5" y="36" width="5" height="14" rx="2.5" fill="%s"/></g>' % (_squish(), BLUE, INK_EYE, INK_EYE))

def cb_kawaii():
    return _svg100('<path d="%s" fill="%s"/><circle cx="39" cy="46" r="5.2" fill="%s"/><circle cx="61" cy="46" r="5.2" fill="%s"/><circle cx="41" cy="44" r="1.8" fill="#FFF"/><circle cx="63" cy="44" r="1.8" fill="#FFF"/><ellipse cx="30" cy="57" rx="6" ry="3.5" fill="%s" opacity=".55"/><ellipse cx="70" cy="57" rx="6" ry="3.5" fill="%s" opacity=".55"/><path d="M45,60 Q50,65 55,60" fill="none" stroke="%s" stroke-width="2.6" stroke-linecap="round"/>' % (_squish(), BLUE, INK_EYE, INK_EYE, BLUSH, BLUSH, INK_EYE))

def cb_sleepy():
    return _svg100('<path d="%s" fill="url(#slg)"/><path d="M33,47 Q39,41 45,47 M55,47 Q61,41 67,47" fill="none" stroke="%s" stroke-width="3" stroke-linecap="round"/><ellipse cx="31" cy="57" rx="6" ry="3.5" fill="%s" opacity=".5"/><ellipse cx="69" cy="57" rx="6" ry="3.5" fill="%s" opacity=".5"/>' % (_squish(), INK_EYE, BLUSH, BLUSH),
        '<linearGradient id="slg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' % (lighten(BLUE, .3), BLUE))

def cb_ghosty():
    return _svg100('<path d="M50,8 C74,8 92,26 92,50 L92,86 Q85,78 78,86 Q71,94 64,86 Q57,78 50,86 Q43,94 36,86 Q29,78 22,86 Q15,94 8,86 L8,50 C8,26 26,8 50,8 Z" fill="%s"/><ellipse cx="39" cy="46" rx="5" ry="7" fill="%s"/><ellipse cx="61" cy="46" rx="5" ry="7" fill="%s"/>' % (BLUE, INK_EYE, INK_EYE))

def cb_jelly():
    return _svg100('<path d="%s" fill="%s" opacity=".78"/><path d="%s" fill="none" stroke="%s" stroke-width="2" opacity=".6"/><ellipse cx="38" cy="30" rx="14" ry="9" fill="#FFF" opacity=".45"/><ellipse cx="40" cy="50" rx="4.5" ry="6" fill="%s" opacity=".85"/><ellipse cx="60" cy="50" rx="4.5" ry="6" fill="%s" opacity=".85"/>' % (_squish(), BLUE, _squish(), darken(BLUE, .3), INK_EYE, INK_EYE))

def cb_puff():
    bumps = "".join('<circle cx="%.1f" cy="%.1f" r="17" fill="%s"/>' % (50 + 26 * math.cos(math.radians(a)), 51 + 26 * math.sin(math.radians(a)), BLUE) for a in range(0, 360, 45))
    return _svg100(bumps + '<circle cx="50" cy="51" r="30" fill="%s"/><circle cx="42" cy="48" r="2.8" fill="%s"/><circle cx="58" cy="48" r="2.8" fill="%s"/><path d="M45,57 Q50,60 55,57" fill="none" stroke="%s" stroke-width="2.4" stroke-linecap="round"/>' % (BLUE, INK_EYE, INK_EYE, INK_EYE))

def cb_sticker():
    return _svg100('<path d="%s" fill="#FFF" stroke="#FFF" stroke-width="12" stroke-linejoin="round"/><path d="%s" fill="%s" stroke="%s" stroke-width="4" stroke-linejoin="round"/><circle cx="41" cy="47" r="3" fill="%s"/><circle cx="59" cy="47" r="3" fill="%s"/><path d="M44,58 L56,58" stroke="%s" stroke-width="3" stroke-linecap="round"/>' % (_squish(), _squish(), BLUE, INK_EYE, INK_EYE, INK_EYE, INK_EYE))

def cb_droplet():
    return _svg100('<path d="M50,6 C58,20 88,32 88,58 A38,38 0 0 1 12,58 C12,32 42,20 50,6 Z" fill="%s"/><circle cx="41" cy="58" r="3.4" fill="%s"/><circle cx="59" cy="58" r="3.4" fill="%s"/><ellipse cx="32" cy="67" rx="5.5" ry="3.2" fill="%s" opacity=".5"/><ellipse cx="68" cy="67" rx="5.5" ry="3.2" fill="%s" opacity=".5"/>' % (BLUE, INK_EYE, INK_EYE, BLUSH, BLUSH))

def directions_screen():
    header = "".join('<span style="display: grid; place-items: center; width: 64px; font-size: 10px; font-weight: 600; letter-spacing: 1.2px; color: %s;">%s</span>' % (MUTED, v.upper()) for v in PUFFS)
    grid = "".join('<span style="display: grid; place-items: center; width: 64px; height: 64px;">%s</span>' % puff(v, c, 58) for _, c in SWATCHES for v in PUFFS)
    body = tpl("""<div style="width: 1000px; height: 980px; background: [[PAPER]]; padding: 36px 44px; overflow: hidden;">
  <div style="margin-bottom: 14px;"><span style="font-size: 10px; font-weight: 600; letter-spacing: 1.5px; color: #6B6861;">AVATAR · THE FAMILY</span><h1 style="font: 400 30px/1.15 [[SERIF]]; letter-spacing: -.8px; margin: 10px 0 6px;">Eight puffs, eleven colours.</h1><p style="font-size: 13px; color: [[MUTED]];">The fish is the default. A fluffy circle of bumps, dot eyes, a small smile. This is what shows on the floor, in call records, and in the Companion.</p></div>
  <div style="display: grid; grid-template-columns: repeat(8, 64px); gap: 0 44px; justify-content: center; margin-bottom: 2px;">[[HEADER]]</div>
  <div style="display: grid; grid-template-columns: repeat(8, 64px); gap: 6px 44px; justify-content: center;">[[GRID]]</div>
</div>
""", PAPER=PAPER, SERIF=SERIF, MUTED=MUTED, HEADER=header, GRID=grid)
    return doc(body)


# =====================================================================
# Invite — the team invitation dialog, over the Voice page
# =====================================================================
def invite_screen():
    ticket = tpl("""<div style="position: relative; width: 300px; height: 132px; border-radius: 14px; background: [[INK]]; color: #F3F1EC; overflow: hidden; display: flex; align-items: center;">
  <div style="position: absolute; left: -22px; top: 10px;">[[FISH]]</div>
  <div style="position: absolute; left: 118px; top: 0; bottom: 0; border-left: 1px dashed rgba(255,255,255,.22);"></div>
  <div style="position: absolute; left: 112px; top: -7px; width: 12px; height: 12px; border-radius: 50%; background: [[PANEL]];"></div>
  <div style="position: absolute; left: 112px; bottom: -7px; width: 12px; height: 12px; border-radius: 50%; background: [[PANEL]];"></div>
  <div style="position: absolute; left: 136px; top: 22px; right: 16px; display: flex; flex-direction: column; gap: 6px;">
    <span style="font-size: 9.5px; font-weight: 600; letter-spacing: 1.4px; color: #A6A29A;">NOTEFISH</span>
    <span style="font: 400 21px/1.15 [[SERIF]]; letter-spacing: -.4px;">One month<br>free.</span>
    <span style="display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 11px; color: #C9D6CE;"><span style="width: 5px; height: 5px; border-radius: 50%; background: [[GREENL]];"></span>A gift from Nina</span>
  </div>
</div>""", INK=INK, PANEL=PANEL, SERIF=SERIF, GREENL="#7FBF95", FISH=puff("fish", "#F3F1EC", 128))
    def step(n, text):
        return '<div style="display: flex; align-items: center; gap: 10px; font-size: 12.5px;"><span style="display: grid; place-items: center; width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%%; border: 1px solid %s; background: %s; font-size: 10px; color: %s;">%s</span><span>%s</span></div>' % (LINE, SHEET, MUTED, n, text)
    def ptab(label, active):
        look = ("color: #FFF; background: %s; border: 1px solid %s;" % (INK, INK)) if active else ("color: %s; background: transparent; border: 1px solid %s;" % (NAVTEXT, SHEET_LINE))
        return '<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; font-weight: %s; %s">%s</span>' % ("600" if active else "500", look, label)
    modal = tpl("""
<div style="position: absolute; inset: 0; background: rgba(36,36,36,.26);"></div>
<div style="position: absolute; left: 310px; top: 30px; width: 380px; height: 562px; background: [[SHEET]]; border: 1px solid [[LINE]]; border-radius: 16px; box-shadow: 0 24px 60px rgba(36,36,36,.22); padding: 20px 18px 12px; display: flex; flex-direction: column; overflow: hidden;">
  <h2 style="font: 400 24px/1.15 [[SERIF]]; letter-spacing: -.6px;">Get a free month.</h2>
  <p style="font-size: 12.5px; color: [[MUTED]]; line-height: 1.5; margin-top: 6px;">Share NoteFish with a friend. They get a month free, and so do you.</p>
  <div style="display: flex; gap: 6px; margin-top: 12px;">[[T1]][[T2]][[T3]]</div>
  <div style="margin-top: 12px; background: [[PANEL]]; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
    <div style="display: flex; justify-content: center;">[[TICKET]]</div>
    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 2px;">[[S1]][[S2]][[S3]]</div>
    <div style="display: flex; flex-direction: column; gap: 6px;"><strong style="font-size: 12px; font-weight: 600;">Your link</strong><div style="display: flex; gap: 8px;"><span style="flex: 1; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border: 1px solid [[LINE]]; border-radius: 9px; background: [[SHEET]]; font-size: 12px; white-space: nowrap; overflow: hidden;">[[LINK]]notefish.example/r/NINA138</span><span style="display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 9px; border: 1px solid [[LINE]]; background: [[SHEET]]; font-size: 12.5px; font-weight: 550;">Copy</span></div></div>
    <div style="display: flex; flex-direction: column; gap: 6px;"><strong style="font-size: 12px; font-weight: 600;">Or send it by email</strong><div style="display: flex; gap: 8px;"><span style="flex: 1; display: flex; align-items: center; height: 34px; padding: 0 10px; border: 1px solid [[LINE]]; border-radius: 9px; background: [[SHEET]]; font-size: 12px; color: #8F8B83;">email@example.com</span><span style="display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 9px; background: [[INK]]; color: #FFF; font-size: 12.5px; font-weight: 600;">Send[[SENDI]]</span></div></div>
  </div>
  <p style="font-size: 11px; color: [[MUTED]]; line-height: 1.5; text-align: center; margin-top: auto; padding-top: 10px;">Your free month is taken off your next payment.</p>
</div>""", SHEET=SHEET, LINE=SHEET_LINE, SERIF=SERIF, MUTED=MUTED, INK=INK, PANEL=PANEL, TICKET=ticket, LINK=icon("link", 13, NAVTEXT), SENDI=icon("send", 12, "#FFF"),
        T1=ptab("Refer a friend", True), T2=ptab("Your referrals · 0", False), T3=ptab("Have a code?", False),
        S1=step("01", "Share your link"), S2=step("02", 'Your friend signs up and gets <strong style="font-weight: 600;">a month free</strong>'), S3=step("03", 'You get <strong style="font-weight: 600;">a month free</strong> after their first call'))
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Voice", "How you sound to callers, and how you look on the floor")
        + tabs([("Your voice", True, False), ("Avatar", False, False), ("Register", False, False), ("Library", False, False)])
        + body('<div style="height: 200px;"></div>'))
    return window("free", inner, overlay=modal)

# =====================================================================
# Logo — the mark, the lockup, sizes, dock context
# =====================================================================
def logo_screen():
    sizes = "".join('<div style="display: flex; flex-direction: column; align-items: center; gap: 8px;"><span style="display: grid; place-items: center; height: 64px;">%s</span><span style="font-size: 11px; color: %s;">%dpx</span></div>' % (logo_mark(n), MUTED, n) for n in (16, 20, 24, 32, 48, 64))
    dock = tpl("""<div style="display: inline-flex; align-items: flex-end; gap: 14px; padding: 12px 16px; border-radius: 18px; background: rgba(36,36,36,.9); border: 1px solid rgba(255,255,255,.08);">
  <span style="width: 56px; height: 56px; border-radius: 14px; background: #3A3936;"></span>
  <span style="display: grid; place-items: center;">[[ICON]]</span>
  <span style="width: 56px; height: 56px; border-radius: 14px; background: #3A3936;"></span>
</div>""", ICON=logo_mark(56, radius=24))
    body = tpl("""<div style="width: 1000px; height: 622px; background: [[PAPER]]; padding: 36px 44px; overflow: hidden;">
  <div style="margin-bottom: 22px;"><span style="font-size: 10px; font-weight: 600; letter-spacing: 1.5px; color: #6B6861;">LOGO</span><h1 style="font: 400 30px/1.15 [[SERIF]]; letter-spacing: -.8px; margin: 10px 0 6px;">The fish, on a tile.</h1><p style="font-size: 13px; color: [[MUTED]];">The default avatar, in paper, on ink. Two slit eyes cut out of it so it holds at 16px. No mouth on the mark; the avatars keep theirs.</p></div>
  <div style="display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 40px; align-items: start;">
    <div style="display: flex; flex-direction: column; align-items: center; gap: 14px;"><span style="filter: drop-shadow(0 14px 30px rgba(36,36,36,.22));">[[BIG]]</span><span style="font-size: 11px; color: [[MUTED]];">App icon · 1024 master</span></div>
    <div style="display: flex; flex-direction: column; gap: 26px;">
      <div><div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: [[MUTED]]; margin-bottom: 12px;">LOCKUP</div><div style="display: flex; align-items: center; gap: 14px; font-size: 36px; font-weight: 650; letter-spacing: -1.4px;">[[LOCK]]<span>NoteFish<span style="color: #77736B;">.</span></span></div></div>
      <div><div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: [[MUTED]]; margin-bottom: 12px;">SIZES</div><div style="display: flex; align-items: flex-end; gap: 28px;">[[SIZES]]</div></div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div><div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: [[MUTED]]; margin-bottom: 12px;">ONE COLOUR</div><div style="display: flex; align-items: center; gap: 18px;">[[MONO1]][[MONO2]]<span style="display: grid; place-items: center; width: 64px; height: 64px; border-radius: 16px; background: [[INK]];">[[MONO3]]</span></div></div>
        <div><div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: [[MUTED]]; margin-bottom: 12px;">IN A DOCK</div>[[DOCK]]</div>
      </div>
    </div>
  </div>
</div>
""", PAPER=PAPER, SERIF=SERIF, MUTED=MUTED, INK=INK, BIG=logo_mark(176, radius=40), LOCK=logo_mark(40), SIZES=sizes,
        MONO1=logo_mark(56, tile=False, fg=INK, bg=PAPER), MONO2=logo_mark(56, tile=False, fg="#2F6FE0", bg=PAPER), MONO3=logo_mark(52, tile=False, fg="#F3F1EC", bg=INK), DOCK=dock)
    return doc(body)

# ---- write ----
from pathlib import Path as _P
exec(compile(_P(__file__).with_name('moments.py').read_text(encoding='utf-8'), 'moments.py', 'exec'), globals())

files = {
    "Main.dc.html": main_screen(),
    "Desk.dc.html": desk_screen(),
    "DeskHold.dc.html": desk_screen(holding=True),
    "DeskRinging.dc.html": desk_ringing(),
    "DeskTicket.dc.html": desk_ticket(),
    "Ended.dc.html": desk_ended(),
    "Record.dc.html": record_screen(),
    "Seat.dc.html": seat_screen(),
    "Caller.dc.html": caller_screen(),
    "Calls.dc.html": calls_screen(),
    "Insights.dc.html": insights_screen(),
    "Glossary.dc.html": glossary_screen(),
    "Phrases.dc.html": phrases_screen(),
    "Voice.dc.html": voice_screen(),
    "Avatar.dc.html": avatar_screen(),
    "Directions.dc.html": directions_screen(),
    "Floor.dc.html": floor_screen(),
    "Settings.dc.html": settings_screen(),
    "Invite.dc.html": invite_screen(),
    "Logo.dc.html": logo_screen(),
    "Companion.dc.html": companion_screen(),
}
for name, html in files.items():
    (OUT / name).write_text(html, encoding="utf-8")
    print(name, len(html))
