import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SortableColumn<T> {
  key: string
  label: string
  /** Optional count rendered in muted gray after the label, e.g.
   *  "Agent (12)". Useful for showing row counts alongside the column
   *  name on header + totals row. */
  count?: number
  sortType: 'string' | 'number'
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  /** Optional value-extractor for sort comparison. Defaults to the render output. */
  sortValue?: (row: T) => string | number
  /** Extra class names applied to both header and cells. */
  className?: string
}

export interface SortableTableProps<T> {
  rows: T[]
  columns: SortableColumn<T>[]
  defaultSort: { key: string; dir: 'asc' | 'desc' }
  /**
   * Optional footer row rendered as a `<tfoot>` inside the same
   * table so columns line up with the data rows. The array is
   * keyed by column order (one ReactNode per column, in the same
   * order as `columns`). Use `null` for cells you want empty.
   */
  footer?: (ReactNode | null)[]
  /** Cap on rows rendered when collapsed. When rows.length exceeds
   *  this, a "View more (N)" toggle is shown above the footer. Sort
   *  applies to the full list before slicing, so the visible top-N
   *  reflects the active sort. */
  initialMaxRows?: number
  /** Optional per-row class hook for de-emphasizing rows whose data
   *  is degenerate (e.g. prompts that triggered zero LLM calls). */
  rowClassName?: (row: T) => string
}

/**
 * Generic table with click-to-sort headers. Header click toggles
 * direction on the active column; clicking a different column moves
 * the sort there in its default direction (desc for number, asc for
 * string).
 */
export function SortableTable<T>({
  rows,
  columns,
  defaultSort,
  footer,
  initialMaxRows,
  rowClassName,
}: SortableTableProps<T>) {
  const [sort, setSort] = useState(defaultSort)
  const [expanded, setExpanded] = useState(false)

  const sortedRows = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const accessor = col.sortValue ?? ((r: T) => String(col.render(r)))
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (col.sortType === 'number') {
        return (Number(av) || 0) - (Number(bv) || 0)
      }
      return String(av).localeCompare(String(bv))
    })
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [rows, columns, sort])

  // Slice after sort so the visible window reflects the current order.
  const hiddenCount =
    initialMaxRows && !expanded && sortedRows.length > initialMaxRows
      ? sortedRows.length - initialMaxRows
      : 0
  const visibleRows = hiddenCount > 0 ? sortedRows.slice(0, initialMaxRows) : sortedRows

  function onHeaderClick(col: SortableColumn<T>) {
    setSort((cur) => {
      if (cur.key === col.key) {
        return { key: col.key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
      }
      return { key: col.key, dir: col.sortType === 'number' ? 'desc' : 'asc' }
    })
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-b border-border">
          {columns.map((col) => {
            const isActive = col.key === sort.key
            const indicator = isActive ? (sort.dir === 'desc' ? '▾' : '▴') : ''
            return (
              <th
                key={col.key}
                onClick={() => onHeaderClick(col)}
                className={cn(
                  'font-normal py-1.5 px-2 cursor-pointer select-none whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  isActive && 'text-amber-500',
                  col.className,
                )}
              >
                {col.label}
                {typeof col.count === 'number' && (
                  <span className="ml-1.5 text-muted-foreground/50 font-normal">({col.count})</span>
                )}
                {indicator && <span className="ml-1">{indicator}</span>}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody className="font-mono">
        {visibleRows.map((row, i) => (
          <tr key={i} className={cn('border-b border-border/40', rowClassName?.(row))}>
            {columns.map((col) => (
              <td
                key={col.key}
                className={cn(
                  'py-1 px-2 text-foreground',
                  col.align === 'right' && 'text-right',
                  col.className,
                )}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
        {hiddenCount > 0 && (
          <tr className="border-b border-border/40">
            <td colSpan={columns.length} className="py-1.5 px-2 text-center">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-muted-foreground hover:text-foreground cursor-pointer hover:underline text-xs"
              >
                View more ({hiddenCount})
              </button>
            </td>
          </tr>
        )}
      </tbody>
      {footer && (
        <tfoot className="font-mono">
          <tr className="border-t border-border text-muted-foreground">
            {columns.map((col, i) => (
              <td
                key={col.key}
                className={cn(
                  'py-1.5 px-2 whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  col.className,
                )}
              >
                {footer[i] ?? ''}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}
