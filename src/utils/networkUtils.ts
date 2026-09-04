/**
 * Shared helpers for deciding when to use offline scan/cache paths.
 */

export function shouldUseOfflineScanPath(isOnline: boolean): boolean {
  return !navigator.onLine || !isOnline;
}

export function isLikelyNetworkError(error: unknown): boolean {
  if (!navigator.onLine) return true;

  const msg = (
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error ?? '')
  ).toLowerCase();

  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('connection') ||
    msg.includes('offline')
  );
}
