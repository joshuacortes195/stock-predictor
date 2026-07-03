import { useEffect, useRef, useState, type FormEvent } from 'react'
import PriceChart, { type PricePoint } from './PriceChart'

interface Signal {
  verdict: 'no_edge' | 'weak_up' | 'weak_down' | 'lean_up' | 'lean_down'
  label: string
  detail: string
}

interface Prediction {
  ticker: string
  as_of_date: string
  prediction: 'up' | 'down'
  confidence: number
  probability_up: number
  signal: Signal
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
}

const VERDICT_STYLES: Record<Signal['verdict'], string> = {
  no_edge: 'border-slate-600 bg-slate-800 text-slate-200',
  weak_up: 'border-emerald-800 bg-emerald-950/60 text-emerald-300',
  lean_up: 'border-emerald-700 bg-emerald-900/60 text-emerald-300',
  weak_down: 'border-rose-800 bg-rose-950/60 text-rose-300',
  lean_down: 'border-rose-700 bg-rose-900/60 text-rose-300',
}

const RECENTS_KEY = 'recentTickers'
const MAX_RECENTS = 5

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((r) => typeof r === 'string') : []
  } catch {
    return []
  }
}

function App() {
  const [ticker, setTicker] = useState('')
  const [result, setResult] = useState<Prediction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [allTickers, setAllTickers] = useState<TickerEntry[]>([])
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/tickers')
      .then((r) => r.json())
      .then((d) => Array.isArray(d.tickers) && setAllTickers(d.tickers))
      .catch(() => {}) // dropdown list is optional; typing still works
  }, [])

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  const query = ticker.trim().toUpperCase()
  const matches = query
    ? allTickers.filter((t) => t.symbol.startsWith(query))
    : allTickers
  const recentEntries = query
    ? []
    : recents.map((s) => allTickers.find((t) => t.symbol === s) ?? { symbol: s, name: '' })

  async function search(symbol: string) {
    const s = symbol.trim().toUpperCase()
    if (!s) return

    setOpen(false)
    setTicker(s)
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/predict?ticker=${encodeURIComponent(s)}`)
      const data: Prediction | ApiError = await res.json()
      if (!res.ok) {
        setError('error' in data ? data.error : 'Something went wrong.')
      } else {
        setResult(data as Prediction)
        const next = [s, ...recents.filter((r) => r !== s)].slice(0, MAX_RECENTS)
        setRecents(next)
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
      }
    } catch {
      setError('Could not reach the API. Is the Flask server running?')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void search(ticker)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Stock Movement Predictor</h1>
        <p className="text-slate-400 mb-8">
          Search a ticker for a next-day direction prediction.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
          <div className="relative flex-1" ref={boxRef}>
            <input
              type="text"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase())
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              maxLength={11}
              placeholder="e.g. AAPL"
              role="combobox"
              aria-expanded={open}
              aria-controls="ticker-listbox"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-2.5
                         text-lg font-mono tracking-wide focus:outline-none focus:ring-2
                         focus:ring-indigo-500"
            />

            {open && (recentEntries.length > 0 || matches.length > 0) && (
              <ul
                id="ticker-listbox"
                role="listbox"
                className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg
                           border border-slate-700 bg-slate-900 shadow-xl shadow-black/40"
              >
                {recentEntries.length > 0 && (
                  <li className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-slate-500">
                    Recent
                  </li>
                )}
                {recentEntries.map((t) => (
                  <li key={`recent-${t.symbol}`} role="option" aria-selected="false">
                    <button
                      type="button"
                      onClick={() => void search(t.symbol)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-800 flex justify-between gap-3"
                    >
                      <span className="font-mono">{t.symbol}</span>
                      <span className="text-slate-500 text-sm truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
                {recentEntries.length > 0 && matches.length > 0 && (
                  <li className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-slate-500 border-t border-slate-800">
                    S&amp;P 500
                  </li>
                )}
                {matches.map((t) => (
                  <li key={t.symbol} role="option" aria-selected="false">
                    <button
                      type="button"
                      onClick={() => void search(t.symbol)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-800 flex justify-between gap-3"
                    >
                      <span className="font-mono">{t.symbol}</span>
                      <span className="text-slate-500 text-sm truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
                {query && matches.length === 0 && (
                  <li className="px-4 py-2.5 text-sm text-slate-500">
                    Not in the S&amp;P 500 list — press Search to look it up anyway.
                  </li>
                )}
              </ul>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       disabled:cursor-not-allowed px-5 py-2.5 font-medium transition-colors"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 text-red-300 px-4 py-3 mb-6">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {result.history.length > 1 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                <PriceChart
                  data={result.history}
                  forecast={result.forecast ?? []}
                  ticker={result.ticker}
                />
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-baseline justify-between mb-4">
                <span className="text-xl font-mono">{result.ticker}</span>
                <span className="text-sm text-slate-500">as of {result.as_of_date}</span>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`text-4xl font-bold ${
                    result.prediction === 'up' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {result.prediction === 'up' ? 'UP' : 'DOWN'}
                </span>
                <span className="text-slate-400">
                  {(result.confidence * 100).toFixed(1)}% confidence
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden mb-5">
                <div
                  className="h-full bg-indigo-500"
                  style={{ width: `${result.probability_up * 100}%` }}
                />
              </div>

              <div
                className={`rounded-lg border px-4 py-3 mb-4 ${VERDICT_STYLES[result.signal.verdict]}`}
              >
                <div className="font-semibold mb-1">
                  Should you invest? {result.signal.label}
                </div>
                <p className="text-xs opacity-80 leading-relaxed">{result.signal.detail}</p>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">{result.note}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
