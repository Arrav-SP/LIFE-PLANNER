import { lazy, type ComponentType } from 'react'
import { LegacyRedirect } from '@/components/LegacyRedirect'
import { MOVED_PATHS } from '@/lib/redirects'

const named = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })))

export const PAGES: { path: string; Component: ComponentType }[] = [
  { path: '/', Component: named(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
  { path: '/tasks', Component: named(() => import('@/features/tasks/TasksPage'), 'TasksPage') },
  { path: '/inbox', Component: named(() => import('@/features/notes/InboxPage'), 'InboxPage') },
  { path: '/coach', Component: named(() => import('@/features/coach/CoachPage'), 'CoachPage') },
  { path: '/calendar', Component: named(() => import('@/features/calendar/CalendarHub'), 'CalendarHub') },
  { path: '/study', Component: named(() => import('@/features/study/StudyPage'), 'StudyPage') },
  { path: '/fitness', Component: named(() => import('@/features/fitness/FitnessPage'), 'FitnessPage') },
  { path: '/reminders', Component: named(() => import('@/features/reminders/RemindersPage'), 'RemindersPage') },
  { path: '/review', Component: named(() => import('@/features/analytics/ReviewHub'), 'ReviewHub') },
  { path: '/search', Component: named(() => import('@/features/search/SearchPage'), 'SearchPage') },
  { path: '/settings', Component: named(() => import('@/features/settings/SettingsPage'), 'SettingsPage') },
  { path: '/habits', Component: named(() => import('@/features/habits/HabitsPage'), 'HabitsPage') },
  { path: '/goals', Component: named(() => import('@/features/goals/GoalsHub'), 'GoalsHub') },
  // Old addresses of merged pages.
  ...MOVED_PATHS.map((path) => ({ path, Component: LegacyRedirect })),
]
