import { getStore } from './db'
import { TABLES, type TableName } from './db/types'

export const EXPORT_VERSION = 1

export interface ExportFile {
  app: 'life-planner'
  version: number
  exported_at: string
  tables: Partial<Record<TableName, Record<string, unknown>[]>>
}

export async function exportAll(): Promise<ExportFile> {
  const store = getStore()
  const tables: ExportFile['tables'] = {}
  for (const t of TABLES) tables[t] = (await store.list(t)) as unknown as Record<string, unknown>[]
  return { app: 'life-planner', version: EXPORT_VERSION, exported_at: new Date().toISOString(), tables }
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== 'user_id')
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Parents before children so self-references (subtasks) insert cleanly. */
function orderTasks(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const placed = new Set<unknown>()
  let pending = rows
  while (pending.length) {
    const next = pending.filter((r) => !r.parent_id || placed.has(r.parent_id) || !rows.some((x) => x.id === r.parent_id))
    if (!next.length) {
      out.push(...pending.map((r) => ({ ...r, parent_id: null })))
      break
    }
    for (const r of next) placed.add(r.id)
    out.push(...next)
    pending = pending.filter((r) => !next.includes(r))
  }
  return out
}

/**
 * Import an export file into the current account. Rows keep their ids, so
 * importing the same file twice skips rows that already exist.
 */
export async function importAll(file: unknown, onProgress?: (msg: string) => void): Promise<{ inserted: number; skipped: number }> {
  const f = file as ExportFile
  if (!f || f.app !== 'life-planner' || typeof f.tables !== 'object') throw new Error('This is not a Life Planner export file.')
  const store = getStore()
  let inserted = 0
  let skipped = 0
  for (const t of TABLES) {
    let rows = (f.tables[t] ?? []).map((r) => {
      const { user_id: _u, created_at: _c, updated_at: _up, ...rest } = r
      void _u
      void _c
      void _up
      return rest
    })
    if (!rows.length) continue
    onProgress?.(`Importing ${t.replace(/_/g, ' ')}…`)
    if (t === 'user_settings') {
      const { user_id: _x, ...s } = rows[0] as Record<string, unknown>
      void _x
      const me = (await store.list('user_settings'))[0]
      if (me) await store.update('user_settings', me.user_id, s as never)
      continue
    }
    if (t === 'tasks') rows = orderTasks(rows)
    const existing = new Set((await store.list(t)).map((r) => (r as unknown as { id: string }).id))
    for (const r of rows) {
      if (existing.has(r.id as string)) {
        skipped++
        continue
      }
      try {
        await store.insert(t, r as never)
        inserted++
      } catch {
        skipped++
      }
    }
  }
  return { inserted, skipped }
}
