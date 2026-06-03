import { LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dashboardThemes } from './registry'

interface ThemeSwitcherProps {
  activeId: string
  onSelect: (id: string) => void
}

/**
 * Inline segmented toggle in the home header — both dashboard views shown
 * side by side so it's obvious users can switch between them (no popup menu).
 */
export function ThemeSwitcher({ activeId, onSelect }: ThemeSwitcherProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {dashboardThemes.map((theme) => {
        const Icon = theme.icon ?? LayoutGrid
        const isActive = theme.id === activeId
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            aria-pressed={isActive}
            title={theme.description}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors cursor-pointer',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3 w-3" />
            {theme.name}
          </button>
        )
      })}
    </div>
  )
}
