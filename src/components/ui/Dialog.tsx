import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const panel = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement as HTMLElement
    const t = setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), textarea, select, button:not([data-close])')
      ;(el ?? panel.current)?.focus()
    }, 20)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      restore.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-slide-up flex-col rounded-t-2xl border border-line bg-surface shadow-pop md:rounded-2xl',
          size === 'sm' ? 'md:max-w-md' : size === 'lg' ? 'md:max-w-3xl' : 'md:max-w-xl',
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <Button data-close variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:pb-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

type ConfirmOpts = { title: string; message?: string; confirmLabel?: string; danger?: boolean }
let confirmImpl: ((o: ConfirmOpts) => Promise<boolean>) | null = null

/** Promise-based confirmation, rendered by <ConfirmHost/>. */
export function confirm(o: ConfirmOpts): Promise<boolean> {
  return confirmImpl ? confirmImpl(o) : Promise.resolve(false)
}

export function ConfirmHost() {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  useEffect(() => {
    confirmImpl = (o) => new Promise((resolve) => setState({ ...o, resolve }))
    return () => {
      confirmImpl = null
    }
  }, [])
  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  return (
    <Dialog
      open={!!state}
      onClose={() => close(false)}
      title={state?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
            {state?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {state?.message && <p className="text-sm text-muted">{state.message}</p>}
    </Dialog>
  )
}
