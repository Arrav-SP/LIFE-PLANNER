import { lazy, type ComponentType } from 'react'

const named = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })))

export const PAGES: { path: string; Component: ComponentType }[] = [
  { path: '/', Component: named(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
  { path: '/tasks', Component: named(() => import('@/features/tasks/TasksPage'), 'TasksPage') },
  { path: '/calendar', Component: named(() => import('@/features/calendar/CalendarPage'), 'CalendarPage') },
  { path: '/planner', Component: named(() => import('@/features/planner/PlannerPage'), 'PlannerPage') },
  { path: '/study', Component: named(() => import('@/features/study/StudyPage'), 'StudyPage') },
  { path: '/fitness', Component: named(() => import('@/features/fitness/FitnessPage'), 'FitnessPage') },
  { path: '/habits', Component: named(() => import('@/features/habits/HabitsPage'), 'HabitsPage') },
  { path: '/goals', Component: named(() => import('@/features/goals/GoalsPage'), 'GoalsPage') },
  { path: '/projects', Component: named(() => import('@/features/goals/ProjectsPage'), 'ProjectsPage') },
]
