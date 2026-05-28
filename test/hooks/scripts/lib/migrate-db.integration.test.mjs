// test/hooks/scripts/lib/migrate-db.integration.test.mjs
//
// End-to-end migration tests: env vars → getConfig() → initLocalDataDirs()
// → observe the DB at the new dataDir. Covers the resolution path that
// the unit tests in migrate-db.test.mjs and config.test.mjs each cover
// in isolation. Drives a fake HOME under tmpdir so the tests are
// hermetic and never touch the real user environment.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PLUGIN_NAME = 'agents-observe'
const DB_FILE = 'observe.db'

// All env vars we override per-test. Snapshot/restore so the suite
// doesn't leak into other tests.
const envKeys = [
  'HOME',
  'CLAUDE_PLUGIN_DATA',
  'AGENTS_OBSERVE_LOCAL_DATA_ROOT',
  'AGENTS_OBSERVE_LOG_LEVEL',
  'AGENTS_OBSERVE_RUNTIME',
]

let savedEnv
let testHome
let claudePluginData

async function loadConfig() {
  // Dynamic import so the module picks up our env overrides.
  const mod = await import('../../../../hooks/scripts/lib/config.mjs')
  return { getConfig: mod.getConfig, initLocalDataDirs: mod.initLocalDataDirs }
}

function seedDb(path, marker, mtimeSeconds) {
  mkdirSync(join(path, '..'), { recursive: true })
  // Mark contents so we can assert the right DB won by content match.
  writeFileSync(path, marker, 'utf8')
  writeFileSync(`${path}-wal`, `${marker}-wal`, 'utf8')
  writeFileSync(`${path}-shm`, `${marker}-shm`, 'utf8')
  if (mtimeSeconds !== undefined) {
    utimesSync(path, mtimeSeconds, mtimeSeconds)
  }
}

beforeEach(() => {
  savedEnv = {}
  for (const k of envKeys) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }

  testHome = join(
    tmpdir(),
    `migrate-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  mkdirSync(testHome, { recursive: true })
  process.env.HOME = testHome

  // Set CLAUDE_PLUGIN_DATA so we're "running as a Claude plugin" —
  // marketplace-install path, same dir name as a real install.
  claudePluginData = join(testHome, '.claude/plugins/data', `${PLUGIN_NAME}-${PLUGIN_NAME}`)
  mkdirSync(claudePluginData, { recursive: true })
  process.env.CLAUDE_PLUGIN_DATA = claudePluginData

  // Keep noise out of the test output.
  process.env.AGENTS_OBSERVE_LOG_LEVEL = 'error'
  process.env.AGENTS_OBSERVE_RUNTIME = 'local'
})

afterEach(() => {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  rmSync(testHome, { recursive: true, force: true })
})

describe('initLocalDataDirs — end-to-end migration', () => {
  it('migrates from version-scoped install cache (#17, data/data layout)', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    const legacy = join(
      testHome,
      '.claude/plugins/cache',
      PLUGIN_NAME,
      PLUGIN_NAME,
      '0.9.6/data/data',
      DB_FILE,
    )
    seedDb(legacy, 'legacy-cache-data-data')

    const config = getConfig()
    expect(config.usingDefaultDataDir).toBe(true)
    expect(config.dataDir).toBe(join(claudePluginData, 'data'))

    const result = initLocalDataDirs(config)
    expect(result).toMatchObject({ from: legacy, to: config.dataDir })

    const migrated = readFileSync(join(config.dataDir, DB_FILE), 'utf8')
    expect(migrated).toBe('legacy-cache-data-data')
    expect(existsSync(legacy)).toBe(true) // original preserved
    expect(existsSync(join(config.dataDir, '.migrated-from.json'))).toBe(true)
  })

  it('migrates from version-scoped install cache (single data layout)', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    const legacy = join(
      testHome,
      '.claude/plugins/cache',
      PLUGIN_NAME,
      PLUGIN_NAME,
      '0.9.7/data',
      DB_FILE,
    )
    seedDb(legacy, 'legacy-cache-data')

    const config = getConfig()
    const result = initLocalDataDirs(config)
    expect(result.from).toBe(legacy)
    expect(readFileSync(join(config.dataDir, DB_FILE), 'utf8')).toBe('legacy-cache-data')
  })

  it('migrates from plugin-data root (mispointed DATA_DIR in 0.9.8)', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    // The orphan: ~/.claude/plugins/data/agents-observe/observe.db
    // (no /data subdir — exactly the layout on Joe's machine).
    const legacy = join(testHome, '.claude/plugins/data', PLUGIN_NAME, DB_FILE)
    seedDb(legacy, 'legacy-mispointed')

    const config = getConfig()
    const result = initLocalDataDirs(config)
    expect(result.from).toBe(legacy)
    expect(readFileSync(join(config.dataDir, DB_FILE), 'utf8')).toBe('legacy-mispointed')
  })

  it('migrates from sibling plugin-data dir (--plugin-dir leftover)', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    // The orphan: ~/.claude/plugins/data/agents-observe-inline/data/observe.db
    const legacy = join(testHome, '.claude/plugins/data', `${PLUGIN_NAME}-inline`, 'data', DB_FILE)
    seedDb(legacy, 'legacy-inline')

    const config = getConfig()
    const result = initLocalDataDirs(config)
    expect(result.from).toBe(legacy)
    expect(readFileSync(join(config.dataDir, DB_FILE), 'utf8')).toBe('legacy-inline')
  })

  it('migrates from legacy ~/.agents-observe fallback dir', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    const legacy = join(testHome, `.${PLUGIN_NAME}/data`, DB_FILE)
    seedDb(legacy, 'legacy-home')

    const config = getConfig()
    const result = initLocalDataDirs(config)
    expect(result.from).toBe(legacy)
    expect(readFileSync(join(config.dataDir, DB_FILE), 'utf8')).toBe('legacy-home')
  })

  it('picks newest by mtime when multiple legacy DBs are present', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    const older = join(
      testHome,
      '.claude/plugins/cache',
      PLUGIN_NAME,
      PLUGIN_NAME,
      '0.9.6/data/data',
      DB_FILE,
    )
    const newer = join(testHome, '.claude/plugins/data', PLUGIN_NAME, DB_FILE)
    seedDb(older, 'older', 1_700_000_000)
    seedDb(newer, 'newer', 1_800_000_000)

    const config = getConfig()
    const result = initLocalDataDirs(config)
    expect(result.from).toBe(newer)
    expect(readFileSync(join(config.dataDir, DB_FILE), 'utf8')).toBe('newer')
  })

  it('does nothing when AGENTS_OBSERVE_LOCAL_DATA_ROOT is set (explicit override)', async () => {
    const explicitRoot = join(testHome, 'explicit-root')
    process.env.AGENTS_OBSERVE_LOCAL_DATA_ROOT = explicitRoot

    const { getConfig, initLocalDataDirs } = await loadConfig()
    const legacy = join(testHome, '.claude/plugins/data', PLUGIN_NAME, DB_FILE)
    seedDb(legacy, 'legacy-mispointed')

    const config = getConfig()
    expect(config.usingDefaultDataDir).toBe(false)
    expect(config.dataDir).toBe(join(explicitRoot, 'data'))

    const result = initLocalDataDirs(config)
    expect(result).toBeNull()
    expect(existsSync(join(config.dataDir, DB_FILE))).toBe(false)
  })

  it('does nothing when a DB already exists at the new dataDir', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    const legacy = join(testHome, '.claude/plugins/data', PLUGIN_NAME, DB_FILE)
    seedDb(legacy, 'legacy-mispointed')

    const config = getConfig()
    mkdirSync(config.dataDir, { recursive: true })
    writeFileSync(join(config.dataDir, DB_FILE), 'pre-existing')

    const result = initLocalDataDirs(config)
    expect(result).toBeNull()
    expect(readFileSync(join(config.dataDir, DB_FILE), 'utf8')).toBe('pre-existing')
  })

  it('is idempotent — second run skips because marker is present', async () => {
    const { getConfig, initLocalDataDirs } = await loadConfig()
    const legacy = join(testHome, '.claude/plugins/data', PLUGIN_NAME, DB_FILE)
    seedDb(legacy, 'legacy-mispointed')

    const config = getConfig()
    const first = initLocalDataDirs(config)
    expect(first).not.toBeNull()

    // Delete the new DB but leave the marker. Migrator should NOT re-run.
    rmSync(join(config.dataDir, DB_FILE))
    const second = initLocalDataDirs(config)
    expect(second).toBeNull()
    expect(existsSync(join(config.dataDir, DB_FILE))).toBe(false)
  })
})
