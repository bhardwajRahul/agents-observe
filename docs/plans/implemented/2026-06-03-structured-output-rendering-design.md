# StructuredOutput Event Rendering — Design

**Date:** 2026-06-03
**Status:** Approved

## Problem

Claude Code recently added the `StructuredOutput` tool, used by workflow subagents
(and the `schema` option of the `agent()` workflow hook) to emit validated,
schema-defined data. It fires the usual tool lifecycle hooks: `PreToolUse`,
`PostToolUse`, and `PostToolUseFailure`.

In agents-observe these events currently fall through to the generic `default`
tool handling: the row summary uses `tool_input.description || command || query`
(none of which exist), and the detail view dumps the payload as raw JSON. The
result is empty/uninformative rows and a wall of JSON in the detail panel.

`StructuredOutput` is unusual: its `tool_input` **is** the structured payload
(an arbitrary object whose shape is defined by the caller's schema — scalars,
nested objects, and arrays of objects like `findings[]`). The `tool_response` is
only the confirmation string `"Structured output provided successfully"` and
carries no useful information. On failure, `payload.error` is the schema
validation message (e.g. `must have required property 'findings'`) and
`tool_input` holds the rejected/partial output.

Tool Pre/Post pairing hides the Post event and displays the surviving Pre row,
but it only updates that row's `status`/`searchText`/`filters` — **not** its
payload. So the Pre row's own `tool_input` is often partial (just `summary`),
while the full schema data and the `error` (on `PostToolUseFailure`) live on the
hidden paired Post event. The detail view must read the structured data and error
from `pairedEvent.payload`, falling back to the Pre `tool_input`.

## Goals

- Give `StructuredOutput` events a distinct icon and an informative one-line
  summary in the event stream.
- Render the structured payload readably in the detail view (hybrid:
  elevate the `summary` field, show the rest as formatted JSON).
- On `PostToolUseFailure`, show both the attempted output and the schema error.

## Non-Goals

- A fully recursive, schema-aware structured renderer (cards per array item,
  etc.). Rejected in favor of the simpler hybrid approach.
- Showing the `tool_response` confirmation string.
- Any server-side / hook-capture changes. This is client-render only.

## Design

### 1. Icon

`app/client/src/lib/event-icon-registry.ts`: add
```ts
ToolStructuredOutput: {
  id: 'ToolStructuredOutput',
  name: 'Structured Output',
  group: 'Tools',
  icon: Braces,          // lucide-react
  defaultColor: CYAN,
}
```

`app/client/src/agents/claude-code/process-event.ts` (`pickIconId` map): add
`StructuredOutput: 'ToolStructuredOutput'`.

The framework's `computeSlots` then renders the `StructuredOutput` tool chip
automatically; no row-summary slot work needed.

### 2. Row summary

`app/client/src/agents/claude-code/helpers.ts` (`getToolSummary` switch): add
```ts
case 'StructuredOutput':
  return structuredOutputSummary(toolInput)
```
where `structuredOutputSummary` returns, in priority order (a string counts only
when it has ≥3 trimmed chars — single-char values like `"x"`/`"s"`/`"r"` are
skipped):
1. top-level `summary` field, if usable (passed through `oneLine`)
2. else `<id>: <refinedFix>` when a usable `refinedFix` string is present
   (review/fix workflows; the `<id>: ` prefix is dropped when `id` is absent)
3. else the first usable string-valued top-level field (passed through `oneLine`)
4. else `‹N fields›` where N = number of top-level keys (or `''` if empty)

The result is truncated to 200 chars (`+ '...'` when cut). The summary string is
duplicated into `event.summary` and (lowercased) `event.searchText`, so capping it
bounds those copies; the detail view still reads the full value from `payload`.

**Failure error fallback.** A tool failure folds onto the displayed `PreToolUse`
row, whose summary was computed before the error existed. In the
`PostToolUseFailure` merge branch of `process-event.ts`, when the Pre row's
summary is weak (`isWeakSummary` — empty, <3 chars, or the `‹N fields›`
placeholder), the row summary is overwritten with the error
(`getEventSummary`'s `PostToolUseFailure` path is already error-first),
truncated to 200 chars. This is general to all tools, but only fills a summary
that carried no real information.

The existing `PostToolUseFailure` summary path
(`p.error || getToolSummary(...)`) already surfaces the schema-mismatch error on
the failure row — unchanged.

### 3. Detail view — hybrid

`app/client/src/agents/claude-code/event-detail.tsx`: a new shared component
```tsx
function StructuredOutputDetail({ data, error }: { data: Record<string, any>; error?: string })
```
that renders:
- `summary`, `reasoning`, and `refinedFix` (each, when a string) as their own
  `DetailCode` rows — these are frequently long markdown and read far better
  rendered separately than escaped inside a JSON dump (`DetailCode`
  auto-detects markdown)
- the remaining fields (all keys except those three elevated string fields) as one
  `DetailCode label="Output"` with `JSON.stringify(rest, null, 2)`
- nothing for the `Output` block when there are no remaining keys (partial Pre event)
- `error` (when present) as a `DetailCode label="Error"`

Wired into the `switch (event.toolName)` (PreToolUse/PostToolUse branch). Because
a failed StructuredOutput is shown as the merged `PreToolUse` row, the full data
and the error are read from the paired Post event (with the Pre `tool_input` as a
fallback), and an object-valued error is stringified:
```tsx
case 'StructuredOutput': {
  const soPost = pairedEvent?.payload
  const soData = { ...ti, ...soPost?.tool_input }
  const soError = soPost?.error ?? payload.error
  return <StructuredOutputDetail data={soData} error={soError} />
}
```

### 4. Failure detail

In the existing `if (event.hookName === 'PostToolUseFailure')` block, when
`event.toolName === 'StructuredOutput'`, render `<StructuredOutputDetail data={failTi} />`
(the attempted output) above the existing `Error` `DetailCode`. Other tools keep
the current generic failure rendering.

### 5. Tests

`app/client/src/agents/claude-code/process-event.test.ts` (and/or a helpers test):
- a `PreToolUse` / `PostToolUse` event with `tool_name: 'StructuredOutput'`
  enriches to `iconId === 'ToolStructuredOutput'`.
- summary derivation: `{ summary: 'x', ... }` → `x`; `{ topRisks: 'r', findings: [...] }`
  (no summary) → `r` (first string field); `{ findings: [...] }` (no string scalars)
  → `‹1 fields›`-style fallback.

## Files Touched

- `app/client/src/lib/event-icon-registry.ts`
- `app/client/src/agents/claude-code/process-event.ts`
- `app/client/src/agents/claude-code/helpers.ts`
- `app/client/src/agents/claude-code/event-detail.tsx`
- `app/client/src/agents/claude-code/process-event.test.ts` (+ helpers test if present)

## Testing / Verification

- `just check` (tests + formatting) passes.
- Manual: load a session containing StructuredOutput events (e.g. a workflow run)
  in the dashboard and confirm icon, row summary, detail hybrid, and the
  failure-with-error rendering.
