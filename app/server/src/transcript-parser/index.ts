import type { EventStore } from '../storage/types'
import type {
  TranscriptStatsV2,
  TranscriptByModelV2,
  TranscriptPrompt,
  TranscriptSubagent,
  TranscriptParseError,
  TranscriptCall,
  TranscriptUsage,
} from './types'
import { parseClaudeSession } from './agents/claude'
import { getModelsPricing, type ModelPricing } from './models-pricing'

export type { TranscriptStatsV2 } from './types'

/**
 * Top-level entry. The caller (route handler) is responsible for the
 * feature flag, file-not-found, EACCES, and too-large checks — those
 * happen on the main transcript path *before* this entrypoint is
 * called. This function assumes the main transcript exists and is
 * readable.
 */
export async function parseSessionTranscripts(
  sessionId: string,
  store: EventStore,
  containerTranscriptPath: string,
): Promise<TranscriptStatsV2> {
  const agents = (await store.getAgentsForSession(sessionId)) ?? []
  const errors: TranscriptParseError[] = []

  // Group by agent_class for dispatch. v1: claude-code only.
  const claudeAgents = agents.filter((a: any) => (a.agent_class ?? 'claude-code') === 'claude-code')
  const otherAgents = agents.filter((a: any) => (a.agent_class ?? 'claude-code') !== 'claude-code')

  for (const a of otherAgents) {
    errors.push({
      scope: 'main',
      agentId: a.id,
      code: 'parse_error',
      message: `Agent class "${a.agent_class}" not supported for transcript stats yet.`,
    })
  }

  // The session's main agent has the same id as the session. Anything else is a subagent.
  const subagentIds = claudeAgents.map((a: any) => a.id as string).filter((id) => id !== sessionId)

  const result = await parseClaudeSession(containerTranscriptPath, subagentIds)
  errors.push(...result.errors)

  const pricingMap = await getModelsPricing()

  const subagents = attachSubagentCosts(result.subagents, pricingMap)
  const byModel = aggregateByModel(result.calls, subagents, pricingMap)
  const prompts = aggregatePrompts(result.calls, result.prompts, subagents, pricingMap)
  const summary = aggregateSummary(result.calls, subagents, pricingMap)
  const models = buildModelsMap(
    byModel.map((m) => m.model),
    pricingMap,
  )

  return {
    source: 'jsonl',
    summary,
    byModel,
    prompts,
    subagents,
    models,
    errors,
  }
}

// ── cost helpers ──────────────────────────────────────────────────

function computeCallCostCents(usage: TranscriptUsage, pricing: ModelPricing): number {
  const dollars =
    (usage.inputTokens * pricing.inputPerM +
      usage.outputTokens * pricing.outputPerM +
      usage.cacheReadTokens * pricing.cacheReadPerM +
      usage.cacheCreate5mTokens * pricing.cacheCreate5mPerM +
      usage.cacheCreate1hTokens * pricing.cacheCreate1hPerM) /
    1_000_000
  return Math.round(dollars * 100)
}

// ── aggregations ──────────────────────────────────────────────────

function aggregateByModel(
  mainCalls: TranscriptCall[],
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptByModelV2[] {
  const m = new Map<string, TranscriptByModelV2>()
  for (const c of mainCalls) {
    const cur = m.get(c.model) ?? {
      model: c.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
      costCents: 0,
    }
    cur.calls += 1
    cur.inputTokens +=
      c.usage.inputTokens +
      c.usage.cacheReadTokens +
      c.usage.cacheCreate5mTokens +
      c.usage.cacheCreate1hTokens
    cur.outputTokens += c.usage.outputTokens
    cur.cacheReadTokens += c.usage.cacheReadTokens
    cur.cacheCreate5mTokens += c.usage.cacheCreate5mTokens
    cur.cacheCreate1hTokens += c.usage.cacheCreate1hTokens
    m.set(c.model, cur)
  }
  for (const s of subagents) {
    const cur = m.get(s.model) ?? {
      model: s.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
      costCents: 0,
    }
    cur.calls += s.requests
    cur.inputTokens += s.inputTokens
    cur.outputTokens += s.outputTokens
    cur.cacheReadTokens += s.cacheReadTokens
    cur.cacheCreate5mTokens += s.cacheCreate5mTokens
    cur.cacheCreate1hTokens += s.cacheCreate1hTokens
    m.set(s.model, cur)
  }
  for (const row of m.values()) {
    const pricing = pricingMap[row.model]
    if (!pricing) {
      row.costCents = null
      continue
    }
    // Reverse-derive the "fresh" input slice (bundled total - cache parts).
    const fresh =
      row.inputTokens - row.cacheReadTokens - row.cacheCreate5mTokens - row.cacheCreate1hTokens
    row.costCents = computeCallCostCents(
      {
        inputTokens: Math.max(fresh, 0),
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheCreate5mTokens: row.cacheCreate5mTokens,
        cacheCreate1hTokens: row.cacheCreate1hTokens,
      },
      pricing,
    )
  }
  return [...m.values()]
}

function aggregatePrompts(
  mainCalls: TranscriptCall[],
  promptsIndex: Record<string, { text: string; timestamp: number }>,
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptPrompt[] {
  const buckets = new Map<string, TranscriptCall[]>()
  for (const c of mainCalls) {
    if (!c.promptId) continue
    const arr = buckets.get(c.promptId) ?? []
    arr.push(c)
    buckets.set(c.promptId, arr)
  }
  const sortedPromptIds = Object.keys(promptsIndex).sort(
    (a, b) => promptsIndex[a].timestamp - promptsIndex[b].timestamp,
  )

  const out: TranscriptPrompt[] = []
  for (let i = 0; i < sortedPromptIds.length; i++) {
    const promptId = sortedPromptIds[i]
    const promptMeta = promptsIndex[promptId]
    const calls = buckets.get(promptId) ?? []
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreate5mTokens = 0
    let cacheCreate1hTokens = 0
    let toolCount = 0
    const models = new Set<string>()
    let costCents: number | null = 0
    for (const c of calls) {
      inputTokens +=
        c.usage.inputTokens +
        c.usage.cacheReadTokens +
        c.usage.cacheCreate5mTokens +
        c.usage.cacheCreate1hTokens
      outputTokens += c.usage.outputTokens
      cacheReadTokens += c.usage.cacheReadTokens
      cacheCreate5mTokens += c.usage.cacheCreate5mTokens
      cacheCreate1hTokens += c.usage.cacheCreate1hTokens
      toolCount += c.toolUseIds.length
      if (c.model) models.add(c.model)
      const pricing = pricingMap[c.model]
      if (!pricing) {
        costCents = null
      } else if (costCents !== null) {
        costCents += computeCallCostCents(c.usage, pricing)
      }
    }
    // Attribute subagents to this prompt via toolUseId match in mainCalls.
    for (const s of subagents) {
      if (!s.toolUseId) continue
      const owner = mainCalls.find((c) => c.toolUseIds.includes(s.toolUseId!))
      if (!owner || owner.promptId !== promptId) continue
      inputTokens += s.inputTokens
      outputTokens += s.outputTokens
      cacheReadTokens += s.cacheReadTokens
      cacheCreate5mTokens += s.cacheCreate5mTokens
      cacheCreate1hTokens += s.cacheCreate1hTokens
      if (s.model) models.add(s.model)
      if (s.costCents == null) {
        costCents = null
      } else if (costCents !== null) {
        costCents += s.costCents
      }
    }
    const nextTimestamp =
      i + 1 < sortedPromptIds.length ? promptsIndex[sortedPromptIds[i + 1]].timestamp : null
    const durationMs = nextTimestamp ? nextTimestamp - promptMeta.timestamp : null

    // Skip prompts that produced no LLM activity. These are Claude's
    // internal command caveats (<local-command-caveat>, etc.) that get
    // injected as user-line prompts but never reach the model. They
    // clutter the table with 0-everything rows.
    if (calls.length === 0) continue

    out.push({
      promptId,
      text: promptMeta.text,
      timestamp: promptMeta.timestamp,
      durationMs,
      toolCount,
      requests: calls.length,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreate5mTokens,
      cacheCreate1hTokens,
      models: [...models],
      costCents,
    })
  }
  return out
}

function attachSubagentCosts(
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptSubagent[] {
  return subagents.map((s) => {
    const pricing = pricingMap[s.model]
    if (!pricing) return { ...s, costCents: null }
    const fresh = s.inputTokens - s.cacheReadTokens - s.cacheCreate5mTokens - s.cacheCreate1hTokens
    const costCents = computeCallCostCents(
      {
        inputTokens: Math.max(fresh, 0),
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreate5mTokens: s.cacheCreate5mTokens,
        cacheCreate1hTokens: s.cacheCreate1hTokens,
      },
      pricing,
    )
    return { ...s, costCents }
  })
}

function aggregateSummary(
  mainCalls: TranscriptCall[],
  subagents: TranscriptSubagent[],
  pricingMap: Record<string, ModelPricing>,
): TranscriptStatsV2['summary'] {
  let totalCalls = mainCalls.length
  let inputTotal = 0
  let outputTotal = 0
  let cacheRead = 0
  let costTotalCents: number | null = 0
  for (const c of mainCalls) {
    inputTotal +=
      c.usage.inputTokens +
      c.usage.cacheReadTokens +
      c.usage.cacheCreate5mTokens +
      c.usage.cacheCreate1hTokens
    outputTotal += c.usage.outputTokens
    cacheRead += c.usage.cacheReadTokens
    const pricing = pricingMap[c.model]
    if (!pricing) {
      costTotalCents = null
    } else if (costTotalCents !== null) {
      costTotalCents += computeCallCostCents(c.usage, pricing)
    }
  }
  for (const s of subagents) {
    totalCalls += s.requests
    inputTotal += s.inputTokens
    outputTotal += s.outputTokens
    cacheRead += s.cacheReadTokens
    if (s.costCents == null) {
      costTotalCents = null
    } else if (costTotalCents !== null) {
      costTotalCents += s.costCents
    }
  }
  return {
    totalCalls,
    inputTotal,
    outputTotal,
    cacheHitRate: inputTotal > 0 ? cacheRead / inputTotal : 0,
    costTotalCents,
  }
}

function buildModelsMap(
  modelIds: string[],
  pricingMap: Record<string, ModelPricing>,
): Record<string, { pricing: ModelPricing | null }> {
  const out: Record<string, { pricing: ModelPricing | null }> = {}
  for (const id of modelIds) {
    out[id] = { pricing: pricingMap[id] ?? null }
  }
  return out
}
