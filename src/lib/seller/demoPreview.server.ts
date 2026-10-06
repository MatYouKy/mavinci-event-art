import 'server-only';
// Bounded per-instance admission control complements the existing signed,
// rate-limited demo sessions. Preview never consumes a full-PDF generation.
const windows = new Map<string, { until: number; count: number; active: boolean }>();
let active = 0;
let globalWindow = { until: 0, count: 0 };
export function claimDemoPreview(session: string): (() => void) | null {
  const now = Date.now();
  for (const [key, value] of windows) if (value.until < now && !value.active) windows.delete(key);
  if (globalWindow.until < now) globalWindow = { until: now + 60000, count: 0 };
  const current = windows.get(session);
  const window = current && (current.until > now || current.active) ? current : { until: now + 60000, count: 0, active: false };
  if (window.active || window.count >= 30 || active >= 4 || globalWindow.count >= 120 || (!current && windows.size >= 500)) return null;
  window.count++; window.active = true; active++; globalWindow.count++;
  windows.set(session, window);
  return () => { window.active = false; active--; };
}
