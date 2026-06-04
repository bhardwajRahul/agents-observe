/** Client-side tuning for activity pulses from the server.
 *
 *  Server-side throttle (see app/server/src/websocket.ts) caps pings at
 *  one per session per 10s. The pulse animation should fade within the
 *  window so sessions look "quiet" between pings instead of continuously
 *  animating.
 *
 *  `pulseDurationMs` is only the DEFAULT. Users can change how long the
 *  active-session indicator stays lit — or disable it — in Settings →
 *  Display → Sidebar. The live values come from the UI store
 *  (`activeIndicatorEnabled` / `activeIndicatorSeconds`). */
export const ACTIVITY_CONFIG = {
  pulseDurationMs: 10_000,
} as const
