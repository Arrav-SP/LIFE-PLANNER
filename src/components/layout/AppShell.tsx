import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun, X } from 'lucide-react'
import { useSettings } from '@/settings/SettingsProvider'
import { NAV, MOBILE_TABS } from './nav'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { useAuth } from '@/auth/AuthProvider'
import { QuickAddDialog } from '@/features/tasks/QuickAdd'
import { ReminderCenter } from '@/features/reminders/ReminderCenter'
import { InstallButton } from '@/features/install/InstallButton'
import { SyncBanner } from '@/features/offline/OfflineSync'

const GROUP_LABEL: Record<string, string> = { main: '', track: 'Track', review: '' }

/** Menu items the user hid in Settings (trackers they don't use). */
function useMenuHidden(): Set<string> {
  const { settings } = useSettings()
  return new Set(settings.dashboard.menu_hidden ?? [])
}

/** One tap between light and dark. Settings → Appearance still offers "System". */
function ThemeToggle() {
  const { settings, update } = useSettings()
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button aria-label={label} title={label} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2" onClick={() => void update({ theme: dark ? 'light' : 'dark' })}>
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}

/** Remembered per device: the desktop sidebar shrunk to an icon rail. */
const SIDEBAR_KEY = 'lp-sidebar-collapsed'

function SideNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const groups = ['main', 'track', 'review'] as const
  const hidden = useMenuHidden()
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-0.5">
          {GROUP_LABEL[g] && !collapsed && <p className="px-3 pb-1 text-xs font-medium text-subtle">{GROUP_LABEL[g]}</p>}
          {NAV.filter((n) => n.group === g && !hidden.has(n.to)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onClick={onNavigate}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  isActive ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-accent')} aria-hidden />
                  <span className={cn(collapsed && 'sr-only')}>{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { mode, user } = useAuth()
  const [quickAdd, setQuickAdd] = useState(false)
  const [more, setMore] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1')
      } catch {
        /* preference only */
      }
      return !c
    })
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => setMore(false), [location.pathname])

  // Desktop keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/search')
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role=dialog]')) return
      if (e.key === 'q' || e.key === 'n') {
        e.preventDefault()
        setQuickAdd(true)
      } else if (e.key === '/') {
        e.preventDefault()
        navigate('/search')
      } else if (e.key === 't') navigate('/')
      else if (e.key === 'c') navigate('/calendar')
      else if (e.key === 'p') navigate('/calendar?view=day')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const hidden = useMenuHidden()
  const tabs = NAV.filter((n) => MOBILE_TABS.includes(n.to) && !hidden.has(n.to))

  return (
    <div className="min-h-full md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface py-4 transition-[width] duration-200 md:flex', collapsed ? 'w-16 px-2' : 'w-60 px-3')}>
        <div className={cn('mb-5 flex items-center gap-2', collapsed ? 'flex-col' : 'px-2')}>
          <Logo />
          {!collapsed && <span className="truncate font-semibold">Life Planner</span>}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg', !collapsed && 'ml-auto')}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        <button
          onClick={() => setQuickAdd(true)}
          aria-label={collapsed ? 'Quick add' : undefined}
          title={collapsed ? 'Quick add (Q)' : undefined}
          className={cn('mb-4 flex items-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent/90', collapsed ? 'justify-center' : 'px-3')}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && (
            <>
              Quick add
              <kbd className="ml-auto rounded bg-white/20 px-1.5 text-[11px]">Q</kbd>
            </>
          )}
        </button>
        {collapsed ? (
          <div className="mb-2 flex justify-center">
            <InstallButton variant="icon" />
          </div>
        ) : (
          <InstallButton variant="sidebar" />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SideNav collapsed={collapsed} />
        </div>
        <div className={cn('mt-3 flex items-center gap-1', collapsed ? 'justify-center' : 'pl-2')}>
          {!collapsed && <p className="min-w-0 flex-1 truncate text-xs text-subtle">{mode === 'local' ? 'Local mode · this browser only' : user?.email}</p>}
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={({ isActive }) => cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-surface-2 hover:text-fg', isActive ? 'text-accent' : 'text-muted')}
          >
            <Settings className="h-4 w-4" aria-hidden />
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-end gap-1 border-b border-line bg-surface/95 px-4 py-1.5 backdrop-blur md:hidden" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
          <InstallButton variant="icon" />
          <ThemeToggle />
          <ReminderCenter compact />
          <button aria-label="Search" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2" onClick={() => navigate('/search')}>
            <Search className="h-5 w-5" />
          </button>
        </header>
        <div className="hidden items-center justify-end gap-1 px-8 pt-4 md:flex">
          <button aria-label="Search" title="Search (Ctrl K)" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2" onClick={() => navigate('/search')}>
            <Search className="h-5 w-5" />
          </button>
          <ThemeToggle />
          <ReminderCenter />
        </div>
        <SyncBanner />
        {mode === 'local' && (
          <div className="mx-4 mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-fg md:mx-8">
            Local mode: data is saved in this browser only. Add your Supabase keys to sync across devices (see the README).
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-2">
          {children}
        </main>
      </div>

      {/* Mobile quick add */}
      <button
        aria-label="Quick add"
        onClick={() => setQuickAdd(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-fg shadow-pop md:hidden"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Mobile tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted')}
          >
            <n.icon className="h-5 w-5" aria-hidden />
            {n.label}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted" aria-haspopup="dialog">
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          More
        </button>
      </nav>

      {more && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] animate-slide-up overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">All sections</p>
              <button aria-label="Close" onClick={() => setMore(false)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setMore(false)} />
            <NavLink to="/settings" onClick={() => setMore(false)} className="mt-4 flex items-center gap-3 rounded-lg border-t border-line px-3 pt-4 text-sm font-medium text-muted hover:text-fg">
              <Settings className="h-[18px] w-[18px]" aria-hidden /> Settings
            </NavLink>
          </div>
        </div>
      )}

      <QuickAddDialog open={quickAdd} onClose={() => setQuickAdd(false)} />
    </div>
  )
}
