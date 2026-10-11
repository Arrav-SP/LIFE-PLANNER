import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarCheck2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useAuth } from './AuthProvider'
import { errorMessage } from '@/lib/utils'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
})
type Values = z.infer<typeof schema>

export function LoginPage() {
  const auth = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(mode === 'reset' ? schema.pick({ email: true }).extend({ password: z.string().optional() }) as never : schema) })

  const submit = form.handleSubmit(async (v) => {
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signin') await auth.signIn(v.email, v.password)
      else if (mode === 'signup') {
        const r = await auth.signUp(v.email, v.password)
        if (r.needsConfirmation) setNotice('Check your email for a confirmation link, then sign in.')
      } else {
        await auth.sendReset(v.email)
        setNotice('If that email has an account, a reset link is on its way.')
      }
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-fg">
            <CalendarCheck2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold leading-tight">Life Planner</p>
            <p className="text-sm text-muted">Your day, goals and habits in one place.</p>
          </div>
        </div>
        <h1 className="mb-4 text-xl font-semibold">{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password'}</h1>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          {mode !== 'reset' && (
            <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} {...form.register('password')} />
            </Field>
          )}
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          {notice && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm" role="status">{notice}</p>}
          <Button type="submit" loading={form.formState.isSubmitting}>
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
          {mode === 'signin' ? (
            <>
              <button className="text-accent hover:underline" onClick={() => setMode('signup')}>Create an account</button>
              <button className="text-muted hover:text-fg" onClick={() => setMode('reset')}>Forgot password?</button>
            </>
          ) : (
            <button className="text-accent hover:underline" onClick={() => setMode('signin')}>Back to sign in</button>
          )}
        </div>
      </div>
    </main>
  )
}

export function ResetPasswordPage() {
  const auth = useAuth()
  const [pw, setPw] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (pw.length < 8) return setError('Use at least 8 characters.')
          try {
            await auth.updatePassword(pw)
            setDone(true)
          } catch (err) {
            setError(errorMessage(err))
          }
        }}
      >
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <Field label="New password" htmlFor="newpw" error={error ?? undefined}>
          <Input id="newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {done ? <p className="text-sm text-success">Password updated. <a className="underline" href="/">Continue</a></p> : <Button type="submit">Update password</Button>}
      </form>
    </main>
  )
}
