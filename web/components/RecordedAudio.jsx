import React, { useEffect, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import AudioWaveform from './AudioWaveform.jsx';
import { audioBufferToWav, audioTime } from '../audio.js';

export default function RecordedAudio({ blob }) {
  const [preview, setPreview] = useState(null);
  const [element, setElement] = useState(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false; let url;
    setPreview(null); setTime(0); setPlaying(false); setError('');
    void (async () => {
      const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Context) throw new Error('Audio preview is unavailable in this browser.');
      const buffer = await new Context(1, 1, 24000).decodeAudioData(await blob.arrayBuffer());
      if (disposed) return;
      if (!buffer.length || buffer.duration > 120) throw new Error('Use a recording under two minutes.');
      url = URL.createObjectURL(audioBufferToWav(buffer));
      setPreview({ buffer, url, duration: buffer.duration });
    })().catch(failure => { if (!disposed) setError(failure.message || 'This recording could not be previewed. Try recording again.'); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [blob]);
  const toggle = async () => {
    if (!element) return;
    setError('');
    try { if (element.paused) await element.play(); else element.pause(); }
    catch { setError('Playback was blocked. Tap Play recording to try again.'); }
  };
  return <div className="recorded-player">
    {preview ? <>
      <AudioWaveform audioBuffer={preview.buffer} audioElement={element} height={48} label="Your recorded voice" />
      <audio hidden ref={setElement} src={preview.url} preload="auto" onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onSeeked={event => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError('The recording could not be played. Try recording again.')} />
      <div className="recorded-player-controls">
        <button type="button" className="icon-button" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={toggle}>{playing ? <Pause size={19} /> : <Play size={19} fill="currentColor" />}</button>
        <output aria-label="Recording playback time">{audioTime(time)} / {audioTime(preview.duration)}</output>
        <input aria-label="Recording position" aria-valuetext={`${audioTime(time)} of ${audioTime(preview.duration)}`} type="range" min="0" max={preview.duration} step="0.01" value={time} onChange={event => { const next = Number(event.target.value); if (element) element.currentTime = next; setTime(next); }} style={{ '--played': `${Math.min(100, time / preview.duration * 100)}%` }} />
      </div>
      <p className="recorded-duration">{preview.duration.toFixed(1)} seconds of audio</p>
    </> : !error && <p role="status">Preparing your recording…</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
