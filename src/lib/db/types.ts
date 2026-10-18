// Row types mirror supabase/migrations. Keep the two in sync.

export type ID = string
/** ISO calendar date, YYYY-MM-DD, in the user's time zone. */
export type DateKey = string
/** ISO instant, e.g. 2026-10-12T09:30:00.000Z */
export type Instant = string

export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']

/** Weekday numbers follow JavaScript: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  /** Every N days/weeks/months/years. */
  interval: number
  /** For weekly rules: which weekdays. Empty or missing means the start date's weekday. */
  byWeekday?: Weekday[]
  /** For monthly rules: day of month (1-31). Missing means the start date's day. */
  byMonthDay?: number
  /** Last date (inclusive) an occurrence may fall on. */
  until?: DateKey | null
  /** Stop after this many occurrences. */
  count?: number | null
}

export interface BaseRow {
  id: ID
  user_id: ID
  created_at: Instant
  updated_at: Instant
}

export interface UserSettings {
  user_id: ID
  display_name: string
  timezone: string
  date_format: string
  time_format: 'HH:mm' | 'h:mm a'
  week_start: Weekday
  theme: 'light' | 'dark' | 'system'
  default_task_minutes: number
  day_start_hour: number
  day_end_hour: number
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  notifications: NotificationPrefs
  dashboard: DashboardPrefs
  onboarded_at: Instant | null
  /** Secret part of the calendar feed URL (needs the calendar_links migration). */
  calendar_feed_token?: string | null
  /** Other calendars shown read-only in the app (needs the calendar_links migration). */
  calendar_links?: CalendarLinkSetting[]
  /** Accent colour id from src/lib/accents.ts (needs the accent migration). */
  accent?: string
  created_at: Instant
  updated_at: Instant
}

export interface CalendarLinkSetting {
  id: string
  name: string
  url: string
  color: string
  enabled: boolean
}

export interface NotificationPrefs {
  in_app?: boolean
  browser?: boolean
  push?: boolean
  task_default_offsets?: number[]
  event_default_offsets?: number[]
  habit_reminders?: boolean
}

export interface DashboardPrefs {
  hidden?: string[]
  order?: string[]
  /** Menu items hidden in Settings → Menu (e.g. '/fitness'). */
  menu_hidden?: string[]
}

export interface Category extends BaseRow {
  name: string
  color: string
  sort_order: number
}

export interface Tag extends BaseRow {
  name: string
  color: string
}

export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned'
export type ProgressMode = 'tasks' | 'milestones' | 'metric' | 'manual'

export interface Goal extends BaseRow {
  title: string
  description: string
  status: GoalStatus
  priority: Priority
  target_date: DateKey | null
  progress_mode: ProgressMode
  metric_unit: string | null
  metric_start: number | null
  metric_target: number | null
  manual_progress: number | null
  color: string
  notes: string
  completed_at: Instant | null
  archived_at: Instant | null
}

export interface GoalProgress extends BaseRow {
  goal_id: ID
  value: number
  note: string
  recorded_at: Instant
}

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled'

export interface Project extends BaseRow {
  goal_id: ID | null
  name: string
  description: string
  status: ProjectStatus
  priority: Priority
  start_date: DateKey | null
  target_date: DateKey | null
  color: string
  notes: string
  completed_at: Instant | null
  archived_at: Instant | null
}

export interface Milestone extends BaseRow {
  project_id: ID | null
  goal_id: ID | null
  title: string
  description: string
  due_date: DateKey | null
  depends_on: ID[]
  sort_order: number
  completed_at: Instant | null
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface TaskLink {
  id: string
  label: string
  url: string
}

export interface Task extends BaseRow {
  parent_id: ID | null
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  start_date: DateKey | null
  due_date: DateKey | null
  deadline: Instant | null
  scheduled_at: Instant | null
  estimated_minutes: number | null
  actual_minutes: number | null
  category_id: ID | null
  project_id: ID | null
  goal_id: ID | null
  milestone_id: ID | null
  tags: string[]
  checklist: ChecklistItem[]
  links: TaskLink[]
  notes: string
  recurrence: Recurrence | null
  reminder_offsets: number[]
  sort_order: number
  completed_at: Instant | null
  archived_at: Instant | null
}

export interface TaskOccurrence extends BaseRow {
  task_id: ID
  occurrence_date: DateKey
  status: 'done' | 'skipped' | 'rescheduled'
  rescheduled_to: DateKey | null
  scheduled_at: Instant | null
  actual_minutes: number | null
  completed_at: Instant | null
}

export type TaskHistoryAction =
  | 'created'
  | 'updated'
  | 'completed'
  | 'reopened'
  | 'archived'
  | 'restored'
  | 'rescheduled'
  | 'occurrence_completed'
  | 'occurrence_skipped'
  | 'occurrence_reopened'

export interface TaskHistory extends BaseRow {
  task_id: ID
  action: TaskHistoryAction
  changes: Record<string, unknown>
}

export interface CalendarEvent extends BaseRow {
  title: string
  description: string
  all_day: boolean
  start_at: Instant
  end_at: Instant
  timezone: string
  location: string
  meeting_url: string
  notes: string
  category_id: ID | null
  color: string | null
  project_id: ID | null
  goal_id: ID | null
  tags: string[]
  recurrence: Recurrence | null
  reminder_offsets: number[]
  archived_at: Instant | null
}

export interface EventOverride {
  title?: string
  description?: string
  start_at?: Instant
  end_at?: Instant
  all_day?: boolean
  location?: string
  meeting_url?: string
  notes?: string
  color?: string | null
}

export interface EventException extends BaseRow {
  event_id: ID
  /** The original start instant of the occurrence being changed. */
  occurrence_start: Instant
  cancelled: boolean
  override: EventOverride
}

export interface TimeBlock extends BaseRow {
  title: string
  start_at: Instant
  end_at: Instant
  task_id: ID | null
  task_occurrence_date: DateKey | null
  category_id: ID | null
  color: string | null
  notes: string
  status: 'planned' | 'done' | 'missed' | 'skipped'
  actual_minutes: number | null
  recurrence: Recurrence | null
}

export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'days'; days: Weekday[] }
  | { type: 'weekly'; timesPerWeek: number }
  | { type: 'interval'; everyDays: number }

export interface Habit extends BaseRow {
  name: string
  description: string
  color: string
  icon: string
  kind: 'check' | 'numeric'
  schedule: HabitSchedule
  target_value: number | null
  unit: string
  start_date: DateKey
  reminder_time: string | null
  show_on_dashboard: boolean
  show_in_planner: boolean
  goal_id: ID | null
  sort_order: number
  archived_at: Instant | null
}

export interface HabitCheckin extends BaseRow {
  habit_id: ID
  date: DateKey
  value: number
  note: string
  source: 'manual' | 'task' | 'study' | 'workout'
}

export interface Subject extends BaseRow {
  name: string
  kind: 'subject' | 'course' | 'book' | 'skill'
  color: string
  description: string
  weekly_target_minutes: number | null
  goal_id: ID | null
  project_id: ID | null
  archived_at: Instant | null
  /** Exam or finish-by date for the study pace (needs the subject_target_date migration). */
  target_date?: DateKey | null
}

export interface StudyTopic extends BaseRow {
  subject_id: ID
  title: string
  status: 'not_started' | 'in_progress' | 'done' | 'revise'
  sort_order: number
}

export interface StudySession extends BaseRow {
  subject_id: ID | null
  topic_id: ID | null
  task_id: ID | null
  event_id: ID | null
  goal_id: ID | null
  project_id: ID | null
  mode: 'timer' | 'pomodoro' | 'manual'
  started_at: Instant
  ended_at: Instant | null
  planned_minutes: number | null
  actual_minutes: number | null
  paused_seconds: number
  pomodoros: number
  notes: string
}

export type ExerciseMetric = 'weight_reps' | 'reps' | 'duration' | 'distance' | 'distance_duration'

export interface Exercise extends BaseRow {
  name: string
  category: 'strength' | 'cardio' | 'mobility' | 'sport' | 'other'
  metric_type: ExerciseMetric
  muscle_group: string
  notes: string
  archived_at: Instant | null
}

export interface WorkoutTemplateItem {
  exercise_id: ID
  sets: number
  reps?: number | null
  weight?: number | null
  distance_km?: number | null
  duration_seconds?: number | null
}

export interface WorkoutTemplate extends BaseRow {
  name: string
  notes: string
  items: WorkoutTemplateItem[]
}

export interface Workout extends BaseRow {
  title: string
  started_at: Instant
  ended_at: Instant | null
  duration_minutes: number | null
  template_id: ID | null
  habit_id: ID | null
  goal_id: ID | null
  event_id: ID | null
  task_id: ID | null
  notes: string
}

export interface WorkoutSet extends BaseRow {
  workout_id: ID
  exercise_id: ID
  set_index: number
  reps: number | null
  weight: number | null
  distance_km: number | null
  duration_seconds: number | null
  notes: string
}

export interface BodyMetric extends BaseRow {
  date: DateKey
  weight_kg: number | null
  body_fat_pct: number | null
  measurements: Record<string, number>
  notes: string
}

export type NoteKind = 'note' | 'idea' | 'link' | 'task' | 'event' | 'reminder' | 'other'

export interface Note extends BaseRow {
  kind: NoteKind
  title: string
  content: string
  url: string
  tags: string[]
  status: 'inbox' | 'processed' | 'archived'
  pinned: boolean
  project_id: ID | null
  goal_id: ID | null
  converted_type: 'task' | 'event' | 'reminder' | null
  converted_id: ID | null
}

export type ReminderSource = 'task' | 'event' | 'habit' | 'time_block' | 'custom'

export interface Reminder extends BaseRow {
  source_type: ReminderSource
  source_id: ID | null
  occurrence_key: string
  title: string
  body: string
  url: string
  remind_at: Instant
  offset_minutes: number
  recurrence: Recurrence | null
  status: 'scheduled' | 'fired' | 'dismissed' | 'snoozed' | 'cancelled'
  snoozed_until: Instant | null
  fired_at: Instant | null
  push_sent_at: Instant | null
  dedupe_key: string
}

export interface NotificationLog extends BaseRow {
  reminder_id: ID | null
  channel: 'in_app' | 'browser' | 'push'
  title: string
  body: string
  url: string
  status: 'delivered' | 'failed' | 'suppressed'
  detail: string
}

export interface PushSubscriptionRow extends BaseRow {
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string
}

/** Every table the app reads or writes, mapped to its row type. */
export interface Tables {
  user_settings: UserSettings
  categories: Category
  tags: Tag
  goals: Goal
  goal_progress: GoalProgress
  projects: Project
  milestones: Milestone
  tasks: Task
  task_occurrences: TaskOccurrence
  task_history: TaskHistory
  events: CalendarEvent
  event_exceptions: EventException
  time_blocks: TimeBlock
  habits: Habit
  habit_checkins: HabitCheckin
  subjects: Subject
  study_topics: StudyTopic
  study_sessions: StudySession
  exercises: Exercise
  workout_templates: WorkoutTemplate
  workouts: Workout
  workout_sets: WorkoutSet
  body_metrics: BodyMetric
  notes: Note
  reminders: Reminder
  notification_log: NotificationLog
  push_subscriptions: PushSubscriptionRow
}

export type TableName = keyof Tables
export type Row<T extends TableName> = Tables[T]

export const TABLES: TableName[] = [
  'user_settings',
  'categories',
  'tags',
  'goals',
  'goal_progress',
  'projects',
  'milestones',
  'tasks',
  'task_occurrences',
  'task_history',
  'events',
  'event_exceptions',
  'time_blocks',
  'habits',
  'habit_checkins',
  'subjects',
  'study_topics',
  'study_sessions',
  'exercises',
  'workout_templates',
  'workouts',
  'workout_sets',
  'body_metrics',
  'notes',
  'reminders',
  'notification_log',
  'push_subscriptions',
]

/** Primary key column per table (user_settings is keyed by user). */
export function primaryKey(table: TableName): 'id' | 'user_id' {
  return table === 'user_settings' ? 'user_id' : 'id'
}
