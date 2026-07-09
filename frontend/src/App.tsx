import { useEffect, useRef, useState, type FormEvent } from 'react'
import PriceChart, { type PricePoint } from './PriceChart'
import AuthPanel, { type User } from './AuthPanel'
import AccountPanel from './AccountPanel'
import Watchlist from './Watchlist'
import Movers from './Movers'
import ConfirmDialog from './ConfirmDialog'

interface Signal {
  verdict: 'no_edge' | 'weak_up' | 'weak_down' | 'lean_up' | 'lean_down'
  label: string
  detail: string
}

interface Explanation {
  feature: string
  impact: number
  scope: 'this_prediction' | 'model_global'
}

interface Prediction {
  ticker: string
  sector: string
  as_of_date: string
  horizon: Horizon
  horizon_label: string
  prediction: 'up' | 'down'
  confidence: number
  probability_up: number
  signal: Signal
  explanation: Explanation[]
  history: PricePoint[]
  forecast: PricePoint[]
  note: string
}

interface ApiError {
  error: string
}

interface TickerEntry {
  symbol: string
  name: string
  sector?: string
}

interface HorizonMetrics {
  baselines: { majority_class_baseline: number }
  selected_model: string
  test_metrics_by_model: Record<string, { accuracy: number; roc_auc: number }>
}

interface Metrics {
  horizons: Record<string, HorizonMetrics>
}

export type Horizon = '1d' | '1w' | '1m'

export const HORIZONS: { key: Horizon; label: string }[] = [
  { key: '1d', label: 'Next day' },
  { key: '1w', label: 'Next week' },
  { key: '1m', label: 'Next month' },
]

const VERDICT_STYLES: Record<Signal['verdict'], string> = {
  no_edge: 'bg-card-2 text-ink',
  weak_up: 'bg-up-bg text-up',
  lean_up: 'bg-up-bg text-up',
  weak_down: 'bg-down-bg text-down',
  lean_down: 'bg-down-bg text-down',
}

const RECENTS_KEY = 'recentTickers'
const MAX_RECENTS = 5

type View = 'search' | 'movers' | 'watchlist' | 'auth' | 'account'

function viewFromHash(): View {
  const h = window.location.hash
  if (h.startsWith('#/movers')) return 'movers'
  if (h.startsWith('#/watchlist')) return 'watchlist'
  if (h.startsWith('#/login')) return 'auth'
  if (h.startsWith('#/account')) return 'account'
  return 'search'
}

const HASH_FOR_VIEW: Record<View, string> = {
  search: '',
  movers: '/movers',
  watchlist: '/watchlist',
  auth: '/login',
  account: '/account',
}

type Theme = 'dark' | 'light'

function loadTheme(): Theme {
  return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function TrendingIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  )
}

function BookmarkIcon({ size = 14, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="pop-in w-full max-w-sm rounded-xl bg-card p-6 shadow-xl shadow-scrim"
      >
        <h2 id="about-title" className="font-semibold text-lg mb-3">About this app</h2>
        <div className="text-sm text-ink-mute space-y-3 leading-relaxed mb-5">
          <p>
            A personal project built to explore machine learning on financial
            data — not a commercial service, and not financial advice.
          </p>
          <p>
            Predictions come from models trained on ~10 years of daily S&amp;P 500
            price history. Live prices, charts, and quotes are fetched from
            Yahoo Finance via{' '}
            <span className="font-mono text-ink">yfinance</span>.
          </p>
          <p>
            Stock direction is close to a coin flip even for good models, so
            treat every prediction as educational, never as a trade signal.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            className="rounded-lg bg-card-2 hover:bg-edge px-4 py-2
                       pointer-coarse:py-3 text-sm font-semibold cursor-pointer
                       transition-colors duration-150"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsMenu({
  user,
  theme,
  onTheme,
  onProfile,
  onLogout,
  onAbout,
}: {
  user: User | null
  theme: Theme
  onTheme: (t: Theme) => void
  onProfile: () => void
  onLogout: () => void
  onAbout: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickAway(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Settings"
        title="Settings"
        className="p-2 pointer-coarse:p-3 rounded-md cursor-pointer
                   bg-card hover:bg-card-2 transition-colors duration-200"
      >
        <GearIcon />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Settings"
          className="pop-in absolute right-0 mt-2 w-64 rounded-xl bg-card
                     shadow-xl shadow-scrim p-2 z-20"
        >
          <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-ink-mute">
            Appearance
          </div>
          <div
            role="group"
            aria-label="Theme"
            className="mx-2 mb-2 grid grid-cols-2 gap-1 rounded-lg bg-card-2 p-1"
          >
            {(
              [
                { key: 'light' as Theme, label: 'Light', icon: <SunIcon /> },
                { key: 'dark' as Theme, label: 'Dark', icon: <MoonIcon /> },
              ]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onTheme(t.key)}
                aria-pressed={theme === t.key}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5
                            pointer-coarse:py-2.5 text-sm font-medium cursor-pointer
                            transition-colors duration-150 ${
                  theme === t.key
                    ? 'bg-card text-ink'
                    : 'text-ink-mute hover:text-ink'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {user && (
            <>
              <div className="my-2" aria-hidden="true" />
              <div className="px-3 py-1.5 text-xs text-ink-mute truncate">
                Signed in as <span className="text-ink font-medium">{user.username}</span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onProfile()
                }}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 pointer-coarse:py-3
                           text-sm text-left cursor-pointer hover:bg-card-2
                           transition-colors duration-150"
              >
                <PersonIcon />
                Profile settings
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onLogout()
                }}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 pointer-coarse:py-3
                           text-sm text-left cursor-pointer text-down hover:bg-down-bg
                           transition-colors duration-150"
              >
                <LogoutIcon />
                Log out
              </button>
            </>
          )}

          <div className="my-2" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onAbout()
            }}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 pointer-coarse:py-3
                       text-sm text-left cursor-pointer hover:bg-card-2
                       transition-colors duration-150"
          >
            <InfoIcon />
            About this app
          </button>
        </div>
      )}
    </div>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z" />
    </svg>
  )
}

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((r) => typeof r === 'string') : []
  } catch {
    return []
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-card p-6">{children}</div>
}

function SkeletonResult() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[62px] rounded-lg bg-card animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-card animate-pulse motion-reduce:animate-none" />
      <div className="h-56 rounded-2xl bg-card animate-pulse motion-reduce:animate-none" />
    </div>
  )
}

function StatsRow({ history }: { history: PricePoint[] }) {
  if (history.length < 2) return null
  const closes = history.map((p) => p.close)
  const last = closes[closes.length - 1]
  const prev = closes[closes.length - 2]
  const hi = Math.max(...closes)
  const lo = Math.min(...closes)
  const dayChange = ((last - prev) / prev) * 100
  const offHigh = ((last - hi) / hi) * 100
  const stats = [
    {
      label: 'Day change',
      value: `${dayChange >= 0 ? '+' : ''}${dayChange.toFixed(2)}%`,
      tone: dayChange >= 0 ? 'text-up' : 'text-down',
    },
    { label: '52-wk high', value: `$${hi.toFixed(2)}`, tone: 'text-ink' },
    { label: '52-wk low', value: `$${lo.toFixed(2)}`, tone: 'text-ink' },
    { label: 'Off high', value: `${offHigh.toFixed(1)}%`, tone: 'text-ink' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg bg-card px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">{s.label}</div>
          <div className={`font-mono tabular-nums text-sm font-semibold ${s.tone}`}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}

function ExplanationCard({ explanation }: { explanation: Explanation[] }) {
  if (explanation.length === 0) return null
  const maxAbs = Math.max(...explanation.map((e) => Math.abs(e.impact)), 1e-9)
  const isGlobal = explanation[0].scope === 'model_global'
  return (
    <Card>
      <h2 className="font-semibold mb-1">Why this prediction</h2>
      <p className="text-xs text-ink-mute mb-4">
        {isGlobal
          ? 'The signals this model weighs most heavily overall (global importances).'
          : 'The signals that pushed this specific prediction up or down the most.'}
      </p>
      <ul className="space-y-2.5">
        {explanation.map((e) => {
          const positive = e.impact >= 0
          const width = Math.max((Math.abs(e.impact) / maxAbs) * 100, 4)
          return (
            <li key={e.feature} className="flex items-center gap-3">
              <span className="w-32 sm:w-44 shrink-0 text-sm text-ink-mute">{e.feature}</span>
              <div className="flex-1 h-4 flex items-center">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${width}%`,
                    backgroundColor: isGlobal ? 'var(--color-ink-mute)' : positive ? 'var(--color-up-deep)' : 'var(--color-down-deep)',
                  }}
                />
              </div>
              {!isGlobal && (
                <span className={`w-16 sm:w-20 shrink-0 text-right text-xs font-medium ${positive ? 'text-up' : 'text-down'}`}>
                  {positive ? 'toward up' : 'toward down'}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function AccuracyCard({ metrics, horizon }: { metrics: Metrics | null; horizon: Horizon }) {
  const h = metrics?.horizons?.[horizon]
  if (!h) return null
  const model = h.test_metrics_by_model[h.selected_model]
  if (!model) return null
  const baseline = h.baselines.majority_class_baseline
  const edge = model.accuracy - baseline
  return (
    <Card>
      <h2 className="font-semibold mb-1">How accurate is this, really?</h2>
      <p className="text-xs text-ink-mute mb-4 leading-relaxed">
        Measured once on ~2 years of held-out data the model never saw. The
        baseline just always predicts the more common direction.
      </p>
      <div className="flex gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">Model</div>
          <div className="font-mono tabular-nums text-lg font-semibold">
            {(model.accuracy * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">Naive baseline</div>
          <div className="font-mono tabular-nums text-lg font-semibold">
            {(baseline * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">Real edge</div>
          <div
            className={`font-mono tabular-nums text-lg font-semibold ${
              edge > 0.005 ? 'text-up' : 'text-ink-mute'
            }`}
          >
            {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}pp
          </div>
        </div>
      </div>
    </Card>
  )
}

function App() {
  const [ticker, setTicker] = useState('')
  const [horizon, setHorizon] = useState<Horizon>('1d')
  const [result, setResult] = useState<Prediction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [allTickers, setAllTickers] = useState<TickerEntry[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>(viewFromHash)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    fetch('/api/tickers')
      .then((r) => r.json())
      .then((d) => Array.isArray(d.tickers) && setAllTickers(d.tickers))
      .catch(() => {}) // dropdown list is optional; typing still works
    fetch('/api/metrics')
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {})
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => {})
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Saved-symbol set drives the Save/Saved toggle on search results.
  useEffect(() => {
    if (!user) {
      setSaved(new Set())
      return
    }
    fetch('/api/watchlist/symbols')
      .then((r) => r.json())
      .then((d) => Array.isArray(d.symbols) && setSaved(new Set<string>(d.symbols)))
      .catch(() => {})
  }, [user])

  function go(v: View) {
    window.location.hash = HASH_FOR_VIEW[v]
  }

  async function toggleSave(symbol: string) {
    if (!user) {
      go('auth')
      return
    }
    const isSaved = saved.has(symbol)
    const res = isSaved
      ? await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
      : await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol }),
        })
    if (res.ok || res.status === 409 || res.status === 404) {
      setSaved((prev) => {
        const next = new Set(prev)
        if (isSaved) next.delete(symbol)
        else next.add(symbol)
        return next
      })
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})
    setUser(null)
    // Back to a clean home screen — don't leave the previous session's
    // search result (and its Save state) on display.
    setResult(null)
    setError(null)
    setTicker('')
    go('search')
  }

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  const query = ticker.trim().toUpperCase()
  const matches = query ? allTickers.filter((t) => t.symbol.startsWith(query)) : allTickers
  const recentEntries = query
    ? []
    : recents.map((s) => allTickers.find((t) => t.symbol === s) ?? { symbol: s, name: '' })

  // Flat option list backing the combobox's keyboard navigation; ids feed
  // aria-activedescendant. Recents render first, then the S&P matches.
  const options = [
    ...recentEntries.map((t) => ({ ...t, id: `ticker-opt-recent-${t.symbol}` })),
    ...matches.map((t) => ({ ...t, id: `ticker-opt-${t.symbol}` })),
  ]

  function moveActive(delta: number) {
    if (options.length === 0) return
    setOpen(true)
    const next =
      activeIdx < 0
        ? delta > 0
          ? 0
          : options.length - 1
        : (activeIdx + delta + options.length) % options.length
    setActiveIdx(next)
    document.getElementById(options[next].id)?.scrollIntoView({ block: 'nearest' })
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      if (open && activeIdx >= 0 && options[activeIdx]) {
        e.preventDefault()
        void search(options[activeIdx].symbol)
      }
      // otherwise fall through to the form submit with the typed text
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIdx(-1)
    }
  }

  async function search(symbol: string, h: Horizon = horizon) {
    const s = symbol.trim().toUpperCase()
    if (!s) return

    setOpen(false)
    setActiveIdx(-1)
    setTicker(s)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/predict?ticker=${encodeURIComponent(s)}&horizon=${h}`)
      const data: Prediction | ApiError = await res.json()
      if (!res.ok) {
        setError('error' in data ? data.error : 'Something went wrong.')
        setResult(null)
      } else {
        setResult(data as Prediction)
        const next = [s, ...recents.filter((r) => r !== s)].slice(0, MAX_RECENTS)
        setRecents(next)
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
      }
    } catch {
      setError('Could not reach the API. Is the Flask server running?')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void search(ticker)
  }

  function pickHorizon(h: Horizon) {
    setHorizon(h)
    if (result) void search(result.ticker, h)
  }

  // Watchlist/account need a login; a logged-in user never needs the auth view.
  const effectiveView: View =
    view === 'auth' && user
      ? 'account'
      : (view === 'watchlist' || view === 'account') && !user && authChecked
        ? 'auth'
        : view

  return (
    <div className="min-h-dvh bg-surface text-ink flex flex-col items-center px-4 py-14
                    transition-colors duration-300 motion-reduce:transition-none">
      <main className="w-full max-w-xl">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">Stock Movement Predictor</h1>
        </div>
        <p className="text-ink-mute mb-5">
          Search a ticker for a model-driven direction prediction.
        </p>

        <nav aria-label="Main" className="flex items-center gap-1.5 mb-6 pb-3">
          <button
            type="button"
            onClick={() => go('search')}
            aria-current={effectiveView === 'search' ? 'page' : undefined}
            aria-label="Search"
            title="Search"
            className={`p-2 pointer-coarse:p-3 rounded-md cursor-pointer
                        transition-colors duration-200 ${
              effectiveView === 'search'
                ? 'bg-card-2 text-ink'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            <SearchIcon size={18} />
          </button>
          <button
            type="button"
            onClick={() => go('movers')}
            aria-current={effectiveView === 'movers' ? 'page' : undefined}
            aria-label="Stocks to watch"
            title="Stocks to watch"
            className={`p-2 pointer-coarse:p-3 rounded-md cursor-pointer
                        transition-colors duration-200 ${
              effectiveView === 'movers'
                ? 'bg-card-2 text-ink'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            <TrendingIcon size={18} />
          </button>
          <button
            type="button"
            onClick={() => go('watchlist')}
            aria-current={effectiveView === 'watchlist' ? 'page' : undefined}
            aria-label={`My watchlist${saved.size > 0 ? `, ${saved.size} saved` : ''}`}
            title="My watchlist"
            className={`relative p-2 pointer-coarse:p-3 rounded-md cursor-pointer
                        transition-colors duration-200 ${
              effectiveView === 'watchlist'
                ? 'bg-card-2 text-ink'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            <BookmarkIcon size={18} filled={effectiveView === 'watchlist'} />
            {saved.size > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-accent
                           text-on-accent text-[10px] font-semibold flex items-center justify-center"
              >
                {saved.size}
              </span>
            )}
          </button>
          <span className="flex-1" />
          {!user && (
            <button
              type="button"
              onClick={() => go('auth')}
              className="px-3 py-1.5 pointer-coarse:py-3 rounded-md text-sm font-medium cursor-pointer
                         bg-card hover:bg-card-2 transition-colors duration-200"
            >
              Log in
            </button>
          )}
          <SettingsMenu
            user={user}
            theme={theme}
            onTheme={setTheme}
            onProfile={() => go('account')}
            onLogout={() => setConfirmLogout(true)}
            onAbout={() => setAboutOpen(true)}
          />
        </nav>

        {effectiveView === 'auth' && (
          <AuthPanel
            onAuthed={(u) => {
              setUser(u)
              go('watchlist')
            }}
          />
        )}

        {effectiveView === 'account' && user && <AccountPanel user={user} />}

        {effectiveView === 'movers' && (
          <Movers
            onOpen={(symbol) => {
              go('search')
              void search(symbol)
            }}
            saved={saved}
            loggedIn={!!user}
            onToggleSave={(symbol) => void toggleSave(symbol)}
          />
        )}

        {effectiveView === 'watchlist' && user && (
          <Watchlist
            key={user.username}
            onOpen={(symbol) => {
              go('search')
              void search(symbol)
            }}
            onChanged={(symbol, isSaved) =>
              setSaved((prev) => {
                const next = new Set(prev)
                if (isSaved) next.add(symbol)
                else next.delete(symbol)
                return next
              })
            }
          />
        )}

        <div hidden={effectiveView !== 'search'}>
        <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
          <div className="relative flex-1" ref={boxRef}>
            <input
              type="text"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase())
                setOpen(true)
                setActiveIdx(-1)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onInputKeyDown}
              maxLength={11}
              placeholder="e.g. AAPL"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="search"
              role="combobox"
              aria-label="Ticker symbol"
              aria-expanded={open}
              aria-controls="ticker-listbox"
              aria-autocomplete="list"
              aria-activedescendant={
                open && activeIdx >= 0 && options[activeIdx] ? options[activeIdx].id : undefined
              }
              className="w-full rounded-lg bg-card-2 px-4 py-2.5
                         text-lg font-mono tracking-wide placeholder:text-ink-faint
                         focus:outline-none focus:ring-2 focus:ring-accent/70
                         transition-colors duration-200"
            />

            {open && (recentEntries.length > 0 || matches.length > 0) && (
              <ul
                id="ticker-listbox"
                role="listbox"
                // Chromium makes scrollable regions tabbable; keyboard access
                // goes through the combobox (aria-activedescendant), not Tab.
                tabIndex={-1}
                className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg
                           bg-card shadow-xl shadow-black/50"
              >
                {recentEntries.length > 0 && (
                  <li className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-ink-mute">
                    Recent
                  </li>
                )}
                {recentEntries.map((t, i) => (
                  <li
                    key={`recent-${t.symbol}`}
                    id={`ticker-opt-recent-${t.symbol}`}
                    role="option"
                    aria-selected={i === activeIdx}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => void search(t.symbol)}
                      className={`w-full text-left px-4 py-2 pointer-coarse:py-3 hover:bg-card-2 cursor-pointer
                                 transition-colors duration-150 flex items-center gap-3 ${
                                   i === activeIdx ? 'bg-card-2' : ''
                                 }`}
                    >
                      <span className="font-mono shrink-0">{t.symbol}</span>
                      <span className="text-ink-mute text-sm truncate flex-1 min-w-0">{t.name}</span>
                      {t.sector && (
                        <span className="text-[11px] rounded-full bg-card-2 px-2 py-0.5 text-ink-mute shrink-0">
                          {t.sector}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {recentEntries.length > 0 && matches.length > 0 && (
                  <li className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-ink-mute">
                    S&amp;P 500
                  </li>
                )}
                {matches.map((t, i) => {
                  const idx = recentEntries.length + i
                  return (
                    <li
                      key={t.symbol}
                      id={`ticker-opt-${t.symbol}`}
                      role="option"
                      aria-selected={idx === activeIdx}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => void search(t.symbol)}
                        className={`w-full text-left px-4 py-2 pointer-coarse:py-3 hover:bg-card-2 cursor-pointer
                                   transition-colors duration-150 flex items-center gap-3 ${
                                     idx === activeIdx ? 'bg-card-2' : ''
                                   }`}
                      >
                        <span className="font-mono shrink-0">{t.symbol}</span>
                        <span className="text-ink-mute text-sm truncate flex-1 min-w-0">{t.name}</span>
                        {t.sector && (
                          <span className="text-[11px] rounded-full bg-card-2 px-2 py-0.5 text-ink-mute shrink-0">
                            {t.sector}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
                {query && matches.length === 0 && (
                  <li className="px-4 py-2.5 text-sm text-ink-mute">
                    Not in the S&amp;P 500 list — press Search to look it up anyway.
                  </li>
                )}
              </ul>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-label={loading ? 'Searching…' : 'Search'}
            title="Search"
            className="rounded-lg bg-accent hover:bg-accent-hi disabled:opacity-50
                       disabled:cursor-not-allowed cursor-pointer px-4 py-2.5
                       text-on-accent transition-colors duration-200"
          >
            <span className={loading ? 'block animate-pulse motion-reduce:animate-none' : 'block'}>
              <SearchIcon size={18} />
            </span>
          </button>
        </form>

        <div className="flex items-center gap-1 mb-6" role="group" aria-label="Prediction horizon">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => pickHorizon(h.key)}
              aria-pressed={horizon === h.key}
              className={`px-3 py-1.5 pointer-coarse:py-3 pointer-coarse:px-4 rounded-md text-sm font-medium cursor-pointer
                          transition-colors duration-200 ${
                horizon === h.key
                  ? 'bg-card-2 text-ink'
                  : 'text-ink-mute hover:text-ink'
              }`}
            >
              {h.label}
            </button>
          ))}
          {result && (
            <button
              type="button"
              onClick={() => void toggleSave(result.ticker)}
              aria-pressed={saved.has(result.ticker)}
              className={`ml-auto flex items-center gap-1.5 rounded-md px-3.5 py-1.5
                          pointer-coarse:py-3 text-sm font-semibold cursor-pointer
                          transition-colors duration-150 ${
                saved.has(result.ticker)
                  ? 'text-accent border border-accent/50 bg-accent/10 hover:bg-accent/20'
                  : 'bg-accent hover:bg-accent-hi text-on-accent'
              }`}
            >
              <StarIcon filled={saved.has(result.ticker)} />
              {saved.has(result.ticker)
                ? `Saved ${result.ticker}`
                : user
                  ? `Save ${result.ticker}`
                  : `Save ${result.ticker} (log in)`}
            </button>
          )}
        </div>

        {/* Screen-reader announcements for async state; visual users get the
            skeleton / result cards below. */}
        <div aria-live="polite" className="sr-only">
          {loading
            ? 'Loading prediction…'
            : result
              ? `Prediction for ${result.ticker}: ${result.prediction}, ${(result.confidence * 100).toFixed(0)} percent confidence.`
              : ''}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-down-bg text-down px-4 py-3 mb-6
                       flex items-center justify-between gap-4"
          >
            <span>{error}</span>
            {ticker.trim() && (
              <button
                type="button"
                onClick={() => void search(ticker)}
                className="shrink-0 rounded-md px-3 py-1.5 pointer-coarse:py-3
                           text-sm font-medium cursor-pointer hover:bg-down-bg
                           transition-colors duration-150"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {loading && !result && <SkeletonResult />}

        {!result && !error && !loading && (
          <div className="rounded-xl bg-card-2 px-6 py-8 text-center">
            <p className="text-sm text-ink-mute mb-4">
              No prediction yet — search a ticker above, or try one of these:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {(recents.length > 0 ? recents : ['AAPL', 'MSFT', 'NVDA', 'QCOM']).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void search(s)}
                  className="rounded-full bg-card px-4 py-1.5 pointer-coarse:py-3
                             font-mono text-sm cursor-pointer hover:bg-card-2
                             transition-colors duration-150"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div
            className={`space-y-4 transition-opacity duration-200 motion-reduce:transition-none ${
              loading ? 'opacity-60' : ''
            }`}
            aria-busy={loading}
          >
            <StatsRow history={result.history} />

            {result.history.length > 1 && (
              <Card>
                <PriceChart
                  data={result.history}
                  forecast={result.forecast ?? []}
                  ticker={result.ticker}
                />
              </Card>
            )}

            <Card>
              <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-mono">{result.ticker}</span>
                  <span className="text-[11px] rounded-full bg-card-2 px-2 py-0.5 text-ink-mute">
                    {result.sector}
                  </span>
                </span>
                <span className="text-sm text-ink-mute shrink-0">
                  {result.horizon_label} · as of {result.as_of_date}
                </span>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`text-4xl font-bold ${
                    result.prediction === 'up' ? 'text-up' : 'text-down'
                  }`}
                >
                  {result.prediction === 'up' ? 'UP' : 'DOWN'}
                </span>
                <span className="text-ink-mute tabular-nums">
                  {(result.confidence * 100).toFixed(1)}% confidence
                </span>
              </div>

              <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(result.probability_up * 100)}
                aria-label="Model probability of an up move"
                className="w-full h-2 rounded-full bg-card-2 overflow-hidden mb-5"
              >
                <div
                  className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${result.probability_up * 100}%` }}
                />
              </div>

              <div className={`rounded-lg px-4 py-3 mb-4 ${VERDICT_STYLES[result.signal.verdict]}`}>
                <div className="font-semibold mb-1">
                  Should you invest? {result.signal.label}
                </div>
                <p className="text-xs opacity-80 leading-relaxed">{result.signal.detail}</p>
              </div>

              <p className="text-xs text-ink-mute leading-relaxed">{result.note}</p>
            </Card>

            <ExplanationCard explanation={result.explanation ?? []} />
            <AccuracyCard metrics={metrics} horizon={result.horizon} />
          </div>
        )}
        </div>

        {confirmLogout && (
          <ConfirmDialog
            title="Log out?"
            onContinue={() => {
              setConfirmLogout(false)
              void logout()
            }}
            onCancel={() => setConfirmLogout(false)}
          >
            You are about to log out
            {user && (
              <>
                {' '}
                of <span className="font-semibold text-ink">{user.username}</span>
              </>
            )}
            . Your watchlist stays saved for when you come back.
          </ConfirmDialog>
        )}

        {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      </main>
    </div>
  )
}

export default App
