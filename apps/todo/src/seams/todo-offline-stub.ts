export function isOfflineNow(): boolean {
  return false;
}

export function wasOfflineRecently(_ms: number): boolean {
  return false;
}

export function isNetworkFailure(_err: unknown): boolean {
  return false;
}
