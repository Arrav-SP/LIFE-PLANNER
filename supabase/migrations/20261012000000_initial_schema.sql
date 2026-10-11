-- Life Planner: initial schema
-- Every user-owned table carries user_id, defaults it from the authenticated
-- session, forces it on insert, and is protected by Row Level Security so a
-- user can only ever see and change their own rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Ownership always comes from the session, never from the client payload.
create or replace function public.force_user_id() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  elsif new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  date_format text not null default 'dd MMM yyyy' check (char_length(date_format) <= 32),
  time_format text not null default 'HH:mm' check (time_format in ('HH:mm', 'h:mm a')),
  week_start smallint not null default 1 check (week_start between 0 and 6),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  default_task_minutes integer not null default 30 check (default_task_minutes between 5 and 600),
  day_start_hour smallint not null default 7 check (day_start_hour between 0 and 23),
  day_end_hour smallint not null default 22 check (day_end_hour between 1 and 24),
  quiet_hours_start time,
  quiet_hours_end time,
  notifications jsonb not null default '{}'::jsonb,
  dashboard jsonb not null default '{}'::jsonb,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Organisation: categories, tags, goals, projects, milestones
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'abandoned')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  target_date date,
  progress_mode text not null default 'tasks' check (progress_mode in ('tasks', 'milestones', 'metric', 'manual')),
  metric_unit text,
  metric_start numeric,
  metric_target numeric,
  manual_progress numeric check (manual_progress between 0 and 100),
  color text not null default '#0f766e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  notes text not null default '',
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  value numeric not null,
  note text not null default '',
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  status text not null default 'active' check (status in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  start_date date,
  target_date date,
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  notes text not null default '',
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  due_date date,
  depends_on uuid[] not null default '{}',
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (project_id is not null or goal_id is not null)
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid references public.tasks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  start_date date,
  due_date date,
  deadline timestamptz,
  scheduled_at timestamptz,
  estimated_minutes integer check (estimated_minutes between 1 and 1440),
  actual_minutes integer check (actual_minutes between 0 and 100000),
  category_id uuid references public.categories (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  milestone_id uuid references public.milestones (id) on delete set null,
  tags text[] not null default '{}',
  checklist jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  notes text not null default '',
  recurrence jsonb,
  reminder_offsets integer[] not null default '{}',
  sort_order double precision not null default 0,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date is null or due_date is null or start_date <= due_date)
);

-- One row per touched occurrence of a recurring task. The series row in
-- `tasks` is never marked done when a single occurrence is completed.
create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  occurrence_date date not null,
  status text not null default 'done' check (status in ('done', 'skipped', 'rescheduled')),
  rescheduled_to date,
  scheduled_at timestamptz,
  actual_minutes integer check (actual_minutes between 0 and 100000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, occurrence_date)
);

create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'completed', 'reopened', 'archived', 'restored', 'rescheduled', 'occurrence_completed', 'occurrence_skipped', 'occurrence_reopened')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  all_day boolean not null default false,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'UTC',
  location text not null default '',
  meeting_url text not null default '',
  notes text not null default '',
  category_id uuid references public.categories (id) on delete set null,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  project_id uuid references public.projects (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  tags text[] not null default '{}',
  recurrence jsonb,
  reminder_offsets integer[] not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);

-- Edit-one-occurrence and cancelled occurrences of recurring events.
create table public.event_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  occurrence_start timestamptz not null,
  cancelled boolean not null default false,
  override jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, occurrence_start)
);

create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  start_at timestamptz not null,
  end_at timestamptz not null,
  task_id uuid references public.tasks (id) on delete set null,
  task_occurrence_date date,
  category_id uuid references public.categories (id) on delete set null,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  notes text not null default '',
  status text not null default 'planned' check (status in ('planned', 'done', 'missed', 'skipped')),
  actual_minutes integer check (actual_minutes between 0 and 1440),
  recurrence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

-- ---------------------------------------------------------------------------
-- Habits
-- ---------------------------------------------------------------------------

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  color text not null default '#0f766e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default 'check',
  kind text not null default 'check' check (kind in ('check', 'numeric')),
  schedule jsonb not null default '{"type":"daily"}'::jsonb,
  target_value numeric check (target_value is null or target_value > 0),
  unit text not null default '',
  start_date date not null default current_date,
  reminder_time time,
  show_on_dashboard boolean not null default true,
  show_in_planner boolean not null default false,
  goal_id uuid references public.goals (id) on delete set null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null references public.habits (id) on delete cascade,
  date date not null,
  value numeric not null default 1 check (value >= 0),
  note text not null default '',
  source text not null default 'manual' check (source in ('manual', 'task', 'study', 'workout')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, date)
);

-- ---------------------------------------------------------------------------
-- Study
-- ---------------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'subject' check (kind in ('subject', 'course', 'book', 'skill')),
  color text not null default '#7c3aed' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description text not null default '',
  weekly_target_minutes integer check (weekly_target_minutes between 0 and 10080),
  goal_id uuid references public.goals (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done', 'revise')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  topic_id uuid references public.study_topics (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  mode text not null default 'timer' check (mode in ('timer', 'pomodoro', 'manual')),
  started_at timestamptz not null,
  ended_at timestamptz,
  planned_minutes integer check (planned_minutes between 1 and 1440),
  actual_minutes integer check (actual_minutes between 0 and 1440),
  paused_seconds integer not null default 0 check (paused_seconds >= 0),
  pomodoros integer not null default 0 check (pomodoros >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

-- ---------------------------------------------------------------------------
-- Fitness
-- ---------------------------------------------------------------------------

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null default 'strength' check (category in ('strength', 'cardio', 'mobility', 'sport', 'other')),
  metric_type text not null default 'weight_reps' check (metric_type in ('weight_reps', 'reps', 'duration', 'distance', 'distance_duration')),
  muscle_group text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  notes text not null default '',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_minutes integer check (duration_minutes between 0 and 1440),
  template_id uuid references public.workout_templates (id) on delete set null,
  habit_id uuid references public.habits (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  set_index integer not null default 0,
  reps integer check (reps between 0 and 10000),
  weight numeric check (weight >= 0),
  distance_km numeric check (distance_km >= 0),
  duration_seconds integer check (duration_seconds >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  weight_kg numeric check (weight_kg > 0),
  body_fat_pct numeric check (body_fat_pct between 0 and 100),
  measurements jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ---------------------------------------------------------------------------
-- Notes and quick capture
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'idea', 'link', 'task', 'event', 'reminder', 'other')),
  title text not null default '' check (char_length(title) <= 300),
  content text not null default '',
  url text not null default '',
  tags text[] not null default '{}',
  status text not null default 'inbox' check (status in ('inbox', 'processed', 'archived')),
  pinned boolean not null default false,
  project_id uuid references public.projects (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  converted_type text check (converted_type in ('task', 'event', 'reminder')),
  converted_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reminders and notifications
-- ---------------------------------------------------------------------------

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_type text not null check (source_type in ('task', 'event', 'habit', 'time_block', 'custom')),
  source_id uuid,
  occurrence_key text not null default '',
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '',
  url text not null default '/',
  remind_at timestamptz not null,
  offset_minutes integer not null default 0,
  recurrence jsonb,
  status text not null default 'scheduled' check (status in ('scheduled', 'fired', 'dismissed', 'snoozed', 'cancelled')),
  snoozed_until timestamptz,
  fired_at timestamptz,
  push_sent_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reminder_id uuid references public.reminders (id) on delete set null,
  channel text not null check (channel in ('in_app', 'browser', 'push')),
  title text not null default '',
  body text not null default '',
  url text not null default '/',
  status text not null default 'delivered' check (status in ('delivered', 'failed', 'suppressed')),
  detail text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for the queries the app actually runs
-- ---------------------------------------------------------------------------

create index tasks_user_due_idx on public.tasks (user_id, due_date) where archived_at is null;
create index tasks_user_status_idx on public.tasks (user_id, status, completed_at);
create index tasks_user_scheduled_idx on public.tasks (user_id, scheduled_at) where scheduled_at is not null;
create index tasks_parent_idx on public.tasks (parent_id) where parent_id is not null;
create index tasks_project_idx on public.tasks (project_id) where project_id is not null;
create index tasks_goal_idx on public.tasks (goal_id) where goal_id is not null;
create index task_occurrences_user_date_idx on public.task_occurrences (user_id, occurrence_date);
create index task_history_task_idx on public.task_history (task_id, created_at desc);
create index task_history_user_idx on public.task_history (user_id, created_at desc);
create index events_user_range_idx on public.events (user_id, start_at, end_at);
create index event_exceptions_event_idx on public.event_exceptions (event_id);
create index time_blocks_user_range_idx on public.time_blocks (user_id, start_at);
create index habit_checkins_user_date_idx on public.habit_checkins (user_id, date);
create index habit_checkins_habit_date_idx on public.habit_checkins (habit_id, date);
create index study_sessions_user_started_idx on public.study_sessions (user_id, started_at desc);
create index study_topics_subject_idx on public.study_topics (subject_id, sort_order);
create index workouts_user_started_idx on public.workouts (user_id, started_at desc);
create index workout_sets_workout_idx on public.workout_sets (workout_id, set_index);
create index workout_sets_exercise_idx on public.workout_sets (exercise_id);
create index notes_user_status_idx on public.notes (user_id, status, created_at desc);
create index reminders_due_idx on public.reminders (status, remind_at) where status in ('scheduled', 'snoozed');
create index reminders_source_idx on public.reminders (user_id, source_type, source_id);
create index notification_log_user_idx on public.notification_log (user_id, created_at desc);
create index milestones_project_idx on public.milestones (project_id);
create index milestones_goal_idx on public.milestones (goal_id);
create index goal_progress_goal_idx on public.goal_progress (goal_id, recorded_at);
create index projects_goal_idx on public.projects (goal_id);

-- ---------------------------------------------------------------------------
-- Triggers and Row Level Security for every user-owned table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  owned text[] := array[
    'user_settings', 'categories', 'tags', 'goals', 'goal_progress', 'projects', 'milestones',
    'tasks', 'task_occurrences', 'task_history', 'events', 'event_exceptions', 'time_blocks',
    'habits', 'habit_checkins', 'subjects', 'study_topics', 'study_sessions', 'exercises',
    'workout_templates', 'workouts', 'workout_sets', 'body_metrics', 'notes', 'reminders',
    'notification_log', 'push_subscriptions'
  ];
begin
  foreach t in array owned loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.force_user_id()', t || '_force_user_id', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Linked rows must belong to the same user. RLS hides other users' rows, but a
-- foreign key check would still accept a guessed id, so verify ownership.
create or replace function public.assert_owned(tbl regclass, row_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  if row_id is null then
    return;
  end if;
  execute format('select user_id from %s where id = $1', tbl) into owner using row_id;
  if owner is distinct from auth.uid() then
    raise exception 'linked record not found' using errcode = '23503';
  end if;
end $$;

create or replace function public.check_task_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.tasks', new.parent_id);
  perform public.assert_owned('public.categories', new.category_id);
  perform public.assert_owned('public.projects', new.project_id);
  perform public.assert_owned('public.goals', new.goal_id);
  perform public.assert_owned('public.milestones', new.milestone_id);
  return new;
end $$;
create trigger tasks_check_links before insert or update on public.tasks
  for each row execute function public.check_task_links();

create or replace function public.check_child_of_task() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.tasks', new.task_id);
  return new;
end $$;
create trigger task_occurrences_check_links before insert or update on public.task_occurrences
  for each row execute function public.check_child_of_task();
create trigger task_history_check_links before insert or update on public.task_history
  for each row execute function public.check_child_of_task();
create trigger time_blocks_check_links before insert or update on public.time_blocks
  for each row execute function public.check_child_of_task();

create or replace function public.check_event_exception_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.events', new.event_id);
  return new;
end $$;
create trigger event_exceptions_check_links before insert or update on public.event_exceptions
  for each row execute function public.check_event_exception_links();

create or replace function public.check_habit_checkin_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.habits', new.habit_id);
  return new;
end $$;
create trigger habit_checkins_check_links before insert or update on public.habit_checkins
  for each row execute function public.check_habit_checkin_links();

create or replace function public.check_workout_set_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.workouts', new.workout_id);
  perform public.assert_owned('public.exercises', new.exercise_id);
  return new;
end $$;
create trigger workout_sets_check_links before insert or update on public.workout_sets
  for each row execute function public.check_workout_set_links();

create or replace function public.check_milestone_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.projects', new.project_id);
  perform public.assert_owned('public.goals', new.goal_id);
  return new;
end $$;
create trigger milestones_check_links before insert or update on public.milestones
  for each row execute function public.check_milestone_links();

create or replace function public.check_goal_progress_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.goals', new.goal_id);
  return new;
end $$;
create trigger goal_progress_check_links before insert or update on public.goal_progress
  for each row execute function public.check_goal_progress_links();

create or replace function public.check_study_topic_links() returns trigger
language plpgsql as $$
begin
  perform public.assert_owned('public.subjects', new.subject_id);
  return new;
end $$;
create trigger study_topics_check_links before insert or update on public.study_topics
  for each row execute function public.check_study_topic_links();

-- ---------------------------------------------------------------------------
-- Account deletion: a signed-in user can delete their own account. All of
-- their rows cascade from auth.users. No service-role key is needed.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke all on function public.assert_owned(regclass, uuid) from public, anon;
grant execute on function public.assert_owned(regclass, uuid) to authenticated;
