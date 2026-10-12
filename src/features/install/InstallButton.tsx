import { useState, type ReactNode } from 'react'
import { Download, EllipsisVertical, Share, SquarePlus } from 'lucide-react'
import { promptInstall, useInstall } from '@/lib/install'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/toast'

/**
 * "Install app" for the home screen / dock. Uses the browser's own install prompt where it exists
 * (Chrome, Edge, Android) and shows the manual steps elsewhere (iPhone and iPad Safari).
 * Hidden once the app is running installed.
 */
export function InstallButton({ variant }: { variant: 'sidebar' | 'icon' }) {
  const { installed, canPrompt, ios } = useInstall()
  const [help, setHelp] = useState(false)
  if (installed) return null

  const onClick = async () => {
    if (!canPrompt) return setHelp(true)
    try {
      if (await promptInstall()) toast.success('Installed. Open Life Planner from your home screen.')
    } catch {
      setHelp(true)
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <button type="button" aria-label="Install app" title="Install app" onClick={() => void onClick()} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2">
          <Download className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onClick()}
          className={cn('mb-4 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg')}
        >
          <Download className="h-4 w-4" aria-hidden /> Install app
        </button>
      )}
      <Dialog
        open={help}
        onClose={() => setHelp(false)}
        title={ios ? 'Add to your Home Screen' : 'Install Life Planner'}
        description="It then opens like a normal app, full screen, with its own icon."
        footer={<Button onClick={() => setHelp(false)}>Got it</Button>}
      >
        {ios ? (
          <ol className="flex flex-col gap-3 text-sm">
            <Step n={1}>
              Tap the <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> <b>Share</b> button in Safari's toolbar.
            </Step>
            <Step n={2}>
              Scroll down and tap <SquarePlus className="inline h-4 w-4 align-text-bottom" aria-hidden /> <b>Add to Home Screen</b>, then <b>Add</b>.
            </Step>
            <Step n={3}>Open Life Planner from the new icon. Notifications on iPhone only work from there (iOS 16.4 or later).</Step>
          </ol>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            <Step n={1}>
              <b>Android (Chrome):</b> tap the <EllipsisVertical className="inline h-4 w-4 align-text-bottom" aria-label="menu" /> menu, then <b>Install app</b> or <b>Add to Home screen</b>.
            </Step>
            <Step n={2}>
              <b>Computer (Chrome or Edge):</b> click the install icon at the right of the address bar, or the menu, then <b>Install Life Planner</b>.
            </Step>
            <Step n={3}>If you don't see the option, reload the page once. Firefox on a computer can't install web apps; use Chrome or Edge.</Step>
          </ol>
        )}
      </Dialog>
    </>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}
