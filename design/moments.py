# The moments the app has that the design never drew. Executed inside build.py's
# namespace (see the exec line there), so every helper and token is in scope.

def _btn(label, ico=None, kind="ink", h=40, pad=16, grow=False):
    looks = {"ink": (INK, "#FFF", INK), "green": (GREEN, "#FFF", GREEN), "ghost": (SHEET, INK, SHEET_LINE), "red": ("#FFF6F4", "#982E2D", "#DDBBB7")}
    bg, fg, bd = looks[kind]
    i = (icon(ico, 15, fg) + " ") if ico else ""
    flex = "flex: 1; " if grow else ""
    return f'<button style="{flex}display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: {h}px; padding: 0 {pad}px; border-radius: 10px; border: 1px solid {bd}; background: {bg}; color: {fg}; font: 600 13px/1 {SANS}; white-space: nowrap;">{i}{label}</button>'

def _field(label, value, tall=False):
    h = "height: 56px; align-items: flex-start; padding-top: 8px;" if tall else "height: 36px; align-items: center;"
    return (f'<label style="display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0;"><span style="font-size: 11px; font-weight: 600; color: {MUTED};">{label}</span>'
            f'<span style="display: flex; {h} padding-left: 11px; padding-right: 11px; border: 1px solid {SHEET_LINE}; border-radius: 9px; background: {SHEET}; font-size: 13px; line-height: 1.4; color: {INK};">{value}</span></label>')

def desk_ringing():
    strip = column(f'<div style="display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 12px; border-radius: 8px; background: #F0F5F0;"><span style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 1.4px; color: {GREEN};">{dot("green")}RINGING · 0:42</span><span style="font-size: 12px; color: {MUTED};">2 waiting · Sam and Tomás are on calls</span></div>', extra="margin-top: 18px; flex-shrink: 0;")
    who = column(f'''<div style="display: flex; align-items: center; gap: 14px; padding: 18px; border: 1px solid #B2C6B7; border-radius: 14px; background: #F8FBF7;">
  <span style="display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; background: {SHEET}; border: 1px solid #BACDBE;">{icon("phone", 22, GREEN)}</span>
  <div style="flex: 1; min-width: 0;"><strong style="display: block; font: 400 22px/1.2 {SERIF}; letter-spacing: -.4px;">Marie Dubois</strong><span style="display: block; font-size: 12px; color: {MUTED}; margin-top: 4px;">+33 6 12 34 56 78 · phone number · 2 earlier calls, spoke French</span></div>
  <div style="display: flex; gap: 8px;">{_btn("Decline", None, "ghost")}{_btn("Answer", "phone", "green", pad=20)}</div>
</div>''', extra="margin-top: 16px; flex-shrink: 0;")
    facts = column(f'<div style="display: flex; align-items: center; gap: 18px; height: 22px; font-size: 12px; color: {MUTED};"><span style="display: inline-flex; align-items: center; gap: 6px;">{icon("check-circle", 13, NAVTEXT)}Last ticket · Delivery running late · driver called back</span><span style="display: inline-flex; align-items: center; gap: 6px;">{icon("globe", 13, NAVTEXT)}Captions in English, you answer in French</span></div>', extra="margin-top: 12px; flex-shrink: 0;")
    queue = column(f'''<div style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: {MUTED}; margin: 22px 0 4px;">ALSO WAITING</div>
<div style="display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid {SHEET_LINE};"><span style="display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: {BAR}; font-size: 12px; font-weight: 600;">2</span><div style="flex: 1;"><strong style="display: block; font-size: 14px; font-weight: 600;">+41 79 555 01 22</strong><span style="font-size: 12px; color: {MUTED};">Phone · language on answer · waiting 0:09</span></div><span style="font-size: 12px; color: {MUTED};">offered to Tomás next</span></div>
<p style="font-size: 12px; color: {MUTED}; margin-top: 16px; line-height: 1.5;">Answer to start captions. When a caller has held more than two minutes, your first reply apologises for the wait on its own — unless you pick a sound.</p>''', extra="flex: 1; min-height: 0; overflow: hidden;")
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Incoming call", "Marie Dubois · +33 6 12 34 56 78 · language on answer")
        + tabs([("Captions", True, False), ("Notes", False, False)])
        + strip + who + facts + queue
        + ask("Ask about this caller"))
    return window("desk", inner)

def desk_ticket():
    state = f'{dot("green")}<span style="margin-left: 6px;">LISTENING</span>'
    strip = column(f'<div style="display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 12px; border-radius: 8px; background: {BAR};"><span style="display: flex; align-items: center; font-size: 11px; font-weight: 600; letter-spacing: 1.4px; color: {GREEN};">{state}</span><span style="font-size: 12px; color: {MUTED};">Hold ⌥ to speak from any tab · Marie is on the line</span></div>', extra="margin-top: 18px; flex-shrink: 0;")
    toggle = f'<span style="display: inline-flex; align-items: center; width: 34px; height: 20px; padding: 2px; border-radius: 999px; background: {INK};"><span style="width: 16px; height: 16px; border-radius: 50%; background: #FFF; margin-left: auto;"></span></span>'
    form = column(f'''<div style="display: flex; flex-direction: column; gap: 10px;">
  {_field("Summary", "Lift stuck on floor 4; caller waiting in the lobby. Driver two stops away.", tall=True)}
  <div style="display: flex; gap: 12px;">{_field("Address or location", "12 rue de la Paix, 75002 Paris")}{_field("Order", "#4821 · Dubois")}</div>
  <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid {SHEET_LINE}; border-radius: 9px; background: {SHEET};">{toggle}<div style="flex: 1;"><strong style="display: block; font-size: 13px; font-weight: 600;">Dispatch requested</strong><span style="font-size: 12px; color: {MUTED};">Confirm with the caller before ending the call</span></div><span style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: {GREEN};">{icon("check", 12, GREEN, "2.4")}confirmed</span></div>
  {_field("Anything else", "Buzzer at the entrance is broken — the driver should call on arrival.")}
</div>''', extra="margin-top: 16px; flex: 1; min-height: 0; overflow: hidden;")
    foot = column(f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid {SHEET_LINE};"><span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: {MUTED};">{icon("check-circle", 13, GREEN)}Saved as you type · goes to Zendesk with the transcript when the call ends</span><div style="display: flex; gap: 8px;">{_btn("Send now", "send", "ghost", h=34, pad=12)}{_btn("Back to captions", None, "ink", h=34, pad=12)}</div></div>', extra="margin-top: 12px; padding-bottom: 16px; flex-shrink: 0;")
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Marie Dubois", "Live · 05:48 · +33 6 12 34 56 78 · French, detected")
        + tabs([("Captions", False, False), ("Notes", True, False)])
        + strip + form + foot)
    return window("desk", inner)

def desk_ended():
    def done(text, ico="check-circle", tone=GREEN):
        return f'<span style="display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: {BAR}; font-size: 12px; font-weight: 500; color: {tone};">{icon(ico, 13, tone)}{text}</span>'
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Call ended", "Marie Dubois · 06:41 · French · spoke as Nina, mostly apologetic")
        + tabs([("Notes", False, False), ("Transcript", False, False), ("Summary", True, False)])
        + column(f'<div style="display: flex; flex-wrap: wrap; gap: 8px;">{done("Transcript saved")}{done("Ticket #4821 sent to Zendesk")}{done("Dispatch confirmed by Tom")}{done("Caller heard 4 of 4 replies", "volume")}</div>', extra="margin-top: 18px; flex-shrink: 0;")
        + body('<p style="font-size: 15px; color: %s;">Order 4821: stuck lift, caller waiting in the lobby. Driver two stops away; she will wait fifteen minutes.</p>' % MUTED
               + h3("What was agreed")
               + ul(["Driver arrives around 10:30; Marie waits at the downstairs door.", "The buzzer is broken — the driver calls on arrival.", "If it slips past 10:45, call her back on the same number."])
               )
        + column(f'<div style="display: flex; align-items: center; gap: 10px; padding: 14px 0 16px; border-top: 1px solid {SHEET_LINE};">{_btn("Next call", "phone", "ink", pad=20)}{_btn("Open the record", "chev-right", "ghost")}<span style="margin-left: auto; font-size: 12px; color: {MUTED};">2 waiting · you are next</span></div>', extra="flex-shrink: 0;"))
    return window("desk", inner)

def record_screen():
    def feel(label, on=False, done=False):
        mark = (" " + icon("check", 11, "#FFF" if on else GREEN, "2.4")) if done else ""
        return f'<button aria-pressed="{"true" if on else "false"}" style="display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid {INK if on else SHEET_LINE}; background: {INK if on else SHEET}; color: {"#FFF" if on else INK}; font: {600 if on else 500} 12px/1 {SANS};">{label}{mark}</button>'
    pills = "".join([feel("Calm", done=True), feel("Warm", done=True), feel("Energetic", on=True), feel("Reassuring"), feel("Apologetic"), feel("Firm")])
    picker = column(f'<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;"><span style="font-size: 10px; font-weight: 600; letter-spacing: 1.3px; color: {MUTED}; margin-right: 4px;">TAKE</span>{pills}<span style="margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: {BAR}; font-size: 12px; font-weight: 600;">{icon("globe", 13)}French {icon("chev-down", 12, NAVTEXT)}</span></div>', extra="margin-top: 18px; flex-shrink: 0;")
    script = column(f'''<div style="padding: 18px 20px; border-radius: 14px; background: {BAR};">
  <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: {MUTED}; margin-bottom: 10px;"><span style="font-weight: 600; letter-spacing: 1.3px; font-size: 10px; white-space: nowrap;">READ THIS ALOUD</span><span>Bright and quick, the way you speak when something needs doing now · 45–60 s</span></div>
  <p style="font-size: 16px; line-height: 1.6; letter-spacing: -.1px;">La bise et le soleil se disputaient, chacun assurant qu’il était le plus fort, quand ils ont vu un voyageur qui s’avançait, enveloppé dans son manteau. Merci d’avoir appelé — pouvez-vous me donner le numéro de commande ? C’est le quatre, huit, deux, un, au nom de Dubois. Le chauffeur est à deux arrêts, environ quinze minutes.</p>
</div>''', extra="margin-top: 14px; flex: 1; min-height: 0; overflow: hidden;")
    rec = column(f'<div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 0 16px; border-top: 1px solid {SHEET_LINE};">{_btn("Record my voice", "mic", "ink", h=48, pad=26)}<span style="font-size: 12px; color: {MUTED};">One speaker. No music. Keep one feeling for the whole passage.</span><span style="font-size: 12px; color: {INK}; font-weight: 600;">Use an existing recording</span></div>', extra="flex-shrink: 0;")
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Read. Record. Ready.", "One take per feeling. The desk picks the take that matches how you spoke.")
        + tabs([("Your voice", False, False), ("Takes", True, False), ("Avatar", False, False), ("Library", False, False)])
        + picker + script + rec)
    return window("voice", inner)

def seat_screen():
    who = column(f'''<div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid {SHEET_LINE}; border-radius: 12px; background: {SHEET};">
  <span style="font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: {MUTED}; white-space: nowrap;">ANSWERING AS</span>
  <span style="display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border: 1px solid {SHEET_LINE}; border-radius: 9px; background: #FFF; font-size: 13px; color: #8F8B83; min-width: 220px;">{icon("user-circle", 15, NAVTEXT)}Choose your name…<span style="margin-left: auto;">{icon("chev-down", 13, NAVTEXT)}</span></span>
  <span style="font-size: 12px; color: {MUTED};">Calls ring the name you choose. Your voice, takes and desk come with it.</span>
</div>''', extra="margin-top: 18px; flex-shrink: 0;")
    inner = (toolbar(back=False, right=("more", "expand"))
        + title("Desk", "Nobody answering yet")
        + tabs([("Captions", True, False), ("Notes", False, False)])
        + who
        + column(f'<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: {MUTED};">{icon("audio", 34, "#9A958B")}<p style="font: 400 22px/1.3 {SERIF}; color: {INK}; margin-top: 14px;">The conversation appears here.</p><p style="font-size: 13px; margin-top: 6px;">Choose your name above to start receiving calls.</p></div>', extra="margin-top: 20px; flex: 1; min-height: 0;")
        + ask("Ask anything"))
    return window("desk", inner)

def caller_screen():
    W, H = 390, 844
    bars = "".join(f'<span style="display: block; width: 3px; height: {h}px; border-radius: 2px; background: {GREEN};"></span>' for h in [6, 12, 18, 10, 15, 7, 13])
    def cap(who, text, mine=False):
        return f'<div style="padding: 9px 0; border-top: 1px solid {SHEET_LINE};"><span style="display: block; font-size: 10px; font-weight: 600; letter-spacing: 1.2px; color: {AMBER if not mine else MUTED};">{who}</span><p style="font-size: 14px; line-height: 1.45; margin-top: 3px; color: {INK if not mine else NAVTEXT};">{text}</p></div>'
    captions = (f'<div style="width: 100%; margin-top: 22px; padding: 12px 14px 4px; border: 1px solid {SHEET_LINE}; border-radius: 14px; background: #FFF; text-align: left;">'
                f'<div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px;"><span style="font-size: 10px; font-weight: 600; letter-spacing: 1.3px; color: {MUTED};">CAPTIONS · IN YOUR LANGUAGE</span><span style="display: inline-flex; align-items: center; width: 34px; height: 20px; padding: 2px; border-radius: 999px; background: {INK};"><span style="width: 16px; height: 16px; border-radius: 50%; background: #FFF; margin-left: auto;"></span></span></div>'
                + cap("YOU", "It’s 4 8 2 1, under the name Dubois.", mine=True)
                + cap("NINA", "Thank you. The driver is two stops away, about fifteen minutes.")
                + cap("NINA", "Is the buzzer at the entrance working?")
                + '</div>')
    return doc(f'''<div style="position: relative; width: {W}px; height: {H}px; background: {PAPER}; padding: 0 24px; display: flex; flex-direction: column;">
  <header style="display: flex; align-items: center; justify-content: space-between; padding: 26px 0 18px; border-bottom: 1px solid {SHEET_LINE};"><div style="display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 650; letter-spacing: -.6px;">{logo_mark(24)}<span>NoteFIsh<span style="color: #77736B;">.</span></span></div><span style="display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border: 1px solid {LINE}; border-radius: 10px; background: #FFF; font-size: 12px;">{icon("globe", 13)}EN</span></header>
  <main style="flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 26px;">
    <div style="width: 92px; height: 92px; border-radius: 28px; display: grid; place-items: center; background: radial-gradient(circle at 28% 23%, #FFF, #E1DED7 72%, #CEC9BF); box-shadow: 0 10px 30px rgba(36,36,36,.08);">{puff("fish", "#2F6FE0", 56)}</div>
    <span style="font-size: 9px; font-weight: 600; letter-spacing: 1.6px; color: {MUTED}; margin-top: 18px;">ON THE LINE WITH NINA · 04:12</span>
    <h1 style="font: 400 32px/1.12 {SERIF}; letter-spacing: -1px; margin-top: 10px;">Just talk normally.</h1>
    <p style="font-size: 13.5px; color: {MUTED}; margin-top: 8px; max-width: 300px; line-height: 1.55;">Nina hears you in your language and answers in her own voice.</p>
    <div style="display: flex; align-items: center; gap: 10px; margin-top: 16px; padding: 8px 14px; border: 1px solid {SHEET_LINE}; border-radius: 12px; background: #FFF;"><span style="display: flex; align-items: center; gap: 3px; height: 18px;">{bars}</span><span style="font-size: 12px; color: {GREEN}; font-weight: 600;">Mic on</span></div>
    {captions}
    <div style="display: flex; gap: 10px; width: 100%; margin-top: 18px;">{_btn("Mute", "mic-off", "ghost", h=50, grow=True)}{_btn("Hang up", "phone-off", "red", h=50, grow=True)}</div>
  </main>
  <footer style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 0 24px; border-top: 1px solid {SHEET_LINE}; color: {MUTED}; text-align: center;"><p style="font-size: 11px; line-height: 1.5; max-width: 320px;">Your voice is sent for this call and translated for the person you’re talking to. It is never cloned.</p><span style="font-size: 10px;">Secure audio call in your browser</span></footer>
</div>''')
