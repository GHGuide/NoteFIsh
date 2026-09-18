(function () {
  document.documentElement.classList.add('js');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // reveal on scroll
  const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('.reveal, .ul').forEach(el => io.observe(el));
  if (reduced) $$('.reveal').forEach(el => el.classList.add('in'));

  // hero: the companion pill runs through a call — detected, listening, holding, speaking
  const PUFF = '<svg class="puff" viewBox="0 0 100 100" aria-hidden="true"><circle cx="67" cy="51" r="14"/><circle cx="59.7" cy="67.3" r="14"/><circle cx="42" cy="74" r="14"/><circle cx="24.3" cy="67.3" r="14"/><circle cx="17" cy="51" r="14"/><circle cx="24.3" cy="34.7" r="14"/><circle cx="42" cy="28" r="14"/><circle cx="59.7" cy="34.7" r="14"/><circle cx="80" cy="36" r="12"/><circle cx="80" cy="66" r="12"/><circle cx="71" cy="51" r="11"/><ellipse cx="42" cy="51" rx="30" ry="26"/></svg>'; const WAVE = '<span class="wave"><i style="--h:8px;--d:0s"></i><i style="--h:14px;--d:.1s"></i><i style="--h:20px;--d:.2s"></i><i style="--h:11px;--d:.3s"></i><i style="--h:17px;--d:.4s"></i><i style="--h:9px;--d:.5s"></i></span>';
  const VOL = '<span class="dim2"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg></span>';
  const PHONE = '<span class="dim2"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg></span>';
  const MON = '<span class="dim2"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>';
  const STATES = [
    { label: 'Incoming', html: PUFF + PHONE + '<span>Incoming</span><span class="dim">+33 6 12 34 56 78 · French</span><span class="start">Answer</span>', caption: false, hold: 2600 },
    { label: 'Listening', html: PUFF + WAVE + '<span>Listening</span><span class="dim">EN ← FR</span><kbd>hold ⌥</kbd>', caption: true, hold: 3000 },
    { label: 'Holding', html: PUFF + '<span class="rec"></span><span>Recording</span>' + WAVE + '<span class="dim">release to send</span>', caption: true, hold: 2600 },
    { label: 'Speaking', html: PUFF + VOL + '<span>Playing in your voice</span><span class="bar"><i></i></span><span class="dim">0:03</span>', caption: true, hold: 3000 },
  ];
  const pill = $('#hero-pill'), cap = $('#hero-caption');
  if (pill && !reduced) {
    let i = 1;
    const show = () => { const st = STATES[i]; pill.classList.add('swap'); setTimeout(() => { pill.innerHTML = st.html; cap.classList.toggle('off', !st.caption); pill.classList.remove('swap'); }, 320); setTimeout(() => { i = (i + 1) % STATES.length; show(); }, st.hold + 320); };
    setTimeout(() => { i = 2; show(); }, 2800);
  }

  // count-up numbers
  const cio = new IntersectionObserver(entries => entries.forEach(e => { if (!e.isIntersecting) return; const el = e.target, to = +el.dataset.to; cio.unobserve(el); if (reduced) { el.textContent = to; return; } const t0 = performance.now(); const step = t => { const p = Math.min(1, (t - t0) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }), { threshold: .6 });
  $$('.count').forEach(el => cio.observe(el));

  // scroll-pinned flow: four steps
  $$('[data-words]').forEach(el => { const words = el.textContent.trim().split(' '); el.textContent = ''; words.forEach((w, i) => { const s = document.createElement('span'); s.className = 'w'; s.textContent = w; s.style.transitionDelay = `${i * 55}ms`; el.appendChild(s); }); });
  const tabs = $$('.flow-tabs button'), scenes = $$('.phone .scene'), copies = $$('.flow-copy > div');
  let step = 0;
  function setStep(n) { step = n; tabs.forEach((t, i) => t.setAttribute('aria-selected', i === n ? 'true' : 'false')); scenes.forEach((s, i) => s.classList.toggle('on', i === n)); copies.forEach((c, i) => c.classList.toggle('on', i === n)); }
  tabs.forEach(t => t.addEventListener('click', () => { setStep(+t.dataset.step); const target = $$('.flow-steps div')[+t.dataset.step]; if (target && window.innerWidth > 900) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + 10, behavior: reduced ? 'auto' : 'smooth' }); }));
  const sio = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) setStep($$('.flow-steps div').indexOf(e.target)); }), { rootMargin: '-45% 0px -45% 0px' });
  $$('.flow-steps div').forEach(d => sio.observe(d));

  // sticky card + rows
  const faces = $$('.shift-card .face'), rows = $$('.rows .row');
  const rio = new IntersectionObserver(entries => entries.forEach(e => { if (!e.isIntersecting) return; const n = +e.target.dataset.row; rows.forEach((r, i) => r.classList.toggle('on', i === n)); faces.forEach((f, i) => f.classList.toggle('on', i === n)); }), { rootMargin: '-40% 0px -40% 0px' });
  rows.forEach(r => rio.observe(r));

  // collage parallax
  const cards = $$('.pcard'); const board = $('.board');
  if (!reduced && cards.length) {
    let raf = 0; const base = new Map(cards.map(c => [c, c.style.transform || getComputedStyle(c).transform]));
    const update = () => { raf = 0; if (window.innerWidth <= 900) return; const r = board.getBoundingClientRect(); const mid = r.top + r.height / 2 - window.innerHeight / 2; cards.forEach(c => { const rot = c.classList.contains('press') ? -4 : c.classList.contains('sound') ? 2 : c.classList.contains('detect') ? -3 : 0; c.style.transform = `translateY(${(-mid * +c.dataset.speed).toFixed(1)}px) rotate(${rot}deg)`; }); };
    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true }); update();
  }

  // faq two-panel
  const answers = [
    'No. They hear a clone of your voice, built from about a minute of you reading aloud, speaking their language. The feeling comes from how you actually said it: the desk measures your clip and plays one of the six takes you recorded.',
    'Yes. Eighty-odd on the caller’s side. You keep speaking your own language. The desk works out theirs from the first phrase, or you can pin it. Captions always show in your language.',
    'Connect your phone number and it takes real phone calls. Or send the caller a one-use link that opens in their phone’s browser. When a call ends it goes onward as a ticket in your helpdesk, a webhook to whatever you run, or a plain export.',
    'Accents are fine. A noisy voice sample gets refused when you record it, which beats cloning it badly. On the call, push to talk means one side speaks at a time, so nothing talks over anything. If a reply can’t be confirmed as played, the desk tells you.',
    'A Mac and a headset. The desk runs beside whatever call you’re already on. Connect a phone number and it answers real calls too, from any browser. On the server side it’s one container behind an HTTPS address.',
    'Yes. Add agents to the roster and each gets a seat with their own voice takes, canned lines and layout. Incoming calls ring every seated agent and the first to answer takes it. Supervisors watch the floor without hearing audio.',
    'No. They call your number from any phone, or open a one-use link in the browser they already have and tap Call. Everything else happens on your side. They just hear you.',
    'Per seat. A single desk is free to try. For a floor of more than a few agents, talk to us.',
  ];
  $$('.faq-q button').forEach(b => b.addEventListener('click', () => { $$('.faq-q button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); $('#faq-asked').textContent = b.textContent; const a = $('#faq-answer'); a.textContent = answers[+b.dataset.q]; a.style.animation = 'none'; void a.offsetWidth; a.style.animation = ''; }));

})();
