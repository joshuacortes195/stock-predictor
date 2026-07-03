import { useState, type FormEvent } from 'react'
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
  note: string
}

const VERDICT_STYLES: Record<Signal['verdict'], { badge: string; icon: string }> = {
  no_edge: { badge: 'border-slate-600 bg-slate-800 text-slate-200', icon: '⏸' },
  weak_up: { badge: 'border-emerald-800 bg-emerald-950/60 text-emerald-300', icon: '▲' },
  lean_up: { badge: 'border-emerald-700 bg-emerald-900/60 text-emerald-300', icon: '▲' },
  weak_down: { badge: 'border-rose-800 bg-rose-950/60 text-rose-300', icon: '▼' },
  lean_down: { badge: 'border-rose-700 bg-rose-900/60 text-rose-300', icon: '▼' },
}

interface ApiError {
  error: string
}

function App() {
  const [ticker, setTicker] = useState('AAPL')
  const [result, setResult] = useState<Prediction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!ticker.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/predict?ticker=${encodeURIComponent(ticker.trim())}`)
      const data: Prediction | ApiError = await res.json()
      if (!res.ok) {
        setError('error' in data ? data.error : 'Something went wrong.')
      } else {
        setResult(data as Prediction)
      }
    } catch {
      setError('Could not reach the API. Is the Flask server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Stock Movement Predictor</h1>
        <p className="text-slate-400 mb-8">
          Enter a ticker for a next-day direction prediction.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            maxLength={11}
            placeholder="e.g. AAPL"
            className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-4 py-2.5
                       text-lg font-mono tracking-wide focus:outline-none focus:ring-2
                       focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       disabled:cursor-not-allowed px-5 py-2.5 font-medium transition-colors"
          >
            {loading ? 'Predicting…' : 'Predict'}
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
                <PriceChart data={result.history} ticker={result.ticker} />
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
                  {result.prediction === 'up' ? '▲ UP' : '▼ DOWN'}
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
                className={`rounded-lg border px-4 py-3 mb-4 ${VERDICT_STYLES[result.signal.verdict].badge}`}
              >
                <div className="font-semibold mb-1">
                  {VERDICT_STYLES[result.signal.verdict].icon} Should you invest? {result.signal.label}
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
