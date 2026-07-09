import { useEffect, useState } from 'react'
import { HORIZONS, type Horizon } from './App'

interface Signal {
  verdict: 'no_edge' | 'weak_up' | 'lean_up'
  label: string
  detail: string
}

interface Mover {
  ticker: string
  sector: string
  prediction: 'up'
  probability_up: number
  confidence: number
  signal: Signal
}

interface MoversResponse {
  horizon: Horizon
  horizon_label: string
  movers: Mover[]
  updated_seconds_ago: number
}

interface MoversProps {
  onOpen: (symbol: string) => void
  saved: Set<string>
  loggedIn: boolean
  onToggleSave: (symbol: string) => void
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

function RowSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="h-[68px] rounded-lg bg-card animate-pulse motion-reduce:animate-none"
    />
  )
}

function formatUpdated(seconds: number): string {
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  return `${minutes} min${minutes === 1 ? '' : 's'} ago`
}

export default function Movers({ onOpen, saved, loggedIn, onToggleSave }: MoversProps) {
  const [horizon, setHorizon] = useState<Horizon>('1d')
  const [data, setData] = useState<MoversResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/movers?horizon=${horizon}`)
      .then((r) => r.json())
      .then((d: MoversResponse) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the API.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [horizon])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h2 className="font-semibold">Top 5 stocks to watch</h2>
        {data && (
          <span className="text-xs text-ink-mute tabular-nums shrink-0">
            updated {formatUpdated(data.updated_seconds_ago)}
          </span>
        )}
      </div>
      <p className="text-sm text-ink-mute mb-4">
        The model's 5 most bullish calls for the {data?.horizon_label ?? 'selected'} horizon, out
        of a curated cross-sector watchlist — not the whole market.
      </p>

      <div className="flex items-center gap-1 mb-4" role="group" aria-label="Prediction horizon">
        {HORIZONS.map((h) => (
          <button
            key={h.key}
            type="button"
            onClick={() => setHorizon(h.key)}
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
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-down-bg text-down px-4 py-3 mb-4 text-sm
                     flex items-center justify-between gap-4"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setHorizon((h) => h)}
            className="shrink-0 rounded-md px-3 py-1.5 pointer-coarse:py-3
                       text-sm font-medium cursor-pointer hover:bg-down-bg transition-colors duration-150"
          >
            Try again
          </button>
        </div>
      )}

      {!error && !loading && data && data.movers.length === 0 && (
        <div className="rounded-xl bg-card-2 px-6 py-8 text-center">
          <p className="text-sm text-ink-mute">
            Nothing in the watch universe is leaning up for this horizon right now.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {!loading &&
          data?.movers.map((m, i) => (
            <li key={m.ticker}>
              <div
                className="rounded-lg bg-card px-4 py-3 flex items-center gap-3
                           hover:bg-card-2 transition-colors duration-150"
              >
                <span className="w-5 shrink-0 text-xs text-ink-faint tabular-nums">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => onOpen(m.ticker)}
                  className="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-3 flex-wrap"
                  aria-label={`Open prediction for ${m.ticker}`}
                >
                  <span className="font-mono font-semibold shrink-0">{m.ticker}</span>
                  <span className="text-[11px] rounded-full bg-card-2 px-2 py-0.5 text-ink-mute shrink-0">
                    {m.sector}
                  </span>
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-up text-xs font-bold">UP</span>
                    <span className="font-mono tabular-nums text-xs text-ink-mute">
                      {(m.confidence * 100).toFixed(1)}% confidence
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleSave(m.ticker)}
                  aria-pressed={saved.has(m.ticker)}
                  aria-label={saved.has(m.ticker) ? `Remove ${m.ticker} from watchlist` : `Save ${m.ticker}${loggedIn ? '' : ' (log in)'}`}
                  title={saved.has(m.ticker) ? 'Saved' : 'Save'}
                  className={`shrink-0 rounded-md p-2 pointer-coarse:p-3 cursor-pointer transition-colors duration-150 ${
                    saved.has(m.ticker)
                      ? 'text-accent hover:bg-accent/10'
                      : 'text-ink-mute hover:text-accent hover:bg-card-2'
                  }`}
                >
                  <StarIcon filled={saved.has(m.ticker)} />
                </button>
              </div>
            </li>
          ))}
        {loading && Array.from({ length: 5 }, (_, i) => <RowSkeleton key={`s${i}`} />)}
      </ul>
    </div>
  )
}
