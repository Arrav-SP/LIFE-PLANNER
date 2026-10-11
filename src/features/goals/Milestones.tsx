import { useState } from 'react'
import { Lock, Plus, Trash2 } from 'lucide-react'
import type { Milestone } from '@/lib/db/types'
import { getStore } from '@/lib/db'
import { useInvalidate } from '@/lib/db/hooks'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select } from '@/components/ui/Field'
import { toast } from '@/components/ui/toast'
import { useSettings } from '@/settings/SettingsProvider'
import { relativeDay } from '@/lib/dates'
import { cn, errorMessage } from '@/lib/utils'
import { blockedMilestones } from './logic'

/** Milestones for one goal or project, with dates and dependencies. */
export function Milestones({ items, owner }: { items: Milestone[]; owner: { goal_id?: string | null; project_id?: string | null } }) {
  const { today } = useSettings()
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [dep, setDep] = useState('')
  const blocked = blockedMilestones(items)
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('milestones')
    }
  }

  const add = () =>
    title.trim() &&
    run(async () => {
      await getStore().insert('milestones', {
        title: title.trim(),
        due_date: due || null,
        depends_on: dep ? [dep] : [],
        goal_id: owner.goal_id ?? null,
        project_id: owner.project_id ?? null,
        sort_order: items.length,
      })
      setTitle('')
      setDue('')
      setDep('')
    })

  return (
    <div>
      {sorted.length > 0 && (
        <ul className="mb-3 flex flex-col">
          {sorted.map((m) => {
            const isBlocked = blocked.has(m.id)
            const late = !m.completed_at && m.due_date && m.due_date < today
            const deps = m.depends_on.map((d) => items.find((x) => x.id === d)?.title).filter(Boolean)
            return (
              <li key={m.id} className="group flex items-start gap-3 rounded-lg px-1 py-2 hover:bg-surface-2">
                <Checkbox
                  round
                  className="mt-0.5"
                  checked={!!m.completed_at}
                  disabled={isBlocked && !m.completed_at}
                  label={`${m.completed_at ? 'Reopen' : 'Complete'} ${m.title}`}
                  onChange={(v) => void run(() => getStore().update('milestones', m.id, { completed_at: v ? new Date().toISOString() : null }))}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', m.completed_at && 'text-muted line-through')}>{m.title}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {m.due_date && <span className={cn(late && 'text-danger')}>{relativeDay(m.due_date, today)}</span>}
                    {deps.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        {isBlocked && <Lock className="h-3 w-3" aria-label="Blocked" />}
                        After {deps.join(', ')}
                      </span>
                    )}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${m.title}`} className="opacity-100 md:opacity-0 md:group-hover:opacity-100" onClick={() => void run(() => getStore().remove('milestones', m.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Input aria-label="New milestone" placeholder="Add a milestone" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-[10rem] flex-1" />
        <Input aria-label="Milestone due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
        {items.length > 0 && (
          <Select aria-label="Depends on" value={dep} onChange={(e) => setDep(e.target.value)} className="w-44">
            <option value="">No dependency</option>
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                After: {m.title}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" variant="secondary" disabled={!title.trim()}>
          <Plus className="h-4 w-4" aria-hidden /> Add
        </Button>
      </form>
    </div>
  )
}
