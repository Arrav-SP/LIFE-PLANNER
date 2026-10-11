import {
  BarChart3, BookOpen, CalendarDays, CheckSquare, Dumbbell, Flag, FolderKanban, Home, Inbox, LayoutList, Bell, Repeat, Settings, NotebookPen, Search, Sparkles,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  group: 'main' | 'track' | 'review' | 'system'
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: Home, group: 'main' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, group: 'main' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, group: 'main' },
  { to: '/planner', label: 'Planner', icon: LayoutList, group: 'main' },
  { to: '/inbox', label: 'Inbox & notes', icon: Inbox, group: 'main' },
  { to: '/habits', label: 'Habits', icon: Repeat, group: 'track' },
  { to: '/goals', label: 'Goals', icon: Flag, group: 'track' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, group: 'track' },
  { to: '/study', label: 'Study', icon: BookOpen, group: 'track' },
  { to: '/fitness', label: 'Fitness', icon: Dumbbell, group: 'track' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, group: 'review' },
  { to: '/coach', label: 'Coach', icon: Sparkles, group: 'review' },
  { to: '/review', label: 'Weekly review', icon: NotebookPen, group: 'review' },
  { to: '/reminders', label: 'Reminders', icon: Bell, group: 'system' },
  { to: '/search', label: 'Search', icon: Search, group: 'system' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'system' },
]

export const MOBILE_TABS = ['/', '/tasks', '/calendar', '/habits']
