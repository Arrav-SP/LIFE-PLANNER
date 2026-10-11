import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Kind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: Kind
  message: string
  action?: { label: string; onClick: () => void }
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<(t: ToastItem[]) => void>()
const emit = () => listeners.forEach((l) => l(items))

function push(kind: Kind, message: string, action?: ToastItem['action'], ms = 4000) {
  const id = nextId++
  items = [...items, { id, kind, message, action }].slice(-4)
  emit()
  setTimeout(() => dismiss(id), action ? 7000 : ms)
  return id
}
function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (m: string, action?: ToastItem['action']) => push('success', m, action),
  error: (m: string) => push('error', m, undefined, 6000),
  info: (m: string, action?: ToastItem['action']) => push('info', m, action),
  dismiss,
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info }

export function Toaster() {
  const [list, setList] = useState(items)
  useEffect(() => {
    listeners.add(setList)
    return () => void listeners.delete(setList)
  }, [])
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
    >
      {list.map((t) => {
        const Icon = icons[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-pop"
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', t.kind === 'error' ? 'text-danger' : t.kind === 'success' ? 'text-success' : 'text-accent')} aria-hidden />
            <p className="min-w-0 flex-1">{t.message}</p>
            {t.action && (
              <button
                className="font-semibold text-accent hover:underline"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" className="text-subtle hover:text-fg" onClick={() => dismiss(t.id)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
