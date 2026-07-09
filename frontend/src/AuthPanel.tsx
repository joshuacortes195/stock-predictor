import { useState, type FormEvent } from 'react'

export interface User {
  username: string
  email: string | null
}

interface AuthPanelProps {
  onAuthed: (user: User) => void
}

type Mode = 'login' | 'register'

export default function AuthPanel({ onAuthed }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ username?: string; password?: string }>({})
  const [busy, setBusy] = useState(false)

  function validateUsername() {
    if (username && !/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      setFieldError((f) => ({ ...f, username: '3–32 characters: letters, digits, underscore.' }))
    } else {
      setFieldError((f) => ({ ...f, username: undefined }))
    }
  }

  function validatePassword() {
    if (password && password.length < 8) {
      setFieldError((f) => ({ ...f, password: 'At least 8 characters.' }))
    } else {
      setFieldError((f) => ({ ...f, password: undefined }))
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const payload =
        mode === 'login'
          ? { identifier: username, password }
          : { username, email, password }
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.')
      } else {
        onAuthed({ username: data.username, email: data.email ?? null })
      }
    } catch {
      setError('Could not reach the API. Is the Flask server running?')
    } finally {
      setBusy(false)
    }
  }

  const inputClass = `w-full rounded-lg bg-card-2 px-4 py-2.5
                      placeholder:text-ink-faint focus:outline-none focus:ring-2
                      focus:ring-accent/70 transition-colors duration-200`

  return (
    <div className="rounded-xl bg-card p-6 max-w-md mx-auto">
      <h2 className="font-semibold text-lg mb-1">
        {mode === 'login' ? 'Log in' : 'Create an account'}
      </h2>
      <p className="text-sm text-ink-mute mb-5">
        {mode === 'login'
          ? 'Welcome back — your watchlist is waiting.'
          : 'Save stocks to a personal watchlist that persists between visits.'}
      </p>

      {error && (
        <div role="alert" className="rounded-lg bg-down-bg text-down px-4 py-2.5 mb-4 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && (
          <div>
            <label htmlFor="auth-email" className="block text-sm font-medium mb-1.5">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              required
              className={inputClass}
            />
          </div>
        )}
        <div>
          <label htmlFor="auth-username" className="block text-sm font-medium mb-1.5">
            {mode === 'login' ? 'Username or email' : 'Username'}
          </label>
          <input
            id="auth-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={mode === 'register' ? validateUsername : undefined}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={mode === 'register' ? 32 : 254}
            required
            aria-invalid={!!fieldError.username}
            aria-describedby={fieldError.username ? 'auth-username-err' : undefined}
            className={inputClass}
          />
          {fieldError.username && (
            <p id="auth-username-err" className="text-xs text-down mt-1.5">{fieldError.username}</p>
          )}
        </div>

        <div>
          <label htmlFor="auth-password" className="block text-sm font-medium mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              id="auth-password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={validatePassword}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              maxLength={128}
              required
              aria-invalid={!!fieldError.password}
              aria-describedby="auth-password-help"
              className={`${inputClass} pr-16`}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-pressed={showPw}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium
                         text-ink-mute hover:text-ink px-2 py-1.5 pointer-coarse:py-2.5
                         cursor-pointer rounded transition-colors duration-150"
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <p id="auth-password-help" className="text-xs text-ink-mute mt-1.5">
            {fieldError.password ?? 'At least 8 characters. Stored only as a salted hash.'}
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50
                     disabled:cursor-not-allowed cursor-pointer px-5 py-2.5
                     font-semibold text-on-accent transition-colors duration-200"
        >
          {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>

      <p className="text-sm text-ink-mute mt-4 text-center">
        {mode === 'login' ? 'No account yet?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
          className="text-accent hover:text-accent-hi font-medium cursor-pointer transition-colors duration-150"
        >
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </button>
      </p>
    </div>
  )
}
