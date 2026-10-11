import { lazy, type ComponentType } from 'react'

const named = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })))

export const PAGES: { path: string; Component: ComponentType }[] = [
  { path: '/', Component: named(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
  { path: '/tasks', Component: named(() => import('@/features/tasks/TasksPage'), 'TasksPage') },
]
