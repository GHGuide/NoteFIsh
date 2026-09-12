// One workspace monitor survives page navigation. Provider training itself continues
// while checks pause; reaching the budget never changes a voice to failed.
export function monitorVoiceTraining({
  getState, refreshVoice, onVoice, onPaused,
  isVisible = () => !document.hidden,
  schedule = setTimeout, cancel = clearTimeout,
  intervalMs = 7000, timeoutMs = 20000, maxChecks = 18, maxFailures = 3,
}) {
  const attempts = new Map();
  let disposed = false, timer, controller, sequence = 0;
  const next = () => { if (!disposed) timer = schedule(check, intervalMs); };
  const pause = (id, entry) => {
    entry.paused = true;
    onPaused(id, 'Automatic checks are paused. Refresh this voice’s status to check again.');
  };
  const check = async () => {
    const { voices, calls } = getState();
    const training = voices.filter(voice => voice.status === 'training' && !voice.archived && !voice.archivedAt);
    for (const id of attempts.keys()) if (!training.some(voice => voice.id === id)) attempts.delete(id);
    if (!isVisible() || calls.some(call => ['ringing', 'in_call', 'active'].includes(call.state || call.status))) { next(); return; }
    const voice = training.filter(item => !attempts.get(item.id)?.paused)
      .sort((a, b) => (attempts.get(a.id)?.lastCheck || 0) - (attempts.get(b.id)?.lastCheck || 0))[0];
    if (!voice) { next(); return; }
    const entry = attempts.get(voice.id) || { checks: 0, failures: 0 };
    if (entry.checks >= maxChecks) { pause(voice.id, entry); next(); return; }
    entry.checks += 1;
    entry.lastCheck = ++sequence;
    attempts.set(voice.id, entry);
    controller = new AbortController();
    const timeout = schedule(() => controller?.abort(), timeoutMs);
    try {
      const result = await refreshVoice(voice.id, { signal: controller.signal });
      if (disposed) return;
      if (controller.signal.aborted || result?.voice?.id !== voice.id || !['training', 'ready', 'failed'].includes(result?.voice?.status)) throw new Error('Voice status could not be checked.');
      entry.failures = 0;
      if (result?.voice) onVoice(result.voice);
      if (result?.voice?.status === 'training' && entry.checks >= maxChecks) pause(voice.id, entry);
    } catch {
      if (disposed) return;
      entry.failures += 1;
      if (entry.failures >= maxFailures || entry.checks >= maxChecks) pause(voice.id, entry);
    } finally {
      cancel(timeout);
      controller = null;
      next();
    }
  };
  next();
  return () => { disposed = true; cancel(timer); controller?.abort(); };
}

// A late provider response must not undo a rename, archive, or newer ready state.
export function mergeTrainingStatus(voices, updated) {
  return voices.map(voice => voice.id === updated.id && voice.status === 'training' && !voice.archived && !voice.archivedAt
    ? { ...voice, status: updated.status, error: updated.error }
    : voice);
}
