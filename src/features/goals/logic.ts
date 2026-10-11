import type { DateKey, Goal, GoalProgress, Milestone, Project, Task } from '@/lib/db/types'
import { diffDays } from '@/lib/dates'

export interface Progress {
  /** 0-1 */
  ratio: number
  label: string
}

function countTasks(tasks: Task[]): { done: number; total: number } {
  const relevant = tasks.filter((t) => !t.archived_at && t.status !== 'cancelled' && !t.recurrence)
  return { done: relevant.filter((t) => t.status === 'done').length, total: relevant.length }
}

export function goalTasks(goal: Goal, tasks: Task[], projects: Project[]): Task[] {
  const projIds = new Set(projects.filter((p) => p.goal_id === goal.id).map((p) => p.id))
  return tasks.filter((t) => t.goal_id === goal.id || (t.project_id && projIds.has(t.project_id)))
}

export function goalMilestones(goal: Goal, milestones: Milestone[], projects: Project[]): Milestone[] {
  const projIds = new Set(projects.filter((p) => p.goal_id === goal.id).map((p) => p.id))
  return milestones.filter((m) => m.goal_id === goal.id || (m.project_id && projIds.has(m.project_id)))
}

export function goalProgress(goal: Goal, data: { tasks: Task[]; projects: Project[]; milestones: Milestone[]; progress: GoalProgress[] }): Progress {
  if (goal.status === 'completed') return { ratio: 1, label: 'Completed' }
  switch (goal.progress_mode) {
    case 'manual': {
      const v = Math.max(0, Math.min(100, goal.manual_progress ?? 0))
      return { ratio: v / 100, label: `${Math.round(v)}%` }
    }
    case 'metric': {
      const start = goal.metric_start ?? 0
      const target = goal.metric_target ?? 0
      const entries = data.progress.filter((p) => p.goal_id === goal.id).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      const current = entries.length ? entries[entries.length - 1].value : start
      const span = target - start
      const ratio = span === 0 ? (current === target ? 1 : 0) : (current - start) / span
      return { ratio: clamp(ratio), label: `${fmt(current)} / ${fmt(target)}${goal.metric_unit ? ` ${goal.metric_unit}` : ''}` }
    }
    case 'milestones': {
      const ms = goalMilestones(goal, data.milestones, data.projects)
      const done = ms.filter((m) => m.completed_at).length
      return { ratio: ms.length ? done / ms.length : 0, label: `${done}/${ms.length} milestones` }
    }
    case 'tasks':
    default: {
      const { done, total } = countTasks(goalTasks(goal, data.tasks, data.projects))
      return { ratio: total ? done / total : 0, label: `${done}/${total} tasks` }
    }
  }
}

export function projectProgress(project: Project, tasks: Task[], milestones: Milestone[]): Progress {
  if (project.status === 'completed') return { ratio: 1, label: 'Completed' }
  const t = countTasks(tasks.filter((x) => x.project_id === project.id))
  const ms = milestones.filter((m) => m.project_id === project.id)
  const mDone = ms.filter((m) => m.completed_at).length
  const total = t.total + ms.length
  const done = t.done + mDone
  return { ratio: total ? done / total : 0, label: total ? `${done}/${total} done` : 'No tasks yet' }
}

/** Expected progress if work were spread evenly from creation to the target date. */
export function onTrack(created: string, target: DateKey | null, ratio: number, today: DateKey): 'ahead' | 'on_track' | 'behind' | null {
  if (!target) return null
  const start = created.slice(0, 10)
  const total = diffDays(target, start)
  if (total <= 0) return ratio >= 1 ? 'on_track' : 'behind'
  const elapsed = Math.max(0, Math.min(total, diffDays(today, start)))
  const expected = elapsed / total
  if (ratio >= expected + 0.1) return 'ahead'
  if (ratio + 0.1 < expected) return 'behind'
  return 'on_track'
}

/** Milestones whose dependencies are not all complete. */
export function blockedMilestones(milestones: Milestone[]): Set<string> {
  const byId = new Map(milestones.map((m) => [m.id, m]))
  const out = new Set<string>()
  for (const m of milestones) {
    if (m.completed_at) continue
    if (m.depends_on.some((d) => byId.get(d) && !byId.get(d)!.completed_at)) out.add(m.id)
  }
  return out
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
