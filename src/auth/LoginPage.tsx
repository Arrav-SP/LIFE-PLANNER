import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useAuth } from './AuthProvider'
import { errorMessage } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { GoogleSignIn } from './GoogleSignIn'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
})
type Values = z.infer<typeof schema>

/** A password input with a button that shows what was typed. */
const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={shown ? 'text' : 'password'} className="pr-11" />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted hover:text-fg"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  )
})


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
          <Logo className="h-10 w-10" />
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
              <PasswordInput id="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} {...form.register('password')} />
            </Field>
          )}
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          {notice && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm" role="status">{notice}</p>}
          <Button type="submit" loading={form.formState.isSubmitting}>
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
        {mode !== 'reset' && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <GoogleSignIn onError={setError} />
          </>
        )}
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
          <PasswordInput id="newpw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {done ? <p className="text-sm text-success">Password updated. <a className="underline" href="/">Continue</a></p> : <Button type="submit">Update password</Button>}
      </form>
    </main>
  )
}
