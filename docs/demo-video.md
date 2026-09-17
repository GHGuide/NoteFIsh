# NoteFish demo video

Use the deployed HTTPS call desk at https://notefish.onrender.com/desk. The demonstration is one browser conversation: English-speaking agent, French-speaking partner, translated French replies through the selected Fish voice. Twilio is not required.

## Before filming

- Use a laptop for the desk and a real phone for the partner. Wear headphones on both devices and keep both pages in the foreground.
- Select a ready voice. For your own clone, open Create voice, press Record my voice, read the visible passage naturally, stop, listen back, name it and confirm permission. Create it, wait for readiness, then preview it in French before choosing Use at call desk.
- Voice management stays in the library: preview, select, rename and archive/restore. The temporary no-login workspace shares its voices and saved calls with anyone who can open the site.
- Open the desk at a laptop-sized viewport (1440 × 900 is a useful recording size). Choose English / French. Focus view hides navigation while retaining the call controls and transcript.

## The take

1. Click Create call link. Allow microphone access and choose the laptop microphone if the browser offers several devices. The permission check finishes before the link is created, so the first held reply will not be lost to a prompt.
2. Copy the link and send it to your partner. It expires after ten minutes and works for one call. Keep the desk open so it can ring.
3. The partner opens the link on their phone, taps Appeler and allows microphone access. Click Answer call on the laptop.
4. Partner: “Bonjour, à quelle heure arrive ma livraison ?” Pause briefly. The laptop should hear the original French speech and show its English caption on the right.
5. Hold the speaking button or Space: “Your delivery will arrive tomorrow morning, between nine and eleven.” Release. The phone should play the French reply in the selected Fish voice. Wait for playback to finish before the next turn.
6. Partner: “Parfait, merci beaucoup.” Reply in English: “You’re welcome. Have a great day.” Release and let the French reply finish.
7. End call. Show the saved transcript. Reload the desk and choose that conversation from Saved conversations to demonstrate retention.

The reading passage for voice creation is deliberately visible above the recorder on laptops; on phones, the record/stop control stays near the passage while scrolling. Naming and permission appear after the recording. The passage is sent as the sample transcript; if you changed its words, update Recording details or clear the text before creating the voice.

## What counts as a successful take

A person must confirm the partner’s actual microphone is heard at the desk, English captions reflect the spoken French, the actual held English reply becomes French audio heard on the phone, and hangup retains the transcript. A played acknowledgment means the browser completed playback; it does not establish that a person heard it through their chosen output device.

Prerecorded audio, simulated call protocols, provider-generated previews, and passing automated tests are intermediate checks. Do not present them as a physical two-person conversation or proof of personal clone fidelity. If a call link expires or has already been used, create a new one. A phone that pauses browser audio offers an Enable audio recovery control.

## Microphone and language checks

During a call, **Mute** beside **End call** on the desk disables microphone replies and discards a recording in progress. **Unmute** enables hold-to-speak again. You still hear the caller and receive captions while muted; typed replies remain available. A reply already submitted continues unless you use Cancel reply / Stop playback. The caller has a separate microphone mute button on their phone.

If the phone cannot grant microphone access, open the full invitation link directly in Safari or Chrome. The caller page includes microphone help, a copyable full link, a retry button, and a cancel button while requesting access. Allow Microphone for the site and, if needed, for the browser in the phone settings. A request with no response now times out after 30 seconds; before the caller connects, the same unused invitation can be retried. Audio activation is separate from microphone permission, with an Enable audio button if the browser suspends playback.

During a call, change **Partner speaks** on the desk. The caller sees the updated call language without hanging up. New phrases and replies use that language; a reply already being generated or played finishes in its original language. Saved transcript rows retain their own language labels.

The recording preview uses the decoded audio duration, rather than the elapsed recording timer. Its seek slider, elapsed/total time, and waveform progress share the same audio element. The original sample is still sent to Fish when creating a voice.
