// hooks/scripts/lib/migrate-db.mjs
//
// One-shot migration of a legacy SQLite DB into the current dataDir.
//
// Before the #17 fix, the plugin sometimes stored observe.db under the
// version-scoped install dir (~/.claude/plugins/cache/agents-observe/
// agents-observe/<version>/data/data/observe.db). Each plugin upgrade
// changed <version>, orphaning the old DB. This module scans those
// legacy locations and copies the newest DB into the new stable
// dataDir on first server start after upgrade.

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const MIGRATION_MARKER = '.migrated-from.json'

// observe.db plus its SQLite WAL/SHM sidecar files. Empty string = the
// DB file itself.
const DB_SIDECAR_SUFFIXES = ['', '-wal', '-shm']

/**
 * Return absolute paths to candidate legacy observe.db files, sorted by
 * mtime descending (newest first). Empty list if none found.
 *
 * Locations scanned:
 *   - ~/.claude/plugins/cache/<plugin>/<plugin>/<version>/data/data/observe.db
 *     and    .../<version>/data/observe.db
 *     (the #17 case — DB ended up under the version-scoped install dir)
 *   - ~/.claude/plugins/data/<plugin>*\/observe.db
 *     and          .../<plugin>*\/data/observe.db
 *     (Claude plugin data dirs other than the current one — covers users
 *     whose old AGENTS_OBSERVE_DATA_DIR pointed at the plugin data root,
 *     and users who switched between --plugin-dir and marketplace
 *     installs, leaving the DB behind in the sibling dir.)
 *   - ~/.<plugin>/data/observe.db (legacy per-user fallback)
 */
export function scanLegacyDbCandidates(config) {
  const { homeDir, pluginName, databaseFileName, dataDir } = config
  if (!homeDir) return []

  const newDbPath = resolve(dataDir, databaseFileName)
  const candidates = []
  const pushIfDb = (p) => {
    if (p !== newDbPath && existsSync(p)) candidates.push(p)
  }

  // Version-scoped install cache dir (the #17 case).
  const cacheRoot = resolve(homeDir, '.claude/plugins/cache', pluginName, pluginName)
  if (existsSync(cacheRoot)) {
    try {
      for (const version of readdirSync(cacheRoot)) {
        for (const suffix of ['data/data', 'data']) {
          pushIfDb(join(cacheRoot, version, suffix, databaseFileName))
        }
      }
    } catch {
      // unreadable cache dir — nothing to do
    }
  }

  // Sibling plugin data dirs. Claude Code names these as
  // `<plugin>-<marketplace>` (e.g. agents-observe-agents-observe) or
  // `<plugin>-inline` for --plugin-dir installs. After upgrades or env
  // changes a DB can be orphaned in one of them.
  const pluginsDataRoot = resolve(homeDir, '.claude/plugins/data')
  if (existsSync(pluginsDataRoot)) {
    try {
      for (const entry of readdirSync(pluginsDataRoot)) {
        if (entry !== pluginName && !entry.startsWith(`${pluginName}-`)) continue
        const dir = join(pluginsDataRoot, entry)
        // Either layout: DB directly at the root (the "DATA_DIR pointed at
        // plugin data root" case) or under a /data subdir (the normal post-fix
        // layout for a sibling install).
        pushIfDb(join(dir, databaseFileName))
        pushIfDb(join(dir, 'data', databaseFileName))
      }
    } catch {
      // unreadable plugins/data dir — nothing to do
    }
  }

  // Legacy per-user fallback (~/.<plugin>/data/observe.db).
  pushIfDb(resolve(homeDir, `.${pluginName}`, 'data', databaseFileName))

  return candidates
    .map((path) => {
      try {
        return { path, mtime: statSync(path).mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .map((c) => c.path)
}

/**
 * Copy a legacy DB (and its WAL/SHM sidecar files) into the new dataDir.
 * The original is left in place so a downgrade can still see it. Writes
 * a `.migrated-from.json` marker into the new dataDir recording the
 * source — once present, the orchestrator below short-circuits.
 */
export function migrateLegacyDb({ fromDbPath, toDataDir, databaseFileName, log = console }) {
  mkdirSync(toDataDir, { recursive: true })
  const copied = []
  for (const suffix of DB_SIDECAR_SUFFIXES) {
    const src = fromDbPath + suffix
    if (!existsSync(src)) continue
    const dst = resolve(toDataDir, databaseFileName + suffix)
    copyFileSync(src, dst)
    copied.push(dst)
  }
  const marker = resolve(toDataDir, MIGRATION_MARKER)
  writeFileSync(
    marker,
    JSON.stringify({ from: fromDbPath, at: new Date().toISOString(), copied }, null, 2),
  )
  log.warn?.(`Migrated DB from legacy location: ${fromDbPath}`)
  log.warn?.(`  → ${toDataDir}`)
  log.warn?.(`  Original left in place. See ${marker} for details.`)
  return { from: fromDbPath, to: toDataDir, copied, marker }
}

/**
 * Server-startup orchestrator. Returns a result object when a migration
 * ran, or null when skipped. Skip reasons (any one):
 *   - User has set an explicit path env var (usingDefaultDataDir false)
 *   - A DB already exists at the new path
 *   - A migration marker already exists (we've done this before)
 *   - No legacy candidates found
 */
export function maybeMigrateLegacyDb(config, log = console) {
  if (!config.usingDefaultDataDir) return null

  const newDbPath = resolve(config.dataDir, config.databaseFileName)
  if (existsSync(newDbPath)) return null

  const marker = resolve(config.dataDir, MIGRATION_MARKER)
  if (existsSync(marker)) return null

  const candidates = scanLegacyDbCandidates(config)
  if (candidates.length === 0) return null

  const [fromDbPath, ...skipped] = candidates
  if (candidates.length > 1) {
    log.warn?.(`Found ${candidates.length} legacy DB candidates (newest first):`)
    log.warn?.(`  → ${fromDbPath} (migrating this one)`)
    for (const s of skipped) log.warn?.(`    ${s}`)
  }

  return migrateLegacyDb({
    fromDbPath,
    toDataDir: config.dataDir,
    databaseFileName: config.databaseFileName,
    log,
  })
}
