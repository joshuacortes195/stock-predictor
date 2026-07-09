import { useState, type FormEvent } from 'react'
import type { User } from './AuthPanel'

interface AccountPanelProps {
  user: User
}

export default function AccountPanel({ user }: AccountPanelProps) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.')
      } else {
        setSuccess(true)
        setCurrentPw('')
        setNewPw('')
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
    <div className="space-y-4 max-w-md mx-auto">
      <div className="rounded-xl bg-card p-6">
        <h2 className="font-semibold text-lg mb-4">Account</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">
              Username
            </div>
            <div className="font-mono text-lg truncate">{user.username}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">
              Login email
            </div>
            <div className="font-mono text-lg truncate">{user.email ?? '—'}</div>
          </div>
        </div>
        <p className="text-xs text-ink-mute mt-3 leading-relaxed">
          {user.email
            ? 'You can log in with either your email or your username.'
            : 'This account predates email login — you sign in with your username.'}
        </p>
      </div>

      <div className="rounded-xl bg-card p-6">
        <h3 className="font-semibold mb-4">Change password</h3>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-down-bg text-down px-4 py-2.5 mb-4 text-sm"
          >
            {error}
          </div>
        )}
        {success && (
          <div
            role="status"
            className="rounded-lg bg-up-bg text-up px-4 py-2.5 mb-4 text-sm"
          >
            Password updated. Use the new one next time you log in.
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="acct-current-pw" className="block text-sm font-medium mb-1.5">
              Current password
            </label>
            <input
              id="acct-current-pw"
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              required
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="acct-new-pw" className="block text-sm font-medium mb-1.5">
              New password
            </label>
            <div className="relative">
              <input
                id="acct-new-pw"
                type={showPw ? 'text' : 'password'}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                aria-describedby="acct-new-pw-help"
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
            <p id="acct-new-pw-help" className="text-xs text-ink-mute mt-1.5">
              At least 8 characters.
            </p>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50
                       disabled:cursor-not-allowed cursor-pointer px-5 py-2.5
                       font-semibold text-on-accent transition-colors duration-200"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
