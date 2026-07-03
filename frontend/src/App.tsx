import { useEffect, useRef, useState, type FormEvent } from 'react'
import PriceChart, { type PricePoint } from './PriceChart'

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
}

interface HorizonMetrics {
  baselines: { majority_class_baseline: number }
  selected_model: string
  test_metrics_by_model: Record<string, { accuracy: number; roc_auc: number }>
}

interface Metrics {
  horizons: Record<string, HorizonMetrics>
}

type Horizon = '1d' | '1w' | '1m'

const HORIZONS: { key: Horizon; label: string }[] = [
  { key: '1d', label: 'Next day' },
  { key: '1w', label: 'Next week' },
  { key: '1m', label: 'Next month' },
]

const VERDICT_STYLES: Record<Signal['verdict'], string> = {
  no_edge: 'border-edge bg-card-2 text-ink',
  weak_up: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  lean_up: 'border-emerald-700 bg-emerald-900/50 text-emerald-300',
  weak_down: 'border-rose-800 bg-rose-950/50 text-rose-300',
  lean_down: 'border-rose-700 bg-rose-900/50 text-rose-300',
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

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-edge bg-card p-6">{children}</div>
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
        <div key={s.label} className="rounded-lg border border-edge bg-card px-3 py-2.5">
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
              <span className="w-44 shrink-0 text-sm text-ink-mute">{e.feature}</span>
              <div className="flex-1 h-4 flex items-center">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${width}%`,
                    backgroundColor: isGlobal ? '#93a4bc' : positive ? '#059669' : '#f43f5e',
                  }}
                />
              </div>
              {!isGlobal && (
                <span className={`w-20 shrink-0 text-right text-xs font-medium ${positive ? 'text-up' : 'text-down'}`}>
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
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/tickers')
      .then((r) => r.json())
      .then((d) => Array.isArray(d.tickers) && setAllTickers(d.tickers))
      .catch(() => {}) // dropdown list is optional; typing still works
    fetch('/api/metrics')
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {})
  }, [])

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

  async function search(symbol: string, h: Horizon = horizon) {
    const s = symbol.trim().toUpperCase()
    if (!s) return

    setOpen(false)
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

  return (
    <div className="min-h-dvh bg-surface text-ink flex flex-col items-center px-4 py-14">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gold" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">Stock Movement Predictor</h1>
        </div>
        <p className="text-ink-mute mb-8">
          Search a ticker for a model-driven direction prediction.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
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
              className="w-full rounded-lg bg-card border border-edge px-4 py-2.5
                         text-lg font-mono tracking-wide placeholder:text-ink-faint
                         focus:outline-none focus:ring-2 focus:ring-gold/70 focus:border-gold/50
                         transition-colors duration-200"
            />

            {open && (recentEntries.length > 0 || matches.length > 0) && (
              <ul
                id="ticker-listbox"
                role="listbox"
                className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg
                           border border-edge bg-card shadow-xl shadow-black/50"
              >
                {recentEntries.length > 0 && (
                  <li className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-ink-mute">
                    Recent
                  </li>
                )}
                {recentEntries.map((t) => (
                  <li key={`recent-${t.symbol}`} role="option" aria-selected="false">
                    <button
                      type="button"
                      onClick={() => void search(t.symbol)}
                      className="w-full text-left px-4 py-2 hover:bg-card-2 cursor-pointer
                                 transition-colors duration-150 flex justify-between gap-3"
                    >
                      <span className="font-mono">{t.symbol}</span>
                      <span className="text-ink-mute text-sm truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
                {recentEntries.length > 0 && matches.length > 0 && (
                  <li className="px-4 pt-2.5 pb-1 text-[11px] uppercase tracking-wider text-ink-mute border-t border-edge">
                    S&amp;P 500
                  </li>
                )}
                {matches.map((t) => (
                  <li key={t.symbol} role="option" aria-selected="false">
                    <button
                      type="button"
                      onClick={() => void search(t.symbol)}
                      className="w-full text-left px-4 py-2 hover:bg-card-2 cursor-pointer
                                 transition-colors duration-150 flex justify-between gap-3"
                    >
                      <span className="font-mono">{t.symbol}</span>
                      <span className="text-ink-mute text-sm truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
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
            className="rounded-lg bg-gold hover:bg-gold-hi disabled:opacity-50
                       disabled:cursor-not-allowed cursor-pointer px-5 py-2.5
                       font-semibold text-surface transition-colors duration-200"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="flex gap-1 mb-6" role="group" aria-label="Prediction horizon">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => pickHorizon(h.key)}
              aria-pressed={horizon === h.key}
              className={`px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer
                          transition-colors duration-200 ${
                horizon === h.key
                  ? 'bg-card-2 text-ink border border-edge'
                  : 'text-ink-mute hover:text-ink border border-transparent'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-800 bg-rose-950/50 text-rose-300 px-4 py-3 mb-6">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
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
              <div className="flex items-baseline justify-between mb-4">
                <span className="text-xl font-mono">{result.ticker}</span>
                <span className="text-sm text-ink-mute">
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

              <div className="w-full h-2 rounded-full bg-card-2 overflow-hidden mb-5">
                <div
                  className="h-full bg-gold transition-[width] duration-300"
                  style={{ width: `${result.probability_up * 100}%` }}
                />
              </div>

              <div className={`rounded-lg border px-4 py-3 mb-4 ${VERDICT_STYLES[result.signal.verdict]}`}>
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
    </div>
  )
}

export default App
