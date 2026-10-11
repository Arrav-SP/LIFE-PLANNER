import { CalendarClock, Copy, Archive, ArchiveRestore, Trash2, Repeat, Pencil, SkipForward, CalendarPlus, Flag, ListChecks, AlarmClock } from 'lucide-react'
import type { TaskInstance } from './logic'
import { checklistProgress, PRIORITY_COLOR } from './logic'
import { Checkbox } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { ColorDot } from '@/components/ui/misc'
import { useSettings } from '@/settings/SettingsProvider'
import { useLookups } from '@/lib/lookups'
import { formatTime, relativeDay, addDays } from '@/lib/dates'
import { cn, formatMinutes } from '@/lib/utils'
import { useTaskActions } from './actions'

export function TaskItem({
  item,
  onOpen,
  selectable,
  selected,
  onSelect,
  showDate = true,
}: {
  item: TaskInstance
  onOpen: (i: TaskInstance) => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (v: boolean) => void
  showDate?: boolean
}) {
  const { tz, today, settings } = useSettings()
  const { project, category } = useLookups()
  const actions = useTaskActions()
  const t = item.task
  const proj = project(t.project_id)
  const cat = category(t.category_id)
  const cl = checklistProgress(t)
  const overdue = !item.done && item.date !== null && item.date < today
  const archived = !!t.archived_at

  return (
    <li
      className={cn(
        'group flex min-w-0 items-start gap-3 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-line hover:bg-surface',
        selected && 'border-accent/40 bg-accent-soft/40',
      )}
    >
      {selectable ? (
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]" aria-label={`Select ${t.title}`} checked={!!selected} onChange={(e) => onSelect?.(e.target.checked)} />
      ) : (
        <Checkbox round className="mt-0.5" checked={item.done} label={`${item.done ? 'Reopen' : 'Complete'} ${t.title}`} onChange={(v) => void actions.setDone(item, v)} />
      )}
      <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
        <p className={cn('break-words text-[15px] leading-snug', item.done && 'text-muted line-through')}>{t.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {showDate && item.date && (
            <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-danger')}>
              <CalendarClock className="h-3 w-3" aria-hidden />
              {relativeDay(item.date, today)}
            </span>
          )}
          {item.scheduledAt && <span className="tabular">{formatTime(item.scheduledAt, tz, settings.time_format)}</span>}
          {t.estimated_minutes ? <span>{formatMinutes(t.estimated_minutes)}</span> : null}
          {t.recurrence && (
            <span className="inline-flex items-center gap-1">
              <Repeat className="h-3 w-3" aria-label="Repeats" />
            </span>
          )}
          {t.reminder_offsets.length > 0 && <AlarmClock className="h-3 w-3" aria-label="Has reminders" />}
          {cl.total > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3 w-3" aria-hidden />
              {cl.done}/{cl.total}
            </span>
          )}
          {t.priority !== 'normal' && (
            <span className="inline-flex items-center gap-1 capitalize" style={{ color: PRIORITY_COLOR[t.priority] }}>
              <Flag className="h-3 w-3" aria-hidden />
              {t.priority}
            </span>
          )}
          {proj && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <ColorDot color={proj.color} />
              <span className="truncate">{proj.name}</span>
            </span>
          )}
          {cat && (
            <span className="inline-flex items-center gap-1">
              <ColorDot color={cat.color} />
              {cat.name}
            </span>
          )}
          {t.tags.map((tag) => (
            <span key={tag} className="text-accent">
              #{tag}
            </span>
          ))}
        </div>
      </button>
      <div className="opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <Menu
          label={`Actions for ${t.title}`}
          items={[
            { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onOpen(item) },
            { label: 'Do today', icon: <CalendarPlus className="h-4 w-4" />, onSelect: () => void actions.reschedule(item, today), hidden: item.date === today || item.done },
            { label: 'Tomorrow', icon: <CalendarPlus className="h-4 w-4" />, onSelect: () => void actions.reschedule(item, addDays(today, 1)), hidden: item.done },
            { label: 'Postpone a week', icon: <CalendarClock className="h-4 w-4" />, onSelect: () => void actions.postpone(item, 7, today), hidden: item.done },
            { label: 'Skip this time', icon: <SkipForward className="h-4 w-4" />, onSelect: () => void actions.skip(item), hidden: !item.occurrenceDate || item.done },
            { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onSelect: () => void actions.duplicate(t) },
            archived
              ? { label: 'Restore', icon: <ArchiveRestore className="h-4 w-4" />, onSelect: () => void actions.archive(t, false) }
              : { label: 'Archive', icon: <Archive className="h-4 w-4" />, onSelect: () => void actions.archive(t, true) },
            { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void actions.remove(t) },
          ]}
        />
      </div>
    </li>
  )
}
