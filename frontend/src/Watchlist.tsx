import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

interface Quote {
  last: number
  change_pct: number
}

interface Item {
  symbol: string
  added_at: string
  quote: Quote | null
  sector: string
}

interface Category {
  name: string
  count: number
  pct: number
}

interface WatchlistProps {
  onOpen: (symbol: string) => void
  onChanged: (symbol: string, saved: boolean) => void
}

const PAGE = 10

function RowSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="h-[68px] rounded-lg bg-card animate-pulse motion-reduce:animate-none"
    />
  )
}

function CategoryBreakdown({ categories, total }: { categories: Category[]; total: number }) {
  if (total === 0) return null
  return (
    <div className="rounded-xl bg-card px-4 py-3 mb-4">
      <h3 className="text-xs uppercase tracking-wider text-ink-mute mb-3">
        Categories in your watchlist
      </h3>
      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.name} className="flex items-center gap-3">
            <span className="w-36 sm:w-48 shrink-0 text-sm truncate">{c.name}</span>
            <div className="flex-1 h-2 rounded-full bg-card-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${c.pct}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-xs font-mono tabular-nums text-ink-mute">
              {c.pct}% · {c.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Watchlist({ onOpen, onChanged }: WatchlistProps) {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryTotal, setCategoryTotal] = useState(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const offsetRef = useRef(0)

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist/categories')
      const data = await res.json()
      if (res.ok) {
        setCategories(data.categories)
        setCategoryTotal(data.total)
      }
    } catch {
      // Non-critical widget — the list above still works without it.
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/watchlist?offset=${offsetRef.current}&limit=${PAGE}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not load your watchlist.')
      } else {
        offsetRef.current += data.items.length
        setItems((prev) => [...prev, ...data.items])
        setTotal(data.total)
        setHasMore(data.has_more)
      }
    } catch {
      setError('Could not reach the API.')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMore()
    void loadCategories()
  }, [loadMore, loadCategories])

  // Infinite scroll: when the sentinel below the list enters the viewport,
  // fetch the next page. Recreated after every page render — observe() always
  // reports the current state once, so if the sentinel is still visible after
  // a page lands, the next page loads immediately (an event that fired while
  // a load was already in flight is otherwise swallowed by the guard).
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && void loadMore(),
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [items.length, hasMore, loadMore])

  async function remove(symbol: string) {
    const res = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.symbol !== symbol))
      setTotal((t) => (t === null ? t : t - 1))
      offsetRef.current -= 1
      onChanged(symbol, false)
      void loadCategories()
    }
  }

  if (total === 0) {
    return (
      <div className="rounded-xl bg-card-2 px-6 py-10 text-center">
        <p className="text-sm text-ink-mute">
          Nothing saved yet. Search a ticker and press{' '}
          <span className="text-ink font-medium">Save</span> to start your watchlist.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold">My watchlist</h2>
        {total !== null && (
          <span className="text-xs text-ink-mute tabular-nums">
            {items.length} of {total} shown
          </span>
        )}
      </div>

      <CategoryBreakdown categories={categories} total={categoryTotal} />

      {error && (
        <div role="alert" className="rounded-lg bg-down-bg text-down px-4 py-3 mb-4 text-sm flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="shrink-0 rounded-md px-3 py-1.5 pointer-coarse:py-3
                       text-sm font-medium cursor-pointer hover:bg-down-bg transition-colors duration-150"
          >
            Try again
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.symbol}>
            <div className="rounded-lg bg-card px-4 py-3 flex items-center gap-3
                            hover:bg-card-2 transition-colors duration-150">
              <button
                type="button"
                onClick={() => onOpen(item.symbol)}
                className="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-3"
                aria-label={`Open prediction for ${item.symbol}`}
              >
                <span className="font-mono font-semibold w-20 shrink-0">{item.symbol}</span>
                <span className="text-[11px] rounded-full bg-card-2 px-2 py-0.5 text-ink-mute shrink-0 hidden sm:inline-block">
                  {item.sector}
                </span>
                {item.quote ? (
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono tabular-nums text-sm">
                      ${item.quote.last.toFixed(2)}
                    </span>
                    <span
                      className={`tabular-nums text-xs font-medium ${
                        item.quote.change_pct >= 0 ? 'text-up' : 'text-down'
                      }`}
                    >
                      {item.quote.change_pct >= 0 ? '+' : ''}
                      {item.quote.change_pct.toFixed(2)}%
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint">quote unavailable</span>
                )}
              </button>
              <span className="text-[11px] text-ink-faint hidden sm:block shrink-0">
                added {item.added_at.slice(0, 10)}
              </span>
              <button
                type="button"
                onClick={() => setPendingRemove(item.symbol)}
                aria-label={`Remove ${item.symbol} from watchlist`}
                className="shrink-0 rounded-md p-2 pointer-coarse:p-3 text-ink-mute hover:text-down
                           hover:bg-card-2 cursor-pointer transition-colors duration-150"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </li>
        ))}
        {loading && Array.from({ length: Math.min(PAGE, 3) }, (_, i) => <RowSkeleton key={`s${i}`} />)}
      </ul>

      {/* invisible sentinel that triggers the next page */}
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />

      {!hasMore && items.length > 0 && (
        <p className="text-center text-xs text-ink-faint mt-4">That's everything you've saved.</p>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title="Remove from watchlist?"
          onContinue={() => {
            void remove(pendingRemove)
            setPendingRemove(null)
          }}
          onCancel={() => setPendingRemove(null)}
        >
          You are about to remove{' '}
          <span className="font-mono font-semibold text-ink">{pendingRemove}</span> from your
          watchlist. You can always save it again later.
        </ConfirmDialog>
      )}
    </div>
  )
}
