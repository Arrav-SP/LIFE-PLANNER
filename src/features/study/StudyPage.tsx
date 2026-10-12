import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BookOpen, Pause, Pencil, Play, Plus, Square, Target, Timer, Trash2, X } from 'lucide-react'
import { useSettings, useMinuteTick } from '@/settings/SettingsProvider'
import { useInvalidate, useList } from '@/lib/db/hooks'
import { gte } from '@/lib/db/store'
import { getStore } from '@/lib/db'
import { addDays, dateKey, formatInstant, startOfWeek, zonedToInstant } from '@/lib/dates'
import { cn, errorMessage, formatMinutes } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Dialog, confirm } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { ColorPicker } from '@/components/ColorPicker'
import { Menu } from '@/components/ui/Menu'
import { ColorDot, EmptyState, PageHeader, Panel, ProgressBar, Segmented, Stat } from '@/components/ui/misc'
import { toast } from '@/components/ui/toast'
import { useLookups } from '@/lib/lookups'
import { linkTo } from '@/lib/links'
import { useScrollIntoView } from '@/lib/useScrollIntoView'
import { showBrowserNotification } from '@/features/reminders/notify'
import type { StudySession, StudyTopic, Subject } from '@/lib/db/types'
import { activeMs, clock, focusMinutes, loadTimer, pause, pomodoro, resume, saveTimer, type TimerState } from './timer'

export function StudyPage() {
  const { today, tz, settings } = useSettings()
  useMinuteTick()
  const subjects = useList('subjects', { order: [{ field: 'name' }] })
  const topics = useList('study_topics', { order: [{ field: 'sort_order' }, { field: 'created_at' }] })
  const weekStart = startOfWeek(today, settings.week_start)
  const since = zonedToInstant(addDays(weekStart, -28), '00:00', tz).toISOString()
  const sessions = useList('study_sessions', { filters: [gte('started_at', since)], order: [{ field: 'started_at', ascending: false }] })
  const [editing, setEditing] = useState<Subject | null | 'new'>(null)
  // The open subject lives in the address (/study?subject=<id>) so other pages can link to it.
  const [params, setParams] = useSearchParams()
  const selected = params.get('subject')
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('subject', id)
    else next.delete('subject')
    setParams(next, { replace: true })
  }
  const [logOpen, setLogOpen] = useState(false)

  const active = (subjects.data ?? []).filter((s) => !s.archived_at)
  const done = (sessions.data ?? []).filter((s) => s.ended_at)
  const weekStartInstant = zonedToInstant(weekStart, '00:00', tz).getTime()
  const minutesOf = (list: StudySession[]) => list.reduce((s, x) => s + (x.actual_minutes ?? 0), 0)
  const todayMin = minutesOf(done.filter((s) => dateKey(s.started_at, tz) === today))
  const weekMin = minutesOf(done.filter((s) => Date.parse(s.started_at) >= weekStartInstant))
  const sel = active.find((s) => s.id === selected) ?? null
  useScrollIntoView(sel ? 'subject-detail' : null, !!sel)

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Study"
        subtitle="Focus sessions, subjects, books and courses."
        actions={
          <>
            <Button variant="outline" onClick={() => setLogOpen(true)}>
              Log past session
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden /> Subject
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Today" value={formatMinutes(todayMin) || '0m'} />
        <Stat label="This week" value={formatMinutes(weekMin) || '0m'} />
        <Stat label="Sessions this week" value={done.filter((s) => Date.parse(s.started_at) >= weekStartInstant).length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <FocusTimer subjects={active} topics={topics.data ?? []} openSessions={(sessions.data ?? []).filter((s) => !s.ended_at)} />
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Subjects" bodyClassName="p-2">
            {active.length === 0 ? (
              <EmptyState icon={BookOpen} title="No subjects yet" action={<Button onClick={() => setEditing('new')}>Add a subject</Button>}>
                Add FAT subjects, the ML course, or UPSC books like NCERT History.
              </EmptyState>
            ) : (
              <ul className="flex flex-col">
                {active.map((s) => {
                  const mins = minutesOf(done.filter((x) => x.subject_id === s.id && Date.parse(x.started_at) >= weekStartInstant))
                  const t = (topics.data ?? []).filter((x) => x.subject_id === s.id)
                  return (
                    <li key={s.id}>
                      <button type="button" onClick={() => setSelected(s.id === selected ? null : s.id)} className={cn('w-full rounded-lg px-2 py-2.5 text-left hover:bg-surface-2', s.id === selected && 'bg-surface-2')}>
                        <div className="flex items-center gap-2 text-sm">
                          <ColorDot color={s.color} />
                          <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                          <span className="text-xs text-muted">
                            {formatMinutes(mins) || '0m'}
                            {s.weekly_target_minutes ? ` / ${formatMinutes(s.weekly_target_minutes)}` : ''} this week
                          </span>
                        </div>
                        {(s.weekly_target_minutes || t.length > 0) && (
                          <div className="mt-1.5 flex items-center gap-3 pl-4">
                            {s.weekly_target_minutes ? <ProgressBar className="flex-1" value={mins / s.weekly_target_minutes} color={s.color} label={`${s.name} weekly target`} /> : <span className="flex-1" />}
                            {t.length > 0 && (
                              <span className="text-xs text-muted">
                                {t.filter((x) => x.status === 'done').length}/{t.length} topics
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
          {sel && <SubjectDetail subject={sel} topics={(topics.data ?? []).filter((t) => t.subject_id === sel.id)} onEdit={() => setEditing(sel)} onClose={() => setSelected(null)} />}
          <Panel title="Recent sessions" bodyClassName="p-2">
            {done.length === 0 ? (
              <p className="p-2 text-sm text-muted">Finished sessions show up here.</p>
            ) : (
              <ul className="flex flex-col">
                {done.slice(0, 15).map((s) => {
                  const subj = (subjects.data ?? []).find((x) => x.id === s.subject_id)
                  const topic = (topics.data ?? []).find((x) => x.id === s.topic_id)
                  return (
                    <li key={s.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
                      <ColorDot color={subj?.color} />
                      <span className="min-w-0 flex-1 truncate">
                        {subj?.name ?? 'General'}
                        {topic && <span className="text-muted"> · {topic.title}</span>}
                        {s.notes && <span className="block truncate text-xs text-muted">{s.notes}</span>}
                      </span>
                      <span className="text-xs text-muted">{formatInstant(s.started_at, tz, 'EEE d MMM')}</span>
                      <span className="w-14 text-right tabular font-medium">{formatMinutes(s.actual_minutes ?? 0)}</span>
                      <DeleteSession id={s.id} />
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <SubjectEditor open={editing !== null} subject={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      <LogSessionDialog open={logOpen} onClose={() => setLogOpen(false)} subjects={active} topics={topics.data ?? []} />
    </div>
  )
}

function DeleteSession({ id }: { id: string }) {
  const invalidate = useInvalidate()
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Delete session"
      className="opacity-100 md:opacity-0 md:group-hover:opacity-100"
      onClick={async () => {
        if (!(await confirm({ title: 'Delete this session?', confirmLabel: 'Delete', danger: true }))) return
        try {
          await getStore().remove('study_sessions', id)
          invalidate('study_sessions')
        } catch (e) {
          toast.error(errorMessage(e))
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  )
}

function FocusTimer({ subjects, topics, openSessions }: { subjects: Subject[]; topics: StudyTopic[]; openSessions: StudySession[] }) {
  const invalidate = useInvalidate()
  const [state, setState] = useState<TimerState | null>(() => loadTimer())
  const [now, setNow] = useState(Date.now())
  const [mode, setMode] = useState<'timer' | 'pomodoro'>('pomodoro')
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [work, setWork] = useState(25)
  const [brk, setBrk] = useState(5)
  const [planned, setPlanned] = useState('')
  const [notes, setNotes] = useState('')
  const lastPhase = useRef<string | null>(null)

  // Recover a session started on another device or before local storage was cleared.
  useEffect(() => {
    if (state) return
    const open = openSessions[0]
    if (open) {
      const s: TimerState = { sessionId: open.id, mode: open.mode === 'pomodoro' ? 'pomodoro' : 'timer', startedAt: Date.parse(open.started_at), pausedAt: null, pausedMs: open.paused_seconds * 1000, workMinutes: 25, breakMinutes: 5, plannedMinutes: open.planned_minutes }
      setState(s)
      saveTimer(s)
    }
  }, [openSessions, state])

  useEffect(() => {
    if (!state || state.pausedAt) return
    const id = setInterval(() => setNow(Date.now()), 500)
    const vis = () => setNow(Date.now())
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [state])

  const pomo = state?.mode === 'pomodoro' ? pomodoro(state, now) : null
  const elapsed = state ? activeMs(state, now) : 0
  const display = pomo ? clock(pomo.remainingMs) : clock(elapsed)

  useEffect(() => {
    if (!pomo) {
      lastPhase.current = null
      return
    }
    const key = `${pomo.phase}:${pomo.completed}`
    if (lastPhase.current && lastPhase.current !== key) {
      const msg = pomo.phase === 'break' ? `Pomodoro ${pomo.completed} done. Take a ${state!.breakMinutes}-minute break.` : 'Break over. Back to focus.'
      toast.info(msg)
      if (document.hidden) void showBrowserNotification('Focus timer', msg, '/study', 'focus-timer')
    }
    lastPhase.current = key
  }, [pomo?.phase, pomo?.completed]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!state) return
    const prev = document.title
    document.title = `${display} · ${pomo ? (pomo.phase === 'work' ? 'Focus' : 'Break') : 'Studying'}`
    return () => {
      document.title = prev
    }
  }, [display, state, pomo?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (s: TimerState | null) => {
    setState(s)
    saveTimer(s)
    setNow(Date.now())
  }

  const start = async () => {
    try {
      const started = new Date()
      const row = await getStore().insert('study_sessions', { subject_id: subjectId || null, topic_id: topicId || null, mode, started_at: started.toISOString(), ended_at: null, planned_minutes: planned ? Number(planned) : null, paused_seconds: 0, pomodoros: 0, notes: '' })
      update({ sessionId: row.id, mode, startedAt: started.getTime(), pausedAt: null, pausedMs: 0, workMinutes: Math.max(1, work), breakMinutes: Math.max(1, brk), plannedMinutes: planned ? Number(planned) : null })
      invalidate('study_sessions')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const stop = async (discard = false) => {
    if (!state) return
    const t = Date.now()
    try {
      if (discard) {
        if (!(await confirm({ title: 'Discard this session?', message: 'The time will not be recorded.', confirmLabel: 'Discard', danger: true }))) return
        await getStore().remove('study_sessions', state.sessionId)
      } else {
        const s = resume(state, t)
        await getStore().update('study_sessions', state.sessionId, {
          ended_at: new Date(t).toISOString(),
          actual_minutes: focusMinutes(s, t),
          paused_seconds: Math.round(s.pausedMs / 1000),
          pomodoros: s.mode === 'pomodoro' ? pomodoro(s, t).completed : 0,
          notes,
        })
        toast.success(`Saved ${formatMinutes(focusMinutes(s, t)) || 'under a minute'} of focus`)
      }
      update(null)
      setNotes('')
      invalidate('study_sessions')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const subjectTopics = topics.filter((t) => t.subject_id === (state ? undefined : subjectId) && t.status !== 'done')

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-accent" aria-hidden /> Focus timer
        </span>
      }
    >
      {state ? (
        <div className="flex flex-col items-center gap-4 text-center">
          {pomo && (
            <p className={cn('text-xs font-semibold uppercase tracking-wide', pomo.phase === 'work' ? 'text-accent' : 'text-success')}>
              {pomo.phase === 'work' ? `Focus · pomodoro ${pomo.completed + 1}` : 'Break'}
            </p>
          )}
          <p className="font-mono text-6xl font-semibold tabular" aria-live="off" role="timer">
            {display}
          </p>
          <p className="text-sm text-muted">
            {pomo ? `${formatMinutes(Math.round(pomo.workMs / 60000)) || '0m'} focused` : state.plannedMinutes ? `Goal ${formatMinutes(state.plannedMinutes)}` : 'Counting up'}
            {state.pausedAt && ' · paused'}
          </p>
          {state.plannedMinutes && !pomo && <ProgressBar value={elapsed / (state.plannedMinutes * 60000)} className="w-full" label="Planned time" />}
          <div className="flex gap-2">
            {state.pausedAt ? (
              <Button onClick={() => update(resume(state, Date.now()))}>
                <Play className="h-4 w-4" aria-hidden /> Resume
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => update(pause(state, Date.now()))}>
                <Pause className="h-4 w-4" aria-hidden /> Pause
              </Button>
            )}
            <Button variant="primary" onClick={() => void stop()}>
              <Square className="h-4 w-4" aria-hidden /> Finish
            </Button>
            <Button variant="ghost" size="icon" aria-label="Discard session" onClick={() => void stop(true)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Textarea aria-label="Session notes" placeholder="What did you cover? (saved when you finish)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="text-xs text-subtle">The timer keeps time even if you refresh or close the tab. Alerts only appear while this app is open.</p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <Segmented
            label="Timer mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'pomodoro', label: 'Pomodoro' },
              { value: 'timer', label: 'Stopwatch' },
            ]}
          />
          <Field label="Subject" htmlFor="ft-subj">
            <Select
              id="ft-subj"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value)
                setTopicId('')
              }}
            >
              <option value="">General</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {subjectTopics.length > 0 && (
            <Field label="Topic" htmlFor="ft-topic">
              <Select id="ft-topic" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">Any</option>
                {subjectTopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode === 'pomodoro' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Focus (min)" htmlFor="ft-work">
                <Input id="ft-work" type="number" min={1} max={180} value={work} onChange={(e) => setWork(Number(e.target.value))} />
              </Field>
              <Field label="Break (min)" htmlFor="ft-break">
                <Input id="ft-break" type="number" min={1} max={60} value={brk} onChange={(e) => setBrk(Number(e.target.value))} />
              </Field>
            </div>
          ) : (
            <Field label="Planned minutes (optional)" htmlFor="ft-plan">
              <Input id="ft-plan" type="number" min={1} value={planned} onChange={(e) => setPlanned(e.target.value)} />
            </Field>
          )}
          <Button type="submit" className="mt-1">
            <Play className="h-4 w-4" aria-hidden /> Start focusing
          </Button>
        </form>
      )}
    </Panel>
  )
}

const TOPIC_STATUS: { v: StudyTopic['status']; label: string; cls: string }[] = [
  { v: 'not_started', label: 'Not started', cls: 'bg-surface-2 text-muted' },
  { v: 'in_progress', label: 'In progress', cls: 'bg-accent-soft text-fg' },
  { v: 'revise', label: 'Revise', cls: 'bg-warning/15 text-warning' },
  { v: 'done', label: 'Done', cls: 'bg-success/15 text-success' },
]

function SubjectDetail({ subject, topics, onEdit, onClose }: { subject: Subject; topics: StudyTopic[]; onEdit: () => void; onClose: () => void }) {
  const invalidate = useInvalidate()
  const [title, setTitle] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      invalidate('study_topics')
    }
  }
  const addTopics = () =>
    run(async () => {
      // Paste several lines to add many topics at once.
      const lines = title.split('\n').map((l) => l.trim()).filter(Boolean)
      for (const [i, l] of lines.entries()) await getStore().insert('study_topics', { subject_id: subject.id, title: l.slice(0, 300), status: 'not_started', sort_order: topics.length + i })
      setTitle('')
    })
  const doneCount = topics.filter((t) => t.status === 'done').length
  const goal = useLookups().goal(subject.goal_id)

  return (
    <Panel
      id="subject-detail"
      title={
        <span className="flex items-center gap-2">
          <ColorDot color={subject.color} /> {subject.name}
        </span>
      }
      action={
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Close subject" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {goal && (
        <Link to={linkTo.goal(goal.id)} className="mb-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <Target className="h-3 w-3" aria-hidden /> {goal.title}
        </Link>
      )}
      {subject.description && <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{subject.description}</p>}
      {topics.length > 0 && (
        <>
          <ProgressBar value={doneCount / topics.length} color={subject.color} label="Topics done" />
          <p className="mb-3 mt-1 text-xs text-muted">
            {doneCount} of {topics.length} topics done
          </p>
          <ul className="mb-3 flex flex-col">
            {topics.map((t) => {
              const st = TOPIC_STATUS.find((x) => x.v === t.status)!
              const next = TOPIC_STATUS[(TOPIC_STATUS.indexOf(st) + 1) % TOPIC_STATUS.length]
              return (
                <li key={t.id} className="group flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2">
                  <span className={cn('min-w-0 flex-1 truncate text-sm', t.status === 'done' && 'text-muted line-through')}>{t.title}</span>
                  <button type="button" className={cn('rounded-full px-2 py-0.5 text-xs font-medium', st.cls)} title={`Change to ${next.label}`} onClick={() => void run(() => getStore().update('study_topics', t.id, { status: next.v }))}>
                    {st.label}
                  </button>
                  <Menu
                    label={`Actions for ${t.title}`}
                    items={[
                      ...TOPIC_STATUS.filter((x) => x.v !== t.status).map((x) => ({ label: `Mark ${x.label.toLowerCase()}`, onSelect: () => void run(() => getStore().update('study_topics', t.id, { status: x.v })) })),
                      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void run(() => getStore().remove('study_topics', t.id)) },
                    ]}
                  />
                </li>
              )
            })}
          </ul>
        </>
      )}
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void addTopics()
        }}
      >
        <Textarea
          aria-label="New topics"
          rows={1}
          placeholder="Add a topic or chapter (paste many lines to add several)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void addTopics()
            }
          }}
        />
        <Button type="submit" variant="secondary" disabled={!title.trim()}>
          Add
        </Button>
      </form>
    </Panel>
  )
}

const subjectSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name.').max(200),
  kind: z.enum(['subject', 'course', 'book', 'skill']),
  description: z.string().max(5000),
  weekly_target_hours: z.string().refine((s) => s.trim() === '' || (Number(s) > 0 && Number(s) <= 100), 'Enter hours between 0 and 100.'),
  color: z.string(),
  goal_id: z.string(),
})
type SubjectForm = z.infer<typeof subjectSchema>

function SubjectEditor({ open, onClose, subject }: { open: boolean; onClose: () => void; subject: Subject | null }) {
  const invalidate = useInvalidate()
  const { goals } = useLookups()
  const defaults = (): SubjectForm => ({
    name: subject?.name ?? '',
    kind: subject?.kind ?? 'subject',
    description: subject?.description ?? '',
    weekly_target_hours: subject?.weekly_target_minutes ? String(+(subject.weekly_target_minutes / 60).toFixed(2)) : '',
    color: subject?.color ?? '#0891b2',
    goal_id: subject?.goal_id ?? '',
  })
  const { register, handleSubmit, control, reset, formState } = useForm<SubjectForm>({ resolver: zodResolver(subjectSchema), defaultValues: defaults() })
  useEffect(() => {
    if (open) reset(defaults())
  }, [open, subject?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit(async (f) => {
    const values = { name: f.name.trim(), kind: f.kind, description: f.description, weekly_target_minutes: f.weekly_target_hours.trim() ? Math.round(Number(f.weekly_target_hours) * 60) : null, color: f.color, goal_id: f.goal_id || null }
    try {
      if (subject) await getStore().update('subjects', subject.id, values)
      else await getStore().insert('subjects', values)
      invalidate('subjects')
      toast.success(subject ? 'Saved' : 'Subject added')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={subject ? 'Edit subject' : 'New subject'}
      footer={
        <>
          {subject && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                if (!(await confirm({ title: 'Archive this subject?', message: 'It is hidden from the list. Past sessions are kept.', confirmLabel: 'Archive' }))) return
                await getStore().update('subjects', subject.id, { archived_at: new Date().toISOString() })
                invalidate('subjects')
                onClose()
              }}
            >
              Archive
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form className="grid grid-cols-2 gap-4" onSubmit={(e) => void submit(e)}>
        <Field label="Name" htmlFor="s-name" className="col-span-2" error={formState.errors.name?.message}>
          <Input id="s-name" data-autofocus placeholder="e.g. Operating Systems" {...register('name')} />
        </Field>
        <Field label="Type" htmlFor="s-kind">
          <Select id="s-kind" {...register('kind')}>
            <option value="subject">Subject</option>
            <option value="course">Course</option>
            <option value="book">Book</option>
            <option value="skill">Skill</option>
          </Select>
        </Field>
        <Field label="Weekly target (hours)" htmlFor="s-target" error={formState.errors.weekly_target_hours?.message}>
          <Input id="s-target" inputMode="decimal" placeholder="e.g. 6" {...register('weekly_target_hours')} />
        </Field>
        <Field label="Goal" htmlFor="s-goal" className="col-span-2">
          <Select id="s-goal" {...register('goal_id')}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Color" className="col-span-2">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Notes" htmlFor="s-desc" className="col-span-2">
          <Textarea id="s-desc" rows={2} {...register('description')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

function LogSessionDialog({ open, onClose, subjects, topics }: { open: boolean; onClose: () => void; subjects: Subject[]; topics: StudyTopic[] }) {
  const { today, tz } = useSettings()
  const invalidate = useInvalidate()
  const [f, setF] = useState({ subject: '', topic: '', date: today, start: '18:00', minutes: '60', notes: '' })
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setF({ subject: '', topic: '', date: today, start: '18:00', minutes: '60', notes: '' })
      setError('')
    }
  }, [open, today])
  const subjectTopics = useMemo(() => topics.filter((t) => t.subject_id === f.subject), [topics, f.subject])
  const save = async () => {
    const mins = Math.round(Number(f.minutes))
    if (!(mins > 0 && mins <= 24 * 60)) return setError('Enter the minutes studied (1 to 1440).')
    const start = zonedToInstant(f.date, f.start, tz)
    if (start.getTime() > Date.now()) return setError('That time is in the future.')
    try {
      await getStore().insert('study_sessions', { subject_id: f.subject || null, topic_id: f.topic || null, mode: 'manual', started_at: start.toISOString(), ended_at: new Date(start.getTime() + mins * 60000).toISOString(), actual_minutes: mins, planned_minutes: null, paused_seconds: 0, pomodoros: 0, notes: f.notes })
      invalidate('study_sessions')
      toast.success('Session logged')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log a past session"
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
        <Field label="Subject" htmlFor="l-subj" className="col-span-2">
          <Select id="l-subj" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value, topic: '' })}>
            <option value="">General</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        {subjectTopics.length > 0 && (
          <Field label="Topic" htmlFor="l-topic" className="col-span-2">
            <Select id="l-topic" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
              <option value="">Any</option>
              {subjectTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Date" htmlFor="l-date">
          <Input id="l-date" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Started at" htmlFor="l-start">
          <Input id="l-start" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </Field>
        <Field label="Minutes" htmlFor="l-min" className="col-span-2" error={error || undefined}>
          <Input id="l-min" type="number" min={1} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
        </Field>
        <Field label="Notes" htmlFor="l-notes" className="col-span-2">
          <Textarea id="l-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
