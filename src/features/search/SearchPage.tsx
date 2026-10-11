import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, CalendarDays, CheckSquare, FolderKanban, Repeat, Search, StickyNote, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useList } from '@/lib/db/hooks'
import { useSettings } from '@/settings/SettingsProvider'
import { formatInstant } from '@/lib/dates'
import { Input } from '@/components/ui/Field'
import { EmptyState, PageHeader } from '@/components/ui/misc'

interface Hit {
  key: string
  title: string
  sub: string
  to: string
  score: number
}

function score(q: string, title: string, rest: string): number {
  const t = title.toLowerCase()
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.includes(q)) return 60
  if (rest.toLowerCase().includes(q)) return 30
  return 0
}

export function SearchPage() {
  const { tz } = useSettings()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const needle = q.trim().toLowerCase()
  const tasks = useList('tasks')
  const events = useList('events')
  const notes = useList('notes')
  const goals = useList('goals')
  const projects = useList('projects')
  const habits = useList('habits')
  const subjects = useList('subjects')

  const groups = useMemo(() => {
    if (needle.length < 2) return []
    const pick = <T,>(rows: T[] | undefined, map: (r: T) => Omit<Hit, 'score'> & { rest: string }) =>
      (rows ?? [])
        .map((r) => {
          const h = map(r)
          return { ...h, score: score(needle, h.title, h.rest) }
        })
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
    const out: { label: string; icon: LucideIcon; hits: Hit[] }[] = [
      { label: 'Tasks', icon: CheckSquare, hits: pick(tasks.data, (t) => ({ key: t.id, title: t.title, sub: [t.status === 'done' ? 'Done' : t.due_date ?? 'No date', ...t.tags.map((x) => `#${x}`)].join(' · '), to: `/tasks?view=all&task=${t.id}`, rest: `${t.description} ${t.notes} ${t.tags.join(' ')}` })) },
      { label: 'Events', icon: CalendarDays, hits: pick(events.data, (e) => ({ key: e.id, title: e.title, sub: formatInstant(e.start_at, tz, 'd MMM yyyy, HH:mm') + (e.location ? ` · ${e.location}` : ''), to: `/calendar?event=${e.id}`, rest: `${e.description} ${e.location} ${e.notes}` })) },
      { label: 'Notes', icon: StickyNote, hits: pick(notes.data, (n) => ({ key: n.id, title: n.title || 'Untitled', sub: n.status, to: '/inbox', rest: `${n.content} ${n.url} ${n.tags.join(' ')}` })) },
      { label: 'Goals', icon: Target, hits: pick(goals.data, (g) => ({ key: g.id, title: g.title, sub: g.status, to: `/goals?goal=${g.id}`, rest: `${g.description} ${g.notes}` })) },
      { label: 'Projects', icon: FolderKanban, hits: pick(projects.data, (p) => ({ key: p.id, title: p.name, sub: p.status.replace('_', ' '), to: `/projects?project=${p.id}`, rest: `${p.description} ${p.notes}` })) },
      { label: 'Habits', icon: Repeat, hits: pick(habits.data, (h) => ({ key: h.id, title: h.name, sub: h.archived_at ? 'Archived' : 'Active', to: '/habits', rest: h.description })) },
      { label: 'Study', icon: BookOpen, hits: pick(subjects.data, (s) => ({ key: s.id, title: s.name, sub: s.kind, to: '/study', rest: s.description })) },
    ]
    return out.filter((g) => g.hits.length)
  }, [needle, tasks.data, events.data, notes.data, goals.data, projects.data, habits.data, subjects.data, tz])

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" />
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          autoFocus
          type="search"
          aria-label="Search everything"
          placeholder="Search tasks, events, notes, goals…"
          className="h-12 pl-10 text-base"
          value={q}
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
        />
      </div>
      {needle.length < 2 ? (
        <p className="text-center text-sm text-muted">Type at least two letters.</p>
      ) : groups.length === 0 ? (
        <EmptyState icon={Search} title={`No results for “${q.trim()}”`} />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <g.icon className="h-3.5 w-3.5" aria-hidden /> {g.label}
              </h2>
              <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                {g.hits.map((h) => (
                  <li key={h.key} className="border-b border-line last:border-0">
                    <Link to={h.to} className="block px-4 py-2.5 hover:bg-surface-2">
                      <p className="truncate text-sm font-medium">{h.title}</p>
                      <p className="truncate text-xs capitalize text-muted">{h.sub}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
