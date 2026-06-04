import { useState } from 'react'
import { Bell, Folder } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/components/theme-provider'
import { Checkbox } from '@/components/ui/checkbox'

export function GeneralSettings() {
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)
  const setDedupEnabled = useUIStore((s) => s.setDedupEnabled)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const activeIndicatorEnabled = useUIStore((s) => s.activeIndicatorEnabled)
  const setActiveIndicatorEnabled = useUIStore((s) => s.setActiveIndicatorEnabled)
  const activeIndicatorSeconds = useUIStore((s) => s.activeIndicatorSeconds)
  const setActiveIndicatorSeconds = useUIStore((s) => s.setActiveIndicatorSeconds)
  const { mode, setMode } = useTheme()

  // Local string state so the field edits freely; committed (clamped) on blur.
  const [secondsStr, setSecondsStr] = useState(String(activeIndicatorSeconds))
  const commitSeconds = () => {
    const n = Math.round(Number(secondsStr))
    if (Number.isFinite(n) && n >= 1) {
      const clamped = Math.min(600, n)
      setActiveIndicatorSeconds(clamped)
      setSecondsStr(String(clamped))
    } else {
      setSecondsStr(String(activeIndicatorSeconds))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Appearance</h3>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Theme</label>
          <div className="flex gap-1">
            {(['light', 'dark', 'system'] as const).map((opt) => (
              <button
                key={opt}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                  mode === opt
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
                onClick={() => setMode(opt)}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Event Stream</h3>
        {/* Rows are plain divs (not clickable labels) so only the checkbox
            toggles — clicking the description text won't flip the setting. */}
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              checked={dedupEnabled}
              onCheckedChange={(v) => setDedupEnabled(v === true)}
              aria-label="Event deduplication"
              className="mt-0.5 cursor-pointer"
            />
            <div>
              <div className="text-sm font-medium">
                Event deduplication
                <span className="mx-2 text-muted-foreground/70 font-xs">(Recommended)</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Groups related hook events into single rows. Combines PreToolUse and PostToolUse
                events into one tool row, individual events are shown in expanded row details.
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                When disabled, every hook event is shown as an individual row.
              </div>
              <div className="text-xs text-orange-500 dark:text-orange-400 mt-2">
                Changing this setting reloads the page.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Sidebar</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              checked={notificationsEnabled}
              onCheckedChange={(v) => setNotificationsEnabled(v === true)}
              aria-label="Show notification alerts"
              className="mt-0.5 cursor-pointer"
            />
            <div>
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                Show notification alerts
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Highlights sessions (and their parent projects) in the sidebar when an agent emits a
                Notification event and is waiting for your input. Click the bell to dismiss it for
                that session.
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-start gap-3">
              <Checkbox
                checked={activeIndicatorEnabled}
                onCheckedChange={(v) => setActiveIndicatorEnabled(v === true)}
                aria-label="Show active session indicator"
                className="mt-0.5 cursor-pointer"
              />
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 text-green-500 dark:text-green-400" />
                  Show active session indicator
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Pulses the session dot (and its project folder) green in the sidebar for a few
                  seconds after an agent sends activity, then fades.
                </div>
              </div>
            </div>
            <div className="mt-3 ml-7 flex items-center gap-2">
              <label htmlFor="active-indicator-seconds" className="text-xs text-muted-foreground">
                Stay lit for
              </label>
              <input
                id="active-indicator-seconds"
                type="number"
                min={1}
                max={600}
                value={secondsStr}
                disabled={!activeIndicatorEnabled}
                onChange={(e) => setSecondsStr(e.target.value)}
                onBlur={commitSeconds}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
