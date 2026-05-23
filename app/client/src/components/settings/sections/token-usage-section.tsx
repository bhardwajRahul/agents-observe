import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import {
  api,
  type TranscriptStatsErrorCode,
  type TranscriptStatsByModel,
  type TranscriptStatsModelPricing,
  type TranscriptStatsPrompt,
} from '@/lib/api-client'
import { AgentLabel } from '@/components/shared/agent-label'
import { getAgentColorById, buildAgentColorMap } from '@/lib/agent-utils'
import type { Agent } from '@/types'
import { useMemo } from 'react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { ModelBadge } from './model-badge'
import { SortableTable, type SortableColumn } from './sortable-table'

function fmt(n: number): string {
  return n.toLocaleString()
}
function fmtCents(c: number | null): string {
  if (c == null) return '—'
  return `$${(c / 100).toFixed(2)}`
}
function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`
}
function fmtUsd(n: number, decimals = 4): string {
  return `$${n.toFixed(decimals)}`
}

/**
 * Tooltip-wrapped cost cell. Two modes:
 *
 * - **Single-model** (one pricing object): renders a mini table with
 *   per-line cost computed at the model's rate.
 * - **Multi-model** (array of pricings): the per-line cost column is
 *   omitted (the bundled tokens can't be split cleanly across models);
 *   the Rate column shows a range (min–max across models). Total at
 *   the bottom is the server-computed total — accurate even though
 *   per-line is just an approximation.
 *
 * Falls back to the bare cost string when pricing is fully unknown.
 */
function CostCell({
  costCents,
  pricings,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreate5mTokens,
  cacheCreate1hTokens,
}: {
  costCents: number | null
  /** One pricing for single-model rows, multiple for multi-model (prompts). */
  pricings: TranscriptStatsModelPricing[]
  /** Bundled input (fresh + cache_read + cache_write). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
}) {
  if (costCents == null || pricings.length === 0) {
    return <span className="text-amber-500">{fmtCents(costCents)}</span>
  }
  const fresh = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheCreate5mTokens - cacheCreate1hTokens,
  )
  const multi = pricings.length > 1

  // For single-model: rate is a single number. For multi-model: format as a range.
  function fmtRate(values: number[]): string {
    if (values.length === 0) return '—'
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (min === max) return `$${min.toFixed(2)}`
    return `$${min.toFixed(2)}–$${max.toFixed(2)}`
  }

  const lines: Array<{
    label: string
    tokens: number
    rates: number[]
    /** Per-line cost in $ — only meaningful for single-model. */
    cost: number
  }> = [
    {
      label: 'Input',
      tokens: fresh,
      rates: pricings.map((p) => p.inputPerM),
      cost: (fresh * pricings[0].inputPerM) / 1_000_000,
    },
    {
      label: 'Output',
      tokens: outputTokens,
      rates: pricings.map((p) => p.outputPerM),
      cost: (outputTokens * pricings[0].outputPerM) / 1_000_000,
    },
    {
      label: 'Cache read',
      tokens: cacheReadTokens,
      rates: pricings.map((p) => p.cacheReadPerM),
      cost: (cacheReadTokens * pricings[0].cacheReadPerM) / 1_000_000,
    },
    {
      label: 'Cache write (5m)',
      tokens: cacheCreate5mTokens,
      rates: pricings.map((p) => p.cacheCreate5mPerM),
      cost: (cacheCreate5mTokens * pricings[0].cacheCreate5mPerM) / 1_000_000,
    },
    {
      label: 'Cache write (1h)',
      tokens: cacheCreate1hTokens,
      rates: pricings.map((p) => p.cacheCreate1hPerM),
      cost: (cacheCreate1hTokens * pricings[0].cacheCreate1hPerM) / 1_000_000,
    },
  ]
  const total = costCents / 100
  // Column count for the Total row's colSpan.
  const totalColSpan = multi ? 2 : 3
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-amber-500 cursor-help">{fmtCents(costCents)}</span>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          align="start"
          className="!bg-popover !text-popover-foreground border border-border max-w-md p-3 shadow-md"
        >
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-2">
            Cost breakdown{multi && ' · multiple models'}
          </div>
          <table className="font-mono text-[11px] border-separate" style={{ borderSpacing: '0 0' }}>
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal pb-1.5 pr-4">Item</th>
                <th className="text-right font-normal pb-1.5 px-4">Tokens</th>
                <th className="text-right font-normal pb-1.5 px-4">Rate ($/M)</th>
                {!multi && <th className="text-right font-normal pb-1.5 pl-4">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td className="py-0.5 pr-4 text-muted-foreground">{l.label}</td>
                  <td className="py-0.5 px-4 text-right">{l.tokens.toLocaleString()}</td>
                  <td className="py-0.5 px-4 text-right text-muted-foreground">
                    {fmtRate(l.rates)}
                  </td>
                  {!multi && <td className="py-0.5 pl-4 text-right">{fmtUsd(l.cost)}</td>}
                </tr>
              ))}
              <tr className="border-t border-border/40">
                <td
                  className="pt-2 text-muted-foreground uppercase text-[9px] pr-4"
                  colSpan={totalColSpan}
                >
                  Total
                </td>
                <td className={`pt-2 text-right text-amber-500 font-medium ${multi ? 'px-4' : 'pl-4'}`}>
                  {fmtUsd(total, 2)}
                </td>
              </tr>
            </tbody>
          </table>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  }
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

const ERROR_MESSAGES: Record<TranscriptStatsErrorCode, string> = {
  disabled:
    "Session transcript parsing isn't enabled — set AGENTS_OBSERVE_TRANSCRIPT_STATS=1 to see models and token usage.",
  no_transcript:
    'Session transcript not available — models and token usage info not available for this session.',
  file_not_found: 'Session transcript file not found — models and token usage info not available.',
  file_unreadable:
    "Session transcript exists but isn't readable by the server — check the bind-mount permissions.",
  file_too_large: 'Session transcript exceeds the 100 MB safety cap — token stats skipped.',
  parse_error: "Couldn't parse this session's transcript — token usage info isn't available.",
  unknown: 'Token usage info is unavailable for this session.',
}

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border mb-3 overflow-hidden">
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}

function Card({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${valueClass ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

/**
 * Renders an agent name with the existing AgentLabel (tooltip + color)
 * wrapped in a button that closes the modal and scrolls the event
 * stream to the agent's first event.
 */
function AgentNameCell({
  agentId,
  agents,
  agentColorMap,
  onClick,
}: {
  agentId: string
  agents: Agent[]
  agentColorMap: Map<string, number>
  onClick: (agentId: string) => void
}) {
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) {
    return <span className="font-mono text-muted-foreground">{agentId.slice(0, 12)}</span>
  }
  const parentAgent = agent.parentAgentId
    ? (agents.find((a) => a.id === agent.parentAgentId) ?? null)
    : null
  const color = getAgentColorById(agentId, agentColorMap)
  return (
    <button
      type="button"
      className={`cursor-pointer hover:underline ${color.textOnly}`}
      onClick={() => onClick(agentId)}
    >
      <AgentLabel agent={agent} parentAgent={parentAgent} />
    </button>
  )
}

export function TokenUsageSection({
  sessionId,
  mainAgentId,
  agents,
  onAgentClick,
  onPromptClick,
}: {
  sessionId: string
  /** Agent id of the main session agent (== session id for claude-code). */
  mainAgentId: string
  agents: Agent[]
  onAgentClick: (agentId: string) => void
  onPromptClick: (text: string, timestamp: number) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['transcript-stats', sessionId],
    queryFn: () => api.getTranscriptStats(sessionId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  if (isLoading || !data) {
    return (
      <SectionShell title="Token Usage">
        <div className="text-xs text-muted-foreground italic">Loading…</div>
      </SectionShell>
    )
  }

  if (!data.ok) {
    return (
      <SectionShell title="Token Usage">
        <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{ERROR_MESSAGES[data.error] ?? data.message}</span>
        </div>
      </SectionShell>
    )
  }

  const stats = data.data

  // ── By Model ────────────────────────────────────────────────
  const byModelCols: SortableColumn<TranscriptStatsByModel>[] = [
    {
      key: 'model',
      label: 'Model',
      sortType: 'string',
      render: (r) => <ModelBadge modelId={r.model} pricing={stats.models[r.model]?.pricing} />,
      sortValue: (r) => r.model,
    },
    {
      key: 'calls',
      label: 'Requests',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.calls),
      sortValue: (r) => r.calls,
    },
    {
      key: 'input',
      label: 'Input',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.inputTokens),
      sortValue: (r) => r.inputTokens,
    },
    {
      key: 'output',
      label: 'Output',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.outputTokens),
      sortValue: (r) => r.outputTokens,
    },
    {
      key: 'cachePct',
      label: 'Cache %',
      sortType: 'number',
      align: 'right',
      render: (r) =>
        r.inputTokens > 0 ? (
          <span className="text-green-500">{fmtPct(r.cacheReadTokens / r.inputTokens)}</span>
        ) : (
          '—'
        ),
      sortValue: (r) => (r.inputTokens > 0 ? r.cacheReadTokens / r.inputTokens : 0),
    },
    {
      key: 'cacheRead',
      label: 'Cache read',
      sortType: 'number',
      align: 'right',
      render: (r) => <span className="text-muted-foreground">{fmt(r.cacheReadTokens)}</span>,
      sortValue: (r) => r.cacheReadTokens,
      className: 'border-l border-border/30',
    },
    {
      key: 'cacheWrite',
      label: 'Cache write',
      sortType: 'number',
      align: 'right',
      render: (r) => (
        <span className="text-muted-foreground">
          {fmt(r.cacheCreate5mTokens + r.cacheCreate1hTokens)}
        </span>
      ),
      sortValue: (r) => r.cacheCreate5mTokens + r.cacheCreate1hTokens,
    },
    {
      key: 'cost',
      label: 'Est Cost',
      sortType: 'number',
      align: 'right',
      render: (r) => {
        const p = stats.models[r.model]?.pricing
        return (
          <CostCell
            costCents={r.costCents}
            pricings={p ? [p] : []}
            inputTokens={r.inputTokens}
            outputTokens={r.outputTokens}
            cacheReadTokens={r.cacheReadTokens}
            cacheCreate5mTokens={r.cacheCreate5mTokens}
            cacheCreate1hTokens={r.cacheCreate1hTokens}
          />
        )
      },
      sortValue: (r) => r.costCents ?? 0,
      className: 'border-l border-border/30',
    },
  ]

  // ── By Prompt ────────────────────────────────────────────────
  const promptCols: SortableColumn<TranscriptStatsPrompt>[] = [
    {
      key: 'prompt',
      label: 'Prompt',
      sortType: 'string',
      render: (r) => (
        <button
          type="button"
          onClick={() => onPromptClick(r.text, r.timestamp)}
          className="block truncate max-w-[400px] text-left cursor-pointer hover:underline"
          title={r.text}
        >
          {r.text}
        </button>
      ),
      sortValue: (r) => r.text,
    },
    {
      key: 'duration',
      label: 'Duration',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.durationMs == null ? '—' : fmtMs(r.durationMs)),
      sortValue: (r) => r.durationMs ?? 0,
    },
    {
      key: 'tools',
      label: 'Tools',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.toolCount),
      sortValue: (r) => r.toolCount,
    },
    {
      key: 'requests',
      label: 'Requests',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.requests),
      sortValue: (r) => r.requests,
    },
    {
      key: 'input',
      label: 'Input',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.inputTokens),
      sortValue: (r) => r.inputTokens,
    },
    {
      key: 'output',
      label: 'Output',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.outputTokens),
      sortValue: (r) => r.outputTokens,
    },
    {
      key: 'models',
      label: 'Model',
      sortType: 'string',
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.models.map((m) => (
            <ModelBadge key={m} modelId={m} pricing={stats.models[m]?.pricing} />
          ))}
        </span>
      ),
      sortValue: (r) => r.models.join(','),
    },
    {
      key: 'cost',
      label: 'Est Cost',
      sortType: 'number',
      align: 'right',
      render: (r) => {
        const pricings = r.models
          .map((m) => stats.models[m]?.pricing)
          .filter((p): p is NonNullable<typeof p> => !!p)
        return (
          <CostCell
            costCents={r.costCents}
            pricings={pricings}
            inputTokens={r.inputTokens}
            outputTokens={r.outputTokens}
            cacheReadTokens={r.cacheReadTokens}
            cacheCreate5mTokens={r.cacheCreate5mTokens}
            cacheCreate1hTokens={r.cacheCreate1hTokens}
          />
        )
      },
      sortValue: (r) => r.costCents ?? 0,
    },
  ]

  // Prompts totals row
  const promptTotals = {
    durationMs: stats.prompts.reduce((s, p) => s + (p.durationMs ?? 0), 0),
    toolCount: stats.prompts.reduce((s, p) => s + p.toolCount, 0),
    requests: stats.prompts.reduce((s, p) => s + p.requests, 0),
    inputTokens: stats.prompts.reduce((s, p) => s + p.inputTokens, 0),
    outputTokens: stats.prompts.reduce((s, p) => s + p.outputTokens, 0),
    costCents: stats.prompts.some((p) => p.costCents == null)
      ? null
      : stats.prompts.reduce((s, p) => s + (p.costCents ?? 0), 0),
  }

  // ── Agents (main + subagents) ────────────────────────────────
  // Build the agents table rows: row 0 is the main agent (derived
  // from main-call aggregates); subsequent rows are the subagents.
  // Inlined rather than useMemo'd because we're past the early-return
  // guards above and adding a hook here would violate Rules of Hooks.
  const mainAgentRow = (() => {
    let model = ''
    let cacheReadTokens = 0
    let cacheCreate5mTokens = 0
    let cacheCreate1hTokens = 0
    let inputTokens = 0
    let outputTokens = 0
    let requests = 0
    let costCents: number | null = 0
    for (const m of stats.byModel) {
      const subForModel = stats.subagents.filter((s) => s.model === m.model)
      const subRequests = subForModel.reduce((s, x) => s + x.requests, 0)
      const subInput = subForModel.reduce((s, x) => s + x.inputTokens, 0)
      const subOutput = subForModel.reduce((s, x) => s + x.outputTokens, 0)
      const subCacheRead = subForModel.reduce((s, x) => s + x.cacheReadTokens, 0)
      const subCache5m = subForModel.reduce((s, x) => s + x.cacheCreate5mTokens, 0)
      const subCache1h = subForModel.reduce((s, x) => s + x.cacheCreate1hTokens, 0)
      const subCost = subForModel.reduce<number | null>((acc, x) => {
        if (acc == null || x.costCents == null) return null
        return acc + x.costCents
      }, 0)

      const mainCalls = m.calls - subRequests
      if (mainCalls <= 0) continue
      requests += mainCalls
      inputTokens += m.inputTokens - subInput
      outputTokens += m.outputTokens - subOutput
      cacheReadTokens += m.cacheReadTokens - subCacheRead
      cacheCreate5mTokens += m.cacheCreate5mTokens - subCache5m
      cacheCreate1hTokens += m.cacheCreate1hTokens - subCache1h
      if (!model) model = m.model
      if (costCents == null || m.costCents == null) {
        costCents = null
      } else {
        const cost = subCost == null ? null : m.costCents - subCost
        if (cost == null) costCents = null
        else costCents += cost
      }
    }
    return {
      agentId: mainAgentId,
      agentType: 'main' as const,
      model,
      requests,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreate5mTokens,
      cacheCreate1hTokens,
      durationMs: 0,
      toolCount: 0,
      costCents,
    }
  })()

  // Combined rows for the "Agents" table: main first, then subagents.
  interface AgentRow {
    agentId: string
    agentType: string | null
    model: string
    requests: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreate5mTokens: number
    cacheCreate1hTokens: number
    durationMs: number
    toolCount: number
    costCents: number | null
    isMain: boolean
  }
  const agentRows: AgentRow[] = [
    { ...mainAgentRow, agentType: 'main', isMain: true },
    ...stats.subagents.map<AgentRow>((s) => ({
      agentId: s.agentId,
      agentType: s.agentType,
      model: s.model,
      requests: s.requests,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheCreate5mTokens: s.cacheCreate5mTokens,
      cacheCreate1hTokens: s.cacheCreate1hTokens,
      durationMs: s.durationMs,
      toolCount: s.toolCount,
      costCents: s.costCents,
      isMain: false,
    })),
  ]

  const agentCols: SortableColumn<AgentRow>[] = [
    {
      key: 'agent',
      label: 'Agent',
      sortType: 'string',
      render: (r) =>
        r.isMain ? (
          <span className="font-mono">main</span>
        ) : (
          <AgentNameCell
            agentId={r.agentId}
            agents={agents}
            agentColorMap={agentColorMap}
            onClick={onAgentClick}
          />
        ),
      sortValue: (r) => (r.isMain ? '' : r.agentId),
    },
    {
      key: 'type',
      label: 'Type',
      sortType: 'string',
      render: (r) => <span className="text-blue-300">{r.agentType ?? '—'}</span>,
      sortValue: (r) => r.agentType ?? '',
    },
    {
      key: 'duration',
      label: 'Duration',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.durationMs > 0 ? fmtMs(r.durationMs) : '—'),
      sortValue: (r) => r.durationMs,
    },
    {
      key: 'tools',
      label: 'Tools',
      sortType: 'number',
      align: 'right',
      render: (r) => (r.toolCount > 0 ? fmt(r.toolCount) : '—'),
      sortValue: (r) => r.toolCount,
    },
    {
      key: 'requests',
      label: 'Requests',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.requests),
      sortValue: (r) => r.requests,
    },
    {
      key: 'input',
      label: 'Input',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.inputTokens),
      sortValue: (r) => r.inputTokens,
    },
    {
      key: 'output',
      label: 'Output',
      sortType: 'number',
      align: 'right',
      render: (r) => fmt(r.outputTokens),
      sortValue: (r) => r.outputTokens,
    },
    {
      key: 'model',
      label: 'Model',
      sortType: 'string',
      render: (r) =>
        r.model ? <ModelBadge modelId={r.model} pricing={stats.models[r.model]?.pricing} /> : '—',
      sortValue: (r) => r.model,
    },
    {
      key: 'cost',
      label: 'Est Cost',
      sortType: 'number',
      align: 'right',
      render: (r) => {
        const p = r.model ? stats.models[r.model]?.pricing : null
        return (
          <CostCell
            costCents={r.costCents}
            pricings={p ? [p] : []}
            inputTokens={r.inputTokens}
            outputTokens={r.outputTokens}
            cacheReadTokens={r.cacheReadTokens}
            cacheCreate5mTokens={r.cacheCreate5mTokens}
            cacheCreate1hTokens={r.cacheCreate1hTokens}
          />
        )
      },
      sortValue: (r) => r.costCents ?? 0,
    },
  ]

  const agentTotals = {
    durationMs: agentRows.reduce((s, a) => s + a.durationMs, 0),
    toolCount: agentRows.reduce((s, a) => s + a.toolCount, 0),
    requests: agentRows.reduce((s, a) => s + a.requests, 0),
    inputTokens: agentRows.reduce((s, a) => s + a.inputTokens, 0),
    outputTokens: agentRows.reduce((s, a) => s + a.outputTokens, 0),
    costCents: agentRows.some((a) => a.costCents == null)
      ? null
      : agentRows.reduce((s, a) => s + (a.costCents ?? 0), 0),
  }

  return (
    <SectionShell title="Token Usage">
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-2">
          <Card label="Requests" value={fmt(stats.summary.totalCalls)} />
          <Card label="Total Input" value={fmt(stats.summary.inputTotal)} />
          <Card label="Total Output" value={fmt(stats.summary.outputTotal)} />
          <Card
            label="Cache Hit"
            value={fmtPct(stats.summary.cacheHitRate)}
            valueClass="text-green-500"
          />
          <Card
            label="Est Cost"
            value={fmtCents(stats.summary.costTotalCents)}
            valueClass="text-amber-500"
          />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
            By Model
          </div>
          <SortableTable
            rows={stats.byModel}
            columns={byModelCols}
            defaultSort={{ key: 'cost', dir: 'desc' }}
          />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
            By Prompt
          </div>
          {stats.prompts.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No prompts in this session.</div>
          ) : (
            <SortableTable
              rows={stats.prompts}
              columns={promptCols}
              defaultSort={{ key: 'cost', dir: 'desc' }}
              // Footer cells match promptCols order: Prompt · Duration · Tools · Requests · Input · Output · Model · Est Cost.
              footer={[
                <span className="uppercase text-[9px] tracking-wide">Total</span>,
                fmtMs(promptTotals.durationMs),
                fmt(promptTotals.toolCount),
                fmt(promptTotals.requests),
                fmt(promptTotals.inputTokens),
                fmt(promptTotals.outputTokens),
                null,
                <span className="text-amber-500">{fmtCents(promptTotals.costCents)}</span>,
              ]}
            />
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
            Agents
          </div>
          <SortableTable
            rows={agentRows}
            columns={agentCols}
            defaultSort={{ key: 'cost', dir: 'desc' }}
            // Footer cells match agentCols order: Agent · Type · Duration · Tools · Requests · Input · Output · Model · Est Cost.
            footer={[
              <span className="uppercase text-[9px] tracking-wide">Total</span>,
              null,
              agentTotals.durationMs > 0 ? fmtMs(agentTotals.durationMs) : '—',
              fmt(agentTotals.toolCount),
              fmt(agentTotals.requests),
              fmt(agentTotals.inputTokens),
              fmt(agentTotals.outputTokens),
              null,
              <span className="text-amber-500">{fmtCents(agentTotals.costCents)}</span>,
            ]}
          />
        </div>
      </div>
    </SectionShell>
  )
}
