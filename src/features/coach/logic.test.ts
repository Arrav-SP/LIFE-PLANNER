import { describe, expect, it } from 'vitest'
import type { Goal, StudySession, StudyTopic, Subject, Task } from '@/lib/db/types'
import { expandTasks } from '@/features/tasks/logic'
import { bestFocusWindow, buildInsights, coachSummary, estimateBias, freeToday, hourLabel, studyPicks, studyPlan, suggestionTitle, suggestToday, type TaskSuggestion } from './logic'

const TZ = 'Asia/Kolkata'
const TODAY = '2026-10-12'
const base = { user_id: 'u', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }
let n = 0

function task(p: Partial<Task>): Task {
  n++
  return {
    ...base, id: 't' + n, parent_id: null, title: 'Task ' + n, description: '', status: 'todo', priority: 'normal', start_date: null, due_date: null,
    deadline: null, scheduled_at: null, estimated_minutes: null, actual_minutes: null, category_id: null, project_id: null,
    goal_id: null, milestone_id: null, tags: [], checklist: [], links: [], notes: '', recurrence: null, reminder_offsets: [],
    sort_order: 0, completed_at: null, archived_at: null, ...p,
  }
}
function goal(p: Partial<Goal>): Goal {
  n++
  return {
    ...base, id: 'g' + n, title: 'Goal ' + n, description: '', status: 'active', priority: 'normal', target_date: null, progress_mode: 'manual',
    metric_unit: null, metric_start: null, metric_target: null, manual_progress: null, color: '#0f766e', notes: '', completed_at: null, archived_at: null, ...p,
  }
}
function subject(p: Partial<Subject>): Subject {
  n++
  return { ...base, id: 's' + n, name: 'Subject ' + n, kind: 'subject', color: '#7c3aed', description: '', weekly_target_minutes: null, goal_id: null, project_id: null, archived_at: null, ...p }
}
function topics(subject_id: string, done: number, left: number): StudyTopic[] {
  return Array.from({ length: done + left }, (_, i) => ({ ...base, id: `${subject_id}-tp${i}`, subject_id, title: 'T' + i, status: i < done ? 'done' : 'not_started', sort_order: i }))
}
function session(subject_id: string | null, started_at: string, minutes: number): StudySession {
  n++
  const end = new Date(new Date(started_at).getTime() + minutes * 60000).toISOString()
  return {
    ...base, id: 'ss' + n, subject_id, topic_id: null, task_id: null, event_id: null, goal_id: null, project_id: null, mode: 'timer',
    started_at, ended_at: end, planned_minutes: null, actual_minutes: minutes, paused_seconds: 0, pomodoros: 0, notes: '',
  }
}

const opts = { today: TODAY, tz: TZ, budgetMinutes: 120, defaultMinutes: 30 }
const expand = (ts: Task[]) => expandTasks(ts, [], '2026-07-01', '2026-10-26', TZ)

describe('suggestToday', () => {
  it('ranks overdue and due-today work first and explains why', () => {
    const late = task({ title: 'Late report', due_date: '2026-10-09' })
    const today = task({ title: 'Due today', due_date: TODAY })
    const later = task({ title: 'Next month', due_date: '2026-11-30' })
    const undated = task({ title: 'Someday low', priority: 'low' })
    const { picks } = suggestToday(expand([later, undated, today, late]), [], opts)
    expect(picks.map((p) => suggestionTitle(p))).toEqual(['Late report', 'Due today'])
    expect(picks[0].reasons[0]).toBe('Overdue by 3 days')
    expect(picks[0].mustDo).toBe(true)
  })

  it('fills the free-time budget and leaves the rest as extras', () => {
    const ts = [1, 2, 3].map((d) => task({ title: `Due in ${d}`, due_date: `2026-10-1${2 + d}`, estimated_minutes: 50 }))
    const r = suggestToday(expand(ts), [], opts)
    expect(r.picks).toHaveLength(2)
    expect(r.extra.map((s) => suggestionTitle(s))).toEqual(['Due in 3'])
  })

  it('still picks one task when the top task alone exceeds the budget', () => {
    const big = task({ title: 'Big', due_date: TODAY, estimated_minutes: 300 })
    const r = suggestToday(expand([big]), [], opts)
    expect(r.picks.map((p) => suggestionTitle(p))).toEqual(['Big'])
    expect(r.mustDoMinutes).toBe(300)
  })

  it('boosts tasks that move a goal with a close deadline', () => {
    const g = goal({ title: 'FAT', target_date: '2026-11-12' })
    const linked = task({ title: 'Revise DBMS', goal_id: g.id })
    const plain = task({ title: 'Clean desk' })
    const { picks } = suggestToday(expand([plain, linked]), [g], opts)
    expect(picks.map((p) => suggestionTitle(p))).toEqual(['Revise DBMS'])
    expect(picks[0].reasons).toContain('Moves “FAT” (due in 31 days)')
  })

  it('includes only today’s repeat of a recurring task, not missed ones', () => {
    const daily = task({ title: 'LeetCode', start_date: '2026-10-01', recurrence: { freq: 'daily', interval: 1 } })
    const { picks } = suggestToday(expand([daily]), [], opts)
    expect(picks).toHaveLength(1)
    expect((picks[0] as TaskSuggestion).instance.date).toBe(TODAY)
    expect(picks[0].reasons[0]).toBe('Repeats today')
  })

  it('skips done, future-start and subtasks', () => {
    const done = task({ due_date: TODAY, status: 'done', completed_at: '2026-10-12T05:00:00Z' })
    const future = task({ due_date: TODAY, start_date: '2026-10-20' })
    const parent = task({ due_date: TODAY })
    const child = task({ due_date: TODAY, parent_id: parent.id })
    const { picks } = suggestToday(expand([done, future, child]), [], opts)
    expect(picks).toHaveLength(0)
  })
})

describe('studyPlan', () => {
  it('flags a subject behind pace using minutes per topic from history', () => {
    const g = goal({ title: 'FAT', target_date: '2026-10-21' }) // 10 days including today
    const s = subject({ name: 'DBMS', goal_id: g.id })
    // 4 topics done in 240 minutes → 60 min/topic; 6 left → 360 min over 10 days = 36 min/day needed.
    const ss = [session(s.id, '2026-10-05T10:00:00Z', 120), session(s.id, '2026-10-08T10:00:00Z', 120)]
    const [row] = studyPlan([s], topics(s.id, 4, 6), ss, [g], TODAY, TZ)
    expect(row.daysLeft).toBe(10)
    expect(row.neededPerDay).toBeCloseTo(36)
    expect(row.recentPerDay).toBeCloseTo(240 / 14)
    expect(row.status).toBe('behind')
    expect(row.note).toMatch(/Needs about 35m a day/)
  })

  it('marks subjects on track, done, past deadline or without a deadline', () => {
    const g = goal({ target_date: '2026-10-21' })
    const onTrack = subject({ name: 'OS', goal_id: g.id, weekly_target_minutes: 70 }) // 10 min/day, no topic history
    const finished = subject({ name: 'CN', goal_id: g.id })
    const past = subject({ name: 'Old', goal_id: goal({ target_date: '2026-10-01' }).id })
    const loose = subject({ name: 'Loose' })
    const goals = [g, goal({ id: past.goal_id!, target_date: '2026-10-01' })]
    const ss = [session(onTrack.id, '2026-10-11T10:00:00Z', 150)]
    const rows = studyPlan([onTrack, finished, past, loose], [...topics(finished.id, 3, 0), ...topics(past.id, 1, 2)], ss, goals, TODAY, TZ)
    const by = Object.fromEntries(rows.map((r) => [r.subject.name, r.status]))
    expect(by).toEqual({ OS: 'on_track', CN: 'done', Old: 'overdue', Loose: 'no_deadline' })
    expect(rows[0].subject.name).toBe('Old') // most urgent first
  })

  it('falls back to topics a day when there is no time history', () => {
    const g = goal({ target_date: '2026-10-21' })
    const s = subject({ goal_id: g.id })
    const [row] = studyPlan([s], topics(s.id, 0, 20), [], [g], TODAY, TZ)
    expect(row.status).toBe('unknown')
    expect(row.topicsPerDay).toBe(2)
    expect(row.note).toMatch(/^2 topics a day/)
  })
})

describe('patterns', () => {
  it('finds the two-hour window where most study starts (in local time)', () => {
    // 13:30 UTC = 19:00 IST
    const ss = [0, 1, 2, 3].map((d) => session(null, `2026-10-0${d + 1}T13:30:00Z`, 60)).concat(session(null, '2026-10-06T03:30:00Z', 30))
    expect(bestFocusWindow(ss, TZ)).toEqual({ start: 19, share: 240 / 270 })
    expect(bestFocusWindow(ss.slice(0, 3), TZ)).toBeNull()
    expect(hourLabel(19)).toBe('7pm')
    expect(hourLabel(0)).toBe('12am')
  })

  it('measures how much tasks overrun their estimates', () => {
    const done = (e: number, a: number) => task({ status: 'done', estimated_minutes: e, actual_minutes: a })
    expect(estimateBias([done(30, 45), done(60, 90), done(20, 30), done(10, 10), done(30, 60)])).toBe(1.5)
    expect(estimateBias([done(30, 45)])).toBeNull()
  })

  it('warns when today is overbooked and when deadlines need more time than is free', () => {
    const g = goal({ target_date: '2026-10-21' })
    const s = subject({ name: 'DBMS', goal_id: g.id })
    const plan = studyPlan([s], topics(s.id, 2, 30), [session(s.id, '2026-10-05T10:00:00Z', 240)], [g], TODAY, TZ)
    const suggestions = suggestToday(expand([task({ due_date: TODAY, estimated_minutes: 200 })]), [], opts)
    const ids = buildInsights({
      today: TODAY, tz: TZ, budgetMinutes: 120, suggestions, overdueCount: 0, plan, sessions: [], tasks: [], habits: [], checkins: [],
      goalsBehind: [], weekStudy: [], studyThisWeek: 0, studyLastWeek: 0,
    }).map((i) => i.id)
    expect(ids).toEqual(['overcommitted', `study-${s.id}`, 'study-load'])
  })
})

describe('coachSummary', () => {
  it('produces a paste-ready brief with goals, subjects and tasks', () => {
    const g = goal({ title: 'ML course', target_date: '2026-12-15' })
    const s = subject({ name: 'ML', goal_id: g.id })
    const plan = studyPlan([s], topics(s.id, 1, 9), [], [g], TODAY, TZ)
    const suggestions = suggestToday(expand([task({ title: 'Week 2 quiz', due_date: TODAY })]), [], opts)
    const text = coachSummary({ today: TODAY, budgetMinutes: 300, suggestions, plan, insights: [], goals: [{ title: 'ML course', target: g.target_date, progress: '10%' }], habits: [], studyThisWeek: 0 })
    expect(text).toContain('today is Monday 12 Oct 2026')
    expect(text).toContain('- ML course (target 15 Dec 2026): 10%')
    expect(text).toContain('- ML: 9/10 topics left')
    expect(text).toContain('- Week 2 quiz (no estimate, assumed 30m; Due today)')
  })
})

describe('day plan', () => {
  it('offers the oldest backlog when nothing is due', () => {
    const newer = task({ title: 'Newer idea', created_at: '2026-10-05T00:00:00Z' })
    const older = task({ title: 'Old idea', created_at: '2026-09-01T00:00:00Z' })
    const { picks } = suggestToday(expand([newer, older]), [], opts)
    expect(picks.map(suggestionTitle)).toEqual(['Old idea', 'Newer idea'])
    expect(picks[0].reasons[0]).toMatch(/^In your backlog since 1 Sep/)
  })

  it('keeps the backlog as extras when something is due', () => {
    const due = task({ title: 'Due today', due_date: TODAY })
    const idea = task({ title: 'Someday' })
    const r = suggestToday(expand([idea, due]), [], opts)
    expect(r.picks.map(suggestionTitle)).toEqual(['Due today'])
    expect(r.extra.map(suggestionTitle)).toEqual(['Someday'])
  })

  it('pads task time when tasks usually overrun', () => {
    const { picks } = suggestToday(expand([task({ due_date: TODAY, estimated_minutes: 60 })]), [], { ...opts, minutesFactor: 1.5 })
    expect(picks[0].minutes).toBe(90)
    expect(picks[0].reasons).toContain('Padded: you usually run ~50% over')
  })

  it('suggests the study a subject still needs today, from its exam date, ranked with tasks', () => {
    const os = subject({ name: 'OS', target_date: '2026-10-25' })
    const plan = studyPlan([os], topics(os.id, 2, 6), [session(os.id, '2026-10-05T10:00:00Z', 60), session(os.id, '2026-10-06T10:00:00Z', 60)], [], TODAY, TZ)
    expect(plan[0]).toMatchObject({ deadline: '2026-10-25', goalTitle: 'Exam', status: 'behind' })
    const study = studyPicks(plan, new Map())
    expect(study).toMatchObject([{ kind: 'study', minutes: 25, score: 35, reasons: ['Behind pace'] }])
    expect(studyPicks(plan, new Map([[os.id, 20]]))).toEqual([]) // today's need already met
    const { picks } = suggestToday(expand([task({ title: 'Due Friday', due_date: '2026-10-16' })]), [], { ...opts, study })
    expect(picks.map(suggestionTitle)).toEqual(['Study: OS', 'Due Friday'])
  })

  it('counts free time between events from now to the end of the day', () => {
    const at = (h: string) => new Date(`2026-10-12T${h}:00+05:30`)
    const { minutes } = freeToday([{ key: 'class', start: at('10:00'), end: at('11:00') }], at('07:00'), at('22:00'), at('09:00'))
    expect(minutes).toBe(60 + 11 * 60)
  })
})

describe('estimates', () => {
  it('says when a task time is only the default', () => {
    const { picks } = suggestToday(expand([task({ title: 'Midterm', due_date: TODAY }), task({ title: 'Quiz', due_date: TODAY, estimated_minutes: 90 })]), [], { ...opts, budgetMinutes: 600 })
    expect(picks.map((p) => [suggestionTitle(p), p.minutes, p.kind === 'task' && p.estimated])).toEqual([
      ['Midterm', 30, false],
      ['Quiz', 90, true],
    ])
  })
})
