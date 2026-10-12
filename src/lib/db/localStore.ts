import { openDB, type IDBPDatabase } from 'idb'
import { applyQuery, matchesFilter, StoreError, type DataStore, type Filter, type Insert, type ListQuery, type Patch } from './store'
import { primaryKey, TABLES, type Row, type TableName } from './types'
import { uid } from '../utils'

const DB_NAME = 'life-planner-local'
const DB_VERSION = 1

/** Column defaults applied on insert so local rows match the SQL schema shape. */
const DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  user_settings: {
    display_name: '',
    timezone: 'UTC',
    date_format: 'dd MMM yyyy',
    time_format: 'HH:mm',
    week_start: 1,
    theme: 'system',
    default_task_minutes: 30,
    day_start_hour: 7,
    day_end_hour: 22,
    quiet_hours_start: null,
    quiet_hours_end: null,
    notifications: {},
    dashboard: {},
    onboarded_at: null,
  },
  categories: { color: '#64748b', sort_order: 0 },
  tags: { color: '#64748b' },
  goals: {
    description: '',
    status: 'active',
    priority: 'normal',
    target_date: null,
    progress_mode: 'tasks',
    metric_unit: null,
    metric_start: null,
    metric_target: null,
    manual_progress: null,
    color: '#0f766e',
    notes: '',
    completed_at: null,
    archived_at: null,
  },
  goal_progress: { note: '' },
  projects: {
    goal_id: null,
    description: '',
    status: 'active',
    priority: 'normal',
    start_date: null,
    target_date: null,
    color: '#2563eb',
    notes: '',
    completed_at: null,
    archived_at: null,
  },
  milestones: { project_id: null, goal_id: null, description: '', due_date: null, depends_on: [], sort_order: 0, completed_at: null },
  tasks: {
    parent_id: null,
    description: '',
    status: 'todo',
    priority: 'normal',
    start_date: null,
    due_date: null,
    deadline: null,
    scheduled_at: null,
    estimated_minutes: null,
    actual_minutes: null,
    category_id: null,
    project_id: null,
    goal_id: null,
    milestone_id: null,
    tags: [],
    checklist: [],
    links: [],
    notes: '',
    recurrence: null,
    reminder_offsets: [],
    sort_order: 0,
    completed_at: null,
    archived_at: null,
  },
  task_occurrences: { status: 'done', rescheduled_to: null, scheduled_at: null, actual_minutes: null, completed_at: null },
  task_history: { changes: {} },
  events: {
    description: '',
    all_day: false,
    timezone: 'UTC',
    location: '',
    meeting_url: '',
    notes: '',
    category_id: null,
    color: null,
    project_id: null,
    goal_id: null,
    tags: [],
    recurrence: null,
    reminder_offsets: [],
    archived_at: null,
  },
  event_exceptions: { cancelled: false, override: {} },
  time_blocks: {
    task_id: null,
    task_occurrence_date: null,
    category_id: null,
    color: null,
    notes: '',
    status: 'planned',
    actual_minutes: null,
    recurrence: null,
  },
  habits: {
    description: '',
    color: '#0f766e',
    icon: 'check',
    kind: 'check',
    schedule: { type: 'daily' },
    target_value: null,
    unit: '',
    reminder_time: null,
    show_on_dashboard: true,
    show_in_planner: false,
    goal_id: null,
    sort_order: 0,
    archived_at: null,
  },
  habit_checkins: { value: 1, note: '', source: 'manual' },
  subjects: { kind: 'subject', color: '#7c3aed', description: '', weekly_target_minutes: null, goal_id: null, project_id: null, archived_at: null },
  study_topics: { status: 'not_started', sort_order: 0 },
  study_sessions: {
    subject_id: null,
    topic_id: null,
    task_id: null,
    event_id: null,
    goal_id: null,
    project_id: null,
    mode: 'timer',
    ended_at: null,
    planned_minutes: null,
    actual_minutes: null,
    paused_seconds: 0,
    pomodoros: 0,
    notes: '',
  },
  exercises: { category: 'strength', metric_type: 'weight_reps', muscle_group: '', notes: '', archived_at: null },
  workout_templates: { notes: '', items: [] },
  workouts: {
    ended_at: null,
    duration_minutes: null,
    template_id: null,
    habit_id: null,
    goal_id: null,
    event_id: null,
    task_id: null,
    notes: '',
  },
  workout_sets: { set_index: 0, reps: null, weight: null, distance_km: null, duration_seconds: null, notes: '' },
  body_metrics: { weight_kg: null, body_fat_pct: null, measurements: {}, notes: '' },
  notes: {
    kind: 'note',
    title: '',
    content: '',
    url: '',
    tags: [],
    status: 'inbox',
    pinned: false,
    project_id: null,
    goal_id: null,
    converted_type: null,
    converted_id: null,
  },
  reminders: {
    source_id: null,
    occurrence_key: '',
    body: '',
    url: '/',
    offset_minutes: 0,
    recurrence: null,
    status: 'scheduled',
    snoozed_until: null,
    fired_at: null,
    push_sent_at: null,
  },
  notification_log: { reminder_id: null, title: '', body: '', url: '/', status: 'delivered', detail: '' },
  push_subscriptions: { user_agent: '' },
}

/** Unique constraints the SQL schema enforces, mirrored so local mode behaves the same. */
const UNIQUE: Partial<Record<TableName, string[][]>> = {
  categories: [['name']],
  tags: [['name']],
  task_occurrences: [['task_id', 'occurrence_date']],
  event_exceptions: [['event_id', 'occurrence_start']],
  habit_checkins: [['habit_id', 'date']],
  exercises: [['name']],
  body_metrics: [['date']],
  reminders: [['dedupe_key']],
  push_subscriptions: [['endpoint']],
}

/** ON DELETE CASCADE / SET NULL relationships, mirrored for local mode. */
const RELATIONS: { child: TableName; field: string; parent: TableName; onDelete: 'cascade' | 'set null' }[] = [
  { child: 'goal_progress', field: 'goal_id', parent: 'goals', onDelete: 'cascade' },
  { child: 'projects', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'milestones', field: 'project_id', parent: 'projects', onDelete: 'cascade' },
  { child: 'milestones', field: 'goal_id', parent: 'goals', onDelete: 'cascade' },
  { child: 'tasks', field: 'parent_id', parent: 'tasks', onDelete: 'cascade' },
  { child: 'tasks', field: 'category_id', parent: 'categories', onDelete: 'set null' },
  { child: 'tasks', field: 'project_id', parent: 'projects', onDelete: 'set null' },
  { child: 'tasks', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'tasks', field: 'milestone_id', parent: 'milestones', onDelete: 'set null' },
  { child: 'task_occurrences', field: 'task_id', parent: 'tasks', onDelete: 'cascade' },
  { child: 'task_history', field: 'task_id', parent: 'tasks', onDelete: 'cascade' },
  { child: 'events', field: 'category_id', parent: 'categories', onDelete: 'set null' },
  { child: 'events', field: 'project_id', parent: 'projects', onDelete: 'set null' },
  { child: 'events', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'event_exceptions', field: 'event_id', parent: 'events', onDelete: 'cascade' },
  { child: 'time_blocks', field: 'task_id', parent: 'tasks', onDelete: 'set null' },
  { child: 'time_blocks', field: 'category_id', parent: 'categories', onDelete: 'set null' },
  { child: 'habits', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'habit_checkins', field: 'habit_id', parent: 'habits', onDelete: 'cascade' },
  { child: 'subjects', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'subjects', field: 'project_id', parent: 'projects', onDelete: 'set null' },
  { child: 'study_topics', field: 'subject_id', parent: 'subjects', onDelete: 'cascade' },
  { child: 'study_sessions', field: 'subject_id', parent: 'subjects', onDelete: 'set null' },
  { child: 'study_sessions', field: 'topic_id', parent: 'study_topics', onDelete: 'set null' },
  { child: 'study_sessions', field: 'task_id', parent: 'tasks', onDelete: 'set null' },
  { child: 'study_sessions', field: 'event_id', parent: 'events', onDelete: 'set null' },
  { child: 'study_sessions', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'study_sessions', field: 'project_id', parent: 'projects', onDelete: 'set null' },
  { child: 'workouts', field: 'template_id', parent: 'workout_templates', onDelete: 'set null' },
  { child: 'workouts', field: 'habit_id', parent: 'habits', onDelete: 'set null' },
  { child: 'workouts', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'workouts', field: 'event_id', parent: 'events', onDelete: 'set null' },
  { child: 'workouts', field: 'task_id', parent: 'tasks', onDelete: 'set null' },
  { child: 'workout_sets', field: 'workout_id', parent: 'workouts', onDelete: 'cascade' },
  { child: 'workout_sets', field: 'exercise_id', parent: 'exercises', onDelete: 'cascade' },
  { child: 'notes', field: 'project_id', parent: 'projects', onDelete: 'set null' },
  { child: 'notes', field: 'goal_id', parent: 'goals', onDelete: 'set null' },
  { child: 'notification_log', field: 'reminder_id', parent: 'reminders', onDelete: 'set null' },
]

export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001'

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

/**
 * IndexedDB-backed store used when no Supabase project is configured. Data
 * stays in this browser only. It mirrors the SQL schema's defaults, unique
 * constraints and cascades so the app behaves the same in both modes.
 */
export class LocalStore implements DataStore {
  readonly kind = 'local' as const
  private dbPromise: Promise<IDBPDatabase>

  constructor(
    private userId = LOCAL_USER_ID,
    dbName = DB_NAME,
  ) {
    this.dbPromise = openDB(dbName, DB_VERSION, {
      upgrade(db) {
        for (const t of TABLES) {
          if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: primaryKey(t) })
        }
      },
    })
  }

  private async all<T extends TableName>(table: T): Promise<Row<T>[]> {
    const db = await this.dbPromise
    const rows = (await db.getAll(table)) as Row<T>[]
    return rows.filter((r) => (r as { user_id: string }).user_id === this.userId)
  }

  async list<T extends TableName>(table: T, query?: ListQuery): Promise<Row<T>[]> {
    return applyQuery(await this.all(table), query)
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const db = await this.dbPromise
    const row = (await db.get(table, id)) as Row<T> | undefined
    if (!row || (row as { user_id: string }).user_id !== this.userId) return null
    return row
  }

  private build<T extends TableName>(table: T, values: Insert<T>): Row<T> {
    const now = new Date().toISOString()
    const base: Record<string, unknown> = { ...clone(DEFAULTS[table] ?? {}) }
    const row: Record<string, unknown> = {
      ...base,
      ...clone(values as unknown as Record<string, unknown>),
      user_id: this.userId,
      created_at: now,
      updated_at: now,
    }
    if (table !== 'user_settings' && !row.id) row.id = uid()
    // Drop explicit undefined so defaults survive.
    for (const k of Object.keys(row)) if (row[k] === undefined) row[k] = base[k] ?? null
    return row as unknown as Row<T>
  }

  private async assertUnique<T extends TableName>(table: T, row: Row<T>) {
    const groups = UNIQUE[table]
    if (!groups) return
    const pk = primaryKey(table)
    const rows = await this.all(table)
    for (const cols of groups) {
      const clash = rows.find(
        (r) =>
          (r as unknown as Record<string, unknown>)[pk] !== (row as unknown as Record<string, unknown>)[pk] &&
          cols.every((c) => (r as unknown as Record<string, unknown>)[c] === (row as unknown as Record<string, unknown>)[c]),
      )
      if (clash) throw new StoreError(`A ${table.replace(/_/g, ' ')} entry with the same ${cols.join(' and ')} already exists.`, '23505')
    }
  }

  async insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>> {
    const row = this.build(table, values)
    await this.assertUnique(table, row)
    const db = await this.dbPromise
    await db.put(table, row)
    return clone(row)
  }

  async insertMany<T extends TableName>(table: T, values: Insert<T>[]): Promise<Row<T>[]> {
    const out: Row<T>[] = []
    for (const v of values) out.push(await this.insert(table, v))
    return out
  }

  async update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>> {
    const existing = await this.get(table, id)
    if (!existing) throw new StoreError('That record no longer exists.', 'PGRST116')
    const clean = clone(patch as unknown as Record<string, unknown>)
    for (const k of ['id', 'user_id', 'created_at', 'updated_at']) delete clean[k]
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k]
    const row = { ...existing, ...clean, updated_at: new Date().toISOString() } as Row<T>
    await this.assertUnique(table, row)
    const db = await this.dbPromise
    await db.put(table, row)
    return clone(row)
  }

  async upsert<T extends TableName>(table: T, values: Insert<T>, onConflict: (keyof Row<T> & string)[]): Promise<Row<T>> {
    const rows = await this.all(table)
    const v = values as Record<string, unknown>
    const match = rows.find((r) => onConflict.every((c) => (r as unknown as Record<string, unknown>)[c] === v[c]))
    if (match) {
      const pk = primaryKey(table)
      return this.update(table, (match as unknown as Record<string, unknown>)[pk] as string, values as Patch<T>)
    }
    return this.insert(table, values)
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const existing = await this.get(table, id)
    if (!existing) return
    const db = await this.dbPromise
    await db.delete(table, id)
    await this.cascade(table, id)
  }

  private async cascade(parent: TableName, id: string) {
    for (const rel of RELATIONS.filter((r) => r.parent === parent)) {
      const children = await this.all(rel.child)
      for (const child of children) {
        const c = child as unknown as Record<string, unknown>
        if (c[rel.field] !== id) continue
        if (rel.onDelete === 'cascade') await this.remove(rel.child, c.id as string)
        else await this.update(rel.child, c.id as string, { [rel.field]: null } as never)
      }
    }
  }

  async removeWhere<T extends TableName>(table: T, filters: Filter[]): Promise<void> {
    const rows = await this.all(table)
    const pk = primaryKey(table)
    for (const r of rows) {
      if (filters.every((f) => matchesFilter(r as unknown as Record<string, unknown>, f))) {
        await this.remove(table, (r as unknown as Record<string, unknown>)[pk] as string)
      }
    }
  }

  /** Store rows exactly as given (already owned by this user), replacing any with the same key. */
  async putRaw<T extends TableName>(table: T, rows: Row<T>[]): Promise<void> {
    if (!rows.length) return
    const db = await this.dbPromise
    const tx = db.transaction(table, 'readwrite')
    for (const r of rows) if ((r as { user_id: string }).user_id === this.userId) void tx.store.put(clone(r))
    await tx.done
  }

  /** Delete one row without cascading (the server already applied its own cascades). */
  async deleteRaw<T extends TableName>(table: T, id: string): Promise<void> {
    if (!(await this.get(table, id))) return
    const db = await this.dbPromise
    await db.delete(table, id)
  }

  /** Make this user's copy of a table exactly `rows`. */
  async replaceTable<T extends TableName>(table: T, rows: Row<T>[]): Promise<void> {
    const db = await this.dbPromise
    const pk = primaryKey(table)
    const tx = db.transaction(table, 'readwrite')
    const keep = new Set(rows.map((r) => (r as unknown as Record<string, unknown>)[pk]))
    for (const r of (await tx.store.getAll()) as Record<string, unknown>[]) {
      if (r.user_id === this.userId && !keep.has(r[pk])) void tx.store.delete(r[pk] as string)
    }
    for (const r of rows) if ((r as { user_id: string }).user_id === this.userId) void tx.store.put(clone(r))
    await tx.done
  }

  async clearAll(): Promise<void> {
    const db = await this.dbPromise
    for (const t of TABLES) {
      const rows = await this.all(t)
      const pk = primaryKey(t)
      for (const r of rows) await db.delete(t, (r as unknown as Record<string, unknown>)[pk] as string)
    }
  }

  async deleteAccount(): Promise<void> {
    await this.clearAll()
  }
}
