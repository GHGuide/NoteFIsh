import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { audioPeaks, audioRms } from '../audio.js';

const BAR_COUNT = 48;
const EMPTY = Array(BAR_COUNT).fill(0);

/** Real microphone samples or a decoded recording. Never synthesizes activity. */
export default function AudioWaveform({ stream, blob, audioElement, active = false,
  className = '', height = 52, label = 'Audio activity', audioContext, analyser: suppliedAnalyser }) {
  const reducedMotion = useReducedMotion();
  const [peaks, setPeaks] = useState(EMPTY);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const displayHeight = Number.isFinite(height) ? Math.max(24, Math.min(160, height)) : 52;

  useEffect(() => {
    if ((!stream && !suppliedAnalyser) || !active) {
      if (!blob) { setPeaks(EMPTY); setLevel(0); setStatus('idle'); }
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || (!suppliedAnalyser && !stream.getAudioTracks?.().some(track => track.readyState === 'live'))) {
      setPeaks(EMPTY); setLevel(0); setStatus('unavailable'); return;
    }
    let context; let source; let analyser; let frame; let disposed = false; let lastUpdate = 0;
    const owned = !audioContext && !suppliedAnalyser;
    try {
      context = audioContext || suppliedAnalyser?.context || new Context({ latencyHint: 'interactive' });
      analyser = suppliedAnalyser || context.createAnalyser();
      if (!suppliedAnalyser) { analyser.fftSize = 2048; source = context.createMediaStreamSource(stream); source.connect(analyser); }
      // This analysis branch never connects a microphone to speakers and never
      // owns/stops the source MediaStream used for the actual recording/call.
      const samples = new Float32Array(analyser.fftSize);
      const tick = timestamp => {
        if (disposed) return;
        if (timestamp - lastUpdate >= (reducedMotion ? 180 : 50)) {
          lastUpdate = timestamp;
          const available = context.state === 'running' && (suppliedAnalyser || stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted));
          if (available) {
            analyser.getFloatTimeDomainData(samples);
            setPeaks(audioPeaks(samples, BAR_COUNT)); setLevel(audioRms(samples)); setStatus('live');
          } else { setPeaks(EMPTY); setLevel(0); setStatus('paused'); }
        }
        frame = requestAnimationFrame(tick);
      };
      if (owned && context.state !== 'running') context.resume().catch(() => {});
      frame = requestAnimationFrame(tick);
    } catch { setPeaks(EMPTY); setLevel(0); setStatus('unavailable'); }
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      try { source?.disconnect(); if (!suppliedAnalyser) analyser?.disconnect(); } catch {}
      if (owned) context?.close().catch(() => {});
    };
  }, [stream, active, audioContext, suppliedAnalyser, reducedMotion, blob]);

  useEffect(() => {
    if (!blob || ((stream || suppliedAnalyser) && active)) return;
    let disposed = false;
    setStatus('decoding'); setPeaks(EMPTY); setLevel(0);
    void (async () => {
      if (!(blob instanceof Blob) || blob.size > 30 * 1024 * 1024) throw new Error('Invalid recording');
      const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Context) throw new Error('Waveform unavailable');
      const context = new Context(1, 1, 16000);
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (disposed) return;
      if (!Number.isFinite(decoded.duration) || decoded.duration > 120) throw new Error('Recording is too long');
      const channels = Array.from({ length: Math.min(decoded.numberOfChannels, 2) }, (_, index) => audioPeaks(decoded.getChannelData(index), BAR_COUNT));
      const waveform = EMPTY.map((_, index) => Math.max(0, ...channels.map(channel => channel[index] || 0)));
      setPeaks(waveform); setLevel(0); setStatus('recorded');
    })().catch(() => { if (!disposed) { setPeaks(EMPTY); setStatus('unavailable'); } });
    return () => { disposed = true; };
  }, [blob, stream, suppliedAnalyser, active]);

  useEffect(() => {
    if (!audioElement?.addEventListener) { setProgress(0); return; }
    const update = () => setProgress(Number.isFinite(audioElement.duration) && audioElement.duration > 0
      ? Math.min(1, Math.max(0, audioElement.currentTime / audioElement.duration)) : 0);
    for (const event of ['timeupdate', 'seeking', 'loadedmetadata', 'emptied', 'ended']) audioElement.addEventListener(event, update);
    update();
    return () => { for (const event of ['timeupdate', 'seeking', 'loadedmetadata', 'emptied', 'ended']) audioElement.removeEventListener(event, update); };
  }, [audioElement]);

  const measured = active && status === 'live';
  const accessibleLabel = status === 'unavailable' ? `${label}. Visual preview unavailable.`
    : measured ? `${label}. Live audio signal.` : status === 'recorded' ? `${label}. Recorded audio waveform.` : `${label}. No live audio displayed.`;
  return <motion.div className={`audio-waveform ${measured ? 'is-live' : ''} ${status === 'recorded' ? 'is-recorded' : ''} ${className}`}
    data-audio-state={status} data-audio-level={measured ? Math.round(level * 100) : 0}
    initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : .18 }}>
    <svg viewBox={`0 0 480 ${displayHeight}`} width="100%" height={displayHeight} role="img" aria-label={accessibleLabel} preserveAspectRatio="none">
      {peaks.map((peak, index) => {
        // A fixed gain makes quiet speech legible without normalizing background
        // noise into a falsely loud signal. A flat baseline means silence.
        const amplitude = Math.min(1, peak * 2.4);
        const barHeight = Math.max(2, amplitude * (displayHeight - 8));
        return <rect key={index} x={index * 10 + 2.5} y={(displayHeight - barHeight) / 2} width="5" height={barHeight}
          rx="2.5" fill="currentColor" opacity={status === 'recorded' && progress > 0 && index / BAR_COUNT > progress ? .32 : peak < .008 ? .28 : 1} />;
      })}
    </svg>
  </motion.div>;
}
