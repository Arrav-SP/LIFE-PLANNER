import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, BellOff, CalendarDays, CheckSquare, Plus, Repeat, Trash2 } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { inList } from '@/lib/db/store'
import { getStore } from '@/lib/db'
import { addDays, formatInstant, relativeDay, dateKey, zonedToInstant } from '@/lib/dates'
import { describeRecurrence } from '@/lib/recurrence'
import { errorMessage, uid } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { Badge, EmptyState, PageHeader, Panel, Segmented } from '@/components/ui/misc'
import { RecurrenceEditor } from '@/components/RecurrenceEditor'
import { toast } from '@/components/ui/toast'
import type { Recurrence, Reminder } from '@/lib/db/types'
import { notificationPermission, requestNotificationPermission, type PermissionState } from './notify'
import { dismissReminder, snoozeReminder } from './ReminderCenter'

const SOURCE_ICON = { task: CheckSquare, event: CalendarDays, habit: Repeat, time_block: CalendarDays, custom: Bell }

export function RemindersPage() {
  const { tz, today, settings } = useSettings()
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')
  const [creating, setCreating] = useState(false)
  const [perm, setPerm] = useState<PermissionState>(notificationPermission())
  const upcoming = useList('reminders', { filters: [inList('status', ['scheduled', 'snoozed'])], order: [{ field: 'remind_at' }] })
  const history = useList('notification_log', { order: [{ field: 'created_at', ascending: false }], limit: 60 })
  const invalidate = useInvalidate()

  const when = (r: Reminder) => new Date(r.status === 'snoozed' && r.snoozed_until ? r.snoozed_until : r.remind_at)

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Reminders"
        subtitle="Reminders from tasks, events and habits, plus your own."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Reminder
          </Button>
        }
      />

      <Panel className="mb-4" title="How reminders reach you">
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex items-start gap-3">
            <Badge color="rgb(var(--success))">On</Badge>
            <span>
              <strong>In the app.</strong> While Life Planner is open in any tab, due reminders pop up from the bell.
            </span>
          </li>
          <li className="flex items-start gap-3">
            {perm === 'granted' ? <Badge color="rgb(var(--success))">On</Badge> : <Badge>Off</Badge>}
            <span className="flex-1">
              <strong>Browser notifications.</strong> Show a system notification when the app is open but in the background.
              {perm === 'denied' && ' Notifications are blocked for this site; allow them in your browser’s site settings.'}
              {perm === 'unsupported' && ' This browser does not support notifications. On iPhone, add the app to your Home Screen first (iOS 16.4 or newer).'}
            </span>
            {perm === 'default' && (
              <Button size="sm" variant="secondary" onClick={async () => setPerm(await requestNotificationPermission())}>
                Enable
              </Button>
            )}
          </li>
          <li className="flex items-start gap-3">
            {settings.notifications.push ? <Badge color="rgb(var(--success))">On</Badge> : <Badge>Optional</Badge>}
            <span className="flex-1">
              <strong>Push when the app is closed.</strong> Needs the free Supabase push function to be set up. Without it, nothing can notify you while every tab is closed.{' '}
              <Link to="/settings#notifications" className="text-accent hover:underline">
                Settings
              </Link>
            </span>
          </li>
          {settings.quiet_hours_start && settings.quiet_hours_end && (
            <li className="flex items-start gap-3">
              <BellOff className="mt-0.5 h-4 w-4 text-muted" aria-hidden />
              <span>
                Quiet hours {settings.quiet_hours_start}–{settings.quiet_hours_end}: reminders wait silently in the bell.
              </span>
            </li>
          )}
        </ul>
      </Panel>

      <Segmented
        label="Reminder list"
        className="mb-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: `Upcoming${upcoming.data?.length ? ` · ${upcoming.data.length}` : ''}` },
          { value: 'history', label: 'History' },
        ]}
      />

      {tab === 'upcoming' ? (
        (upcoming.data ?? []).length === 0 ? (
          <EmptyState icon={Bell} title="Nothing scheduled">
            Add reminder times to tasks and events, a reminder time to habits, or create your own.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {(upcoming.data ?? []).map((r) => {
              const Icon = SOURCE_ICON[r.source_type] ?? Bell
              const at = when(r)
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <Link to={r.url || '/reminders'} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted">
                      {relativeDay(dateKey(at, tz), today)}, {formatInstant(at, tz, settings.time_format)}
                      {r.status === 'snoozed' && ' · snoozed'}
                      {r.recurrence && ` · ${describeRecurrence(r.recurrence)}`}
                      {r.body && ` · ${r.body}`}
                    </p>
                  </Link>
                  <Menu
                    label={`Actions for ${r.title}`}
                    items={[
                      { label: 'Snooze 1 hour', onSelect: () => void snoozeReminder(r, 60).then(() => invalidate('reminders')) },
                      { label: 'Snooze to tomorrow', onSelect: () => void snoozeReminder(r, 24 * 60).then(() => invalidate('reminders')) },
                      { label: 'Dismiss', onSelect: () => void dismissReminder(r).then(() => invalidate('reminders')) },
                      {
                        label: 'Delete',
                        icon: <Trash2 className="h-4 w-4" />,
                        danger: true,
                        hidden: r.source_type !== 'custom',
                        onSelect: async () => {
                          try {
                            await getStore().remove('reminders', r.id)
                            invalidate('reminders')
                          } catch (e) {
                            toast.error(errorMessage(e))
                          }
                        },
                      },
                    ]}
                  />
                </li>
              )
            })}
          </ul>
        )
      ) : (history.data ?? []).length === 0 ? (
        <EmptyState title="No notifications yet" />
      ) : (
        <ul className="flex flex-col">
          {(history.data ?? []).map((h) => (
            <li key={h.id} className="flex items-center gap-3 border-b border-line px-1 py-2 text-sm last:border-0">
              {h.url ? (
                <Link to={h.url} className="min-w-0 flex-1 truncate hover:underline">
                  {h.title}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
              )}
              <Badge>{h.channel === 'in_app' ? 'In app' : h.channel === 'browser' ? 'Browser' : 'Push'}</Badge>
              {h.status !== 'delivered' && <Badge color="rgb(var(--warning))">{h.status}</Badge>}
              <span className="w-32 text-right text-xs text-muted">{formatInstant(h.created_at, tz, 'd MMM, HH:mm')}</span>
            </li>
          ))}
        </ul>
      )}

      <CustomReminderDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

/** Create a stand-alone reminder (optionally repeating). */
export function CustomReminderDialog({ open, onClose, initialTitle, initialBody, onSaved }: { open: boolean; onClose: () => void; initialTitle?: string; initialBody?: string; onSaved?: (r: Reminder) => void }) {
  const { tz, today } = useSettings()
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('09:00')
  const [rec, setRec] = useState<Recurrence | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(initialTitle ?? '')
      setBody(initialBody ?? '')
      setDate(addDays(today, 1))
      setTime('09:00')
      setRec(null)
      setError('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!title.trim()) return setError('What should the reminder say?')
    const at = zonedToInstant(date, time, tz)
    if (at.getTime() < Date.now() - 60000) return setError('Pick a time in the future.')
    try {
      const r = await getStore().insert('reminders', {
        source_type: 'custom',
        source_id: null,
        occurrence_key: date,
        title: title.trim().slice(0, 300),
        body: body.trim(),
        url: '/reminders',
        remind_at: at.toISOString(),
        offset_minutes: 0,
        recurrence: rec,
        status: 'scheduled',
        dedupe_key: `custom:${uid()}:${date}`,
      })
      invalidate('reminders')
      window.dispatchEvent(new Event('lp:reminders-changed'))
      toast.success('Reminder set')
      onSaved?.(r)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New reminder"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Remind me to" htmlFor="cr-title" className="col-span-2" error={error || undefined}>
          <Input id="cr-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pay hostel fees" />
        </Field>
        <Field label="Date" htmlFor="cr-date">
          <Input id="cr-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time" htmlFor="cr-time">
          <Input id="cr-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <div className="col-span-2">
          <RecurrenceEditor idPrefix="cr-rec" value={rec} onChange={setRec} />
        </div>
        <Field label="Note" htmlFor="cr-body" className="col-span-2">
          <Textarea id="cr-body" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
