import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Badge } from '@/components/ui/misc'
import { useSettings } from '@/settings/SettingsProvider'
import { describeRecurrence } from '@/lib/recurrence'
import { relativeDay } from '@/lib/dates'
import { formatMinutes } from '@/lib/utils'
import { parseQuickEntry } from './parse'
import { useTaskActions } from './actions'
import { getStore } from '@/lib/db'
import { useInvalidate } from '@/lib/db/hooks'
import { toast } from '@/components/ui/toast'
import { linkTo } from '@/lib/links'
import { TaskEditor } from './TaskEditor'
import type { Task } from '@/lib/db/types'

type Kind = 'task' | 'note' | 'idea'

/**
 * Quick capture from anywhere. Tasks are parsed locally ("Study OS for 90
 * minutes tomorrow at 6 PM") and the parsed values are shown before saving.
 */
export function QuickAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tz, today, settings } = useSettings()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Kind>('task')
  const [saving, setSaving] = useState(false)
  const [details, setDetails] = useState<Partial<Task> | null>(null)
  const actions = useTaskActions()
  const invalidate = useInvalidate()
  const navigate = useNavigate()

  // Reset after closing, so text typed right as the dialog opens is never wiped.
  useEffect(() => {
    if (!open) {
      setText('')
      setKind('task')
    }
  }, [open])

  const parsed = useMemo(() => (text.trim() && kind === 'task' ? parseQuickEntry(text, tz) : null), [text, tz, kind])

  const values = (): Partial<Task> | null =>
    parsed
      ? {
          title: parsed.title,
          due_date: parsed.due_date,
          scheduled_at: parsed.scheduled_at,
          estimated_minutes: parsed.estimated_minutes,
          priority: parsed.priority,
          tags: parsed.tags,
          recurrence: parsed.recurrence,
          start_date: parsed.recurrence ? parsed.due_date ?? today : null,
          reminder_offsets: parsed.scheduled_at ? settings.notifications.task_default_offsets ?? [] : [],
        }
      : null

  const save = async () => {
    if (!text.trim()) return
    setSaving(true)
    try {
      if (kind === 'task') {
        const v = values()
        if (v) await actions.create(v)
      } else {
        const note = await getStore().insert('notes', { kind, title: text.trim().slice(0, 300), content: text.trim().length > 300 ? text.trim() : '', status: 'inbox' })
        invalidate('notes')
        toast.success(kind === 'idea' ? 'Idea captured' : 'Note captured', { label: 'Open', onClick: () => navigate(linkTo.note(note.id)) })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Quick add"
        description="Try “Study OS for 90 minutes tomorrow at 6 PM #fat”."
        footer={
          <>
            {kind === 'task' && (
              <Button
                variant="ghost"
                disabled={!parsed}
                onClick={() => {
                  setDetails(values())
                  onClose()
                }}
              >
                More details
              </Button>
            )}
            <Button onClick={save} loading={saving} disabled={!text.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex gap-2">
            <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-28">
              <option value="task">Task</option>
              <option value="note">Note</option>
              <option value="idea">Idea</option>
            </Select>
            <Input data-autofocus aria-label="What do you want to add?" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'task' ? 'Add a task…' : 'Write it down…'} />
          </div>
          {parsed && (
            <div className="rounded-lg bg-surface-2 p-3 text-sm" aria-live="polite">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Will be saved as
              </p>
              <p className="font-medium">{parsed.title}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>{parsed.due_date ? relativeDay(parsed.due_date, today) : 'No date'}</Badge>
                {parsed.time && <Badge>at {parsed.time}</Badge>}
                {parsed.estimated_minutes && <Badge>{formatMinutes(parsed.estimated_minutes)}</Badge>}
                {parsed.priority !== 'normal' && <Badge>{parsed.priority} priority</Badge>}
                {parsed.recurrence && <Badge>{describeRecurrence(parsed.recurrence)}</Badge>}
                {parsed.tags.map((t) => (
                  <Badge key={t}>#{t}</Badge>
                ))}
              </div>
            </div>
          )}
          <button type="submit" hidden />
        </form>
      </Dialog>
      <TaskEditor open={!!details} onClose={() => setDetails(null)} initial={details ?? undefined} />
    </>
  )
}
