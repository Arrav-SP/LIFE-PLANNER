import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, Bell, CalendarPlus, CheckSquare, Inbox, Lightbulb, Link2, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { getStore } from '@/lib/db'
import { formatInstant, zonedToInstant, addDays } from '@/lib/dates'
import { cn, errorMessage } from '@/lib/utils'
import { convertedLink, linkTo } from '@/lib/links'
import { useLookups } from '@/lib/lookups'
import { Button } from '@/components/ui/Button'
import { Dialog, confirm } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Menu } from '@/components/ui/Menu'
import { Badge, EmptyState, PageHeader, Segmented } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import type { Note, NoteKind } from '@/lib/db/types'
import { parseQuickEntry } from '@/features/tasks/parse'
import { parseCapture } from './logic'
import { useTaskActions } from '@/features/tasks/actions'
import { EventEditor, type EditorTarget } from '@/features/calendar/EventEditor'
import { CustomReminderDialog } from '@/features/reminders/RemindersPage'

const KIND_ICON: Partial<Record<NoteKind, typeof StickyNote>> = { note: StickyNote, idea: Lightbulb, link: Link2 }

export function InboxPage() {
  const { tz, today } = useSettings()
  const [tab, setTab] = useState<'inbox' | 'processed' | 'archived'>('inbox')
  const [q, setQ] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'note' | 'idea'>('note')
  const [editing, setEditing] = useState<Note | null>(null)
  const [eventFor, setEventFor] = useState<{ note: Note; target: EditorTarget } | null>(null)
  const [reminderFor, setReminderFor] = useState<Note | null>(null)
  const notes = useList('notes', { order: [{ field: 'created_at', ascending: false }] })
  const invalidate = useInvalidate()
  const taskActions = useTaskActions()
  const lookups = useLookups()
  const [params, setParams] = useSearchParams()

  // Deep link: /inbox?note=<id> opens that note.
  const linked = (notes.data ?? []).find((n) => n.id === params.get('note'))
  useEffect(() => {
    if (!linked) return
    setTab(linked.status)
    setEditing(linked)
    params.delete('note')
    setParams(params, { replace: true })
  }, [linked, params, setParams])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (notes.data ?? [])
      .filter((n) => n.status === tab)
      .filter((n) => !s || `${n.title} ${n.content} ${n.url} ${n.tags.join(' ')}`.toLowerCase().includes(s))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [notes.data, tab, q])
  const inboxCount = (notes.data ?? []).filter((n) => n.status === 'inbox').length

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      if (msg) toast.success(msg)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('notes')
    }
  }

  const capture = async () => {
    if (!text.trim()) return
    try {
      await getStore().insert('notes', { ...parseCapture(text, kind), status: 'inbox', pinned: false })
      toast.success('Captured')
      // Clear only once saved, so a failed save keeps what was typed.
      setText('')
      setKind('note')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('notes')
    }
  }

  const toTask = (n: Note) =>
    run(async () => {
      const p = parseQuickEntry(n.title, tz)
      const t = await taskActions.create({
        title: p.title || n.title,
        description: [n.content, n.url].filter(Boolean).join('\n\n'),
        due_date: p.due_date,
        scheduled_at: p.scheduled_at,
        estimated_minutes: p.estimated_minutes,
        priority: p.priority,
        tags: [...new Set([...p.tags, ...n.tags])],
        recurrence: p.recurrence,
        project_id: n.project_id,
        goal_id: n.goal_id,
      })
      if (t) await getStore().update('notes', n.id, { status: 'processed', converted_type: 'task', converted_id: t.id })
    })

  const toEvent = (n: Note) => {
    const start = zonedToInstant(addDays(today, 1), '09:00', tz)
    setEventFor({ note: n, target: { start, end: new Date(start.getTime() + 3600000), allDay: false, title: n.title } })
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Inbox & notes" subtitle="Capture first, decide later. Turn notes into tasks, events or reminders." />
      <form
        className="mb-4 rounded-xl border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void capture()
        }}
      >
        <Textarea
          aria-label="Capture a note"
          rows={2}
          placeholder="Anything on your mind… (Enter to save, Shift+Enter for a new line, #tags work)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void capture()
            }
          }}
          className="border-0 px-1 focus:ring-0"
        />
        <div className="mt-2 flex items-center gap-2">
          <Select aria-label="Note type" value={kind} onChange={(e) => setKind(e.target.value as 'note' | 'idea')} className="h-9 w-32">
            <option value="note">Note</option>
            <option value="idea">Idea</option>
          </Select>
          <span className="hidden text-xs text-subtle sm:inline">Web addresses become links automatically</span>
          <Button type="submit" size="sm" className="ml-auto" disabled={!text.trim()}>
            Capture
          </Button>
        </div>
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Note list"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'inbox', label: `Inbox${inboxCount ? ` · ${inboxCount}` : ''}` },
            { value: 'processed', label: 'Processed' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <Input aria-label="Search notes" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto h-9 w-full sm:w-56" />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={Inbox} title={tab === 'inbox' ? 'Inbox zero' : 'Nothing here'}>
          {tab === 'inbox' && 'Everything captured has been dealt with.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? StickyNote
            return (
              <li key={n.id} className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(n)}>
                  <p className="break-words font-medium">
                    {n.pinned && <Pin className="mr-1 inline h-3.5 w-3.5 text-accent" aria-label="Pinned" />}
                    {n.title || 'Untitled'}
                  </p>
                  {n.content && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-muted">{n.content}</p>}
                  {n.url && (
                    <a href={n.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 block truncate text-sm text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                      {n.url}
                    </a>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {formatInstant(n.created_at, tz, 'd MMM, HH:mm')}
                    {n.converted_type && <ConvertedBadge kind={n.converted_type} id={n.converted_id} />}
                    {reviewWeek(n) && (
                      <Link to={linkTo.week(reviewWeek(n)!)} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                        Open weekly review
                      </Link>
                    )}
                    {lookups.goal(n.goal_id) && (
                      <Link to={linkTo.goal(n.goal_id!)} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                        {lookups.goal(n.goal_id)!.title}
                      </Link>
                    )}
                    {lookups.project(n.project_id) && (
                      <Link to={linkTo.project(n.project_id!)} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                        {lookups.project(n.project_id)!.name}
                      </Link>
                    )}
                    {n.tags.map((t) => (
                      <span key={t} className="text-accent">
                        #{t}
                      </span>
                    ))}
                  </p>
                </button>
                {n.status === 'inbox' && (
                  <div className="hidden gap-1 sm:flex">
                    <Button size="icon-sm" variant="ghost" aria-label="Make it a task" title="Make it a task" onClick={() => void toTask(n)}>
                      <CheckSquare className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Make it an event" title="Make it an event" onClick={() => toEvent(n)}>
                      <CalendarPlus className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Make it a reminder" title="Make it a reminder" onClick={() => setReminderFor(n)}>
                      <Bell className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <Menu
                  label={`Actions for ${n.title}`}
                  items={[
                    { label: 'Make it a task', icon: <CheckSquare className="h-4 w-4" />, hidden: n.status !== 'inbox', onSelect: () => void toTask(n) },
                    { label: 'Make it an event', icon: <CalendarPlus className="h-4 w-4" />, hidden: n.status !== 'inbox', onSelect: () => toEvent(n) },
                    { label: 'Make it a reminder', icon: <Bell className="h-4 w-4" />, hidden: n.status !== 'inbox', onSelect: () => setReminderFor(n) },
                    { label: n.pinned ? 'Unpin' : 'Pin', icon: n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />, onSelect: () => void run(() => getStore().update('notes', n.id, { pinned: !n.pinned })) },
                    { label: 'Mark processed', hidden: n.status === 'processed', onSelect: () => void run(() => getStore().update('notes', n.id, { status: 'processed' })) },
                    { label: n.status === 'archived' ? 'Move to inbox' : 'Archive', icon: <Archive className="h-4 w-4" />, onSelect: () => void run(() => getStore().update('notes', n.id, { status: n.status === 'archived' ? 'inbox' : 'archived' })) },
                    {
                      label: 'Delete',
                      icon: <Trash2 className="h-4 w-4" />,
                      danger: true,
                      onSelect: async () => {
                        if (await confirm({ title: 'Delete this note?', confirmLabel: 'Delete', danger: true })) await run(() => getStore().remove('notes', n.id), 'Note deleted')
                      },
                    },
                  ]}
                />
              </li>
            )
          })}
        </ul>
      )}

      <NoteEditor note={editing} onClose={() => setEditing(null)} />
      <EventEditor
        target={eventFor?.target ?? null}
        onClose={() => setEventFor(null)}
        busy={[]}
        onSaved={(ev) => {
          const n = eventFor?.note
          if (n) void run(() => getStore().update('notes', n.id, { status: 'processed', converted_type: 'event', converted_id: ev.id }))
        }}
      />
      <CustomReminderDialog
        open={!!reminderFor}
        initialTitle={reminderFor?.title}
        initialBody={reminderFor?.content}
        onClose={() => setReminderFor(null)}
        onSaved={(r) => {
          const n = reminderFor
          if (n) void run(() => getStore().update('notes', n.id, { status: 'processed', converted_type: 'reminder', converted_id: r.id }))
        }}
      />
    </div>
  )
}

/** Weekly reviews are saved as notes titled "… week of <date>"; returns that week, if this is one. */
function reviewWeek(n: Note): string | null {
  if (!n.tags.includes('weekly-review')) return null
  return /(\d{4}-\d{2}-\d{2})$/.exec(n.title)?.[1] ?? null
}

function ConvertedBadge({ kind, id }: { kind: string; id: string | null }) {
  const to = convertedLink(kind, id)
  const badge = <Badge>Became a {kind}</Badge>
  if (!to) return badge
  return (
    <Link to={to} className="hover:underline" title={`Open the ${kind}`} onClick={(e) => e.stopPropagation()}>
      {badge}
    </Link>
  )
}

function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState({ title: '', content: '', url: '', tags: '' })
  const [last, setLast] = useState<string | null>(null)
  if (note && note.id !== last) {
    setLast(note.id)
    setDraft({ title: note.title, content: note.content, url: note.url, tags: note.tags.join(', ') })
  }
  if (!note && last) setLast(null)
  const save = async () => {
    if (!note) return
    if (draft.url.trim() && !/^https?:\/\//i.test(draft.url.trim())) return toast.error('Links must start with http:// or https://')
    try {
      await getStore().update('notes', note.id, { title: draft.title.trim(), content: draft.content, url: draft.url.trim(), tags: [...new Set(draft.tags.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))] })
      invalidate('notes')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dialog
      open={!!note}
      onClose={onClose}
      title="Edit note"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className={cn('flex flex-col gap-4')}>
        <Field label="Title" htmlFor="n-title">
          <Input id="n-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="Content" htmlFor="n-content">
          <Textarea id="n-content" rows={8} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </Field>
        <Field label="Link" htmlFor="n-url">
          <Input id="n-url" type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
        </Field>
        <Field label="Tags" htmlFor="n-tags" hint="Comma separated">
          <Input id="n-tags" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  )
}
