export function microphoneIssue(error, { secure = true, supported = true } = {}) {
  if (!secure || !supported) return 'unsupported';
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'blocked';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return 'missing';
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error?.name)) return 'busy';
  return 'failed';
}
