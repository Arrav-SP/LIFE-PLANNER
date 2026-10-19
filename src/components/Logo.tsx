import { cn } from '@/lib/utils'

/** The app icon (public/favicon.svg) drawn in the user's accent colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8 shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="rgb(var(--accent))" />
      <g fill="rgb(var(--accent-fg))">
        <rect x="11" y="27" width="42" height="12" rx="4" fillOpacity=".28" />
        <rect x="15" y="30" width="14" height="6" rx="2.5" fillOpacity=".95" />
        <circle cx="38" cy="19.5" r="4" />
      </g>
      <path d="M38 22v22" stroke="rgb(var(--accent-fg))" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  )
}
