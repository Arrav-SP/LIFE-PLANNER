import { describe, expect, it } from 'vitest'
import { expandTasks, overdue, viewInstances } from './logic'
import type { Task, TaskOccurrence } from '@/lib/db/types'

const TZ = 'Asia/Kolkata'
let n = 0
function task(p: Partial<Task>): Task {
  n++
  return {
    id: 't' + n, user_id: 'u', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    parent_id: null, title: 'Task ' + n, description: '', status: 'todo', priority: 'normal', start_date: null, due_date: null,
    deadline: null, scheduled_at: null, estimated_minutes: null, actual_minutes: null, category_id: null, project_id: null,
    goal_id: null, milestone_id: null, tags: [], checklist: [], links: [], notes: '', recurrence: null, reminder_offsets: [],
    sort_order: 0, completed_at: null, archived_at: null, ...p,
  }
}
function occ(task_id: string, d: string, p: Partial<TaskOccurrence> = {}): TaskOccurrence {
  return { id: 'o' + d, user_id: 'u', created_at: '', updated_at: '', task_id, occurrence_date: d, status: 'done', rescheduled_to: null, scheduled_at: null, actual_minutes: null, completed_at: '2026-10-12T10:00:00Z', ...p }
}

describe('recurring tasks', () => {
  const daily = task({ title: 'LeetCode', start_date: '2026-10-10', recurrence: { freq: 'daily', interval: 1 } })

  it('creates one instance per day without duplicating', () => {
    const list = expandTasks([daily], [], '2026-10-12', '2026-10-14', TZ)
    expect(list.map((i) => i.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])
    expect(new Set(list.map((i) => i.key)).size).toBe(3)
  })

  it('completing one occurrence leaves the others and the series open', () => {
    const list = expandTasks([daily], [occ(daily.id, '2026-10-13')], '2026-10-12', '2026-10-14', TZ)
    expect(list.map((i) => i.done)).toEqual([false, true, false])
    expect(daily.status).toBe('todo')
  })

  it('moves a rescheduled occurrence to its new date', () => {
    const o = occ(daily.id, '2026-10-12', { status: 'rescheduled', rescheduled_to: '2026-10-20', completed_at: null })
    expect(expandTasks([daily], [o], '2026-10-12', '2026-10-12', TZ)).toHaveLength(0)
    const moved = expandTasks([daily], [o], '2026-10-20', '2026-10-20', TZ)
    expect(moved.map((i) => i.occurrenceDate)).toEqual(['2026-10-20', '2026-10-12'])
  })

  it('surfaces only the latest missed occurrence as overdue', () => {
    const od = overdue([daily], [], '2026-10-15', TZ)
    expect(od).toHaveLength(1)
    expect(od[0].date).toBe('2026-10-14')
    expect(overdue([daily], [occ(daily.id, '2026-10-14')], '2026-10-15', TZ)).toHaveLength(0)
  })
})

describe('views', () => {
  const inbox = task({ title: 'Idea' })
  const today = task({ title: 'Today', due_date: '2026-10-12' })
  const late = task({ title: 'Late', due_date: '2026-10-01' })
  const later = task({ title: 'Later', due_date: '2026-10-20' })
  const done = task({ title: 'Done', due_date: '2026-10-12', status: 'done', completed_at: '2026-10-12T05:00:00Z' })
  const sub = task({ title: 'Sub', parent_id: today.id, due_date: '2026-10-12' })
  const all = [inbox, today, late, later, done, sub]

  it('inbox holds undated, unassigned open tasks', () => {
    expect(viewInstances('inbox', all, [], '2026-10-12', TZ).map((i) => i.task.title)).toEqual(['Idea'])
  })
  it('today includes overdue and today, excludes subtasks', () => {
    expect(viewInstances('today', all, [], '2026-10-12', TZ).map((i) => i.task.title).sort()).toEqual(['Done', 'Late', 'Today'])
  })
  it('upcoming and completed', () => {
    expect(viewInstances('upcoming', all, [], '2026-10-12', TZ).map((i) => i.task.title)).toEqual(['Later'])
    expect(viewInstances('completed', all, [], '2026-10-12', TZ).map((i) => i.task.title)).toEqual(['Done'])
  })
})
