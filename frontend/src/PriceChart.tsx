import { useMemo, useRef, useState } from 'react'

export interface PricePoint {
  date: string
  close: number
}

interface PriceChartProps {
  data: PricePoint[]
  forecast: PricePoint[]
  ticker: string
}

const WIDTH = 640
const HEIGHT = 220
const PAD_TOP = 12
const PAD_BOTTOM = 22
const PAD_LEFT = 8
const PAD_RIGHT = 64

// Polarity colors validated for the dark card surface (dataviz six-checks
// pass); direction is never color-alone — the header shows a signed %.
const UP = '#059669'
const DOWN = '#f43f5e'
const FORECAST = '#f8fafc'
const GRID = '#252e48'
const AXIS_TEXT = '#93a4bc'
const CARD = '#151b2c'

const RANGES = [
  { key: '1M', points: 21 },
  { key: '3M', points: 63 },
  { key: '6M', points: 126 },
  { key: '1Y', points: 252 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PriceChart({ data, forecast, ticker }: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [range, setRange] = useState<RangeKey>('6M')

  const shown = useMemo(() => {
    const n = RANGES.find((r) => r.key === range)?.points ?? 126
    return data.slice(-n)
  }, [data, range])

  // One combined series for geometry and hover; `projected` marks the tail.
  const points = useMemo(
    () => [
      ...shown.map((p) => ({ ...p, projected: false })),
      ...forecast.map((p) => ({ ...p, projected: true })),
    ],
    [shown, forecast],
  )

  const geom = useMemo(() => {
    const closes = points.map((p) => p.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM
    const x = (i: number) => PAD_LEFT + (i / Math.max(points.length - 1, 1)) * innerW
    const y = (c: number) => PAD_TOP + (1 - (c - min) / span) * innerH
    const seg = (pts: { close: number }[], offset: number) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(offset + i).toFixed(2)},${y(p.close).toFixed(2)}`).join('')
    const line = seg(shown, 0)
    const lastActualIdx = shown.length - 1
    const forecastLine =
      shown.length > 0 ? seg([shown[lastActualIdx], ...forecast], lastActualIdx) : ''
    const area = `${line}L${x(lastActualIdx).toFixed(2)},${HEIGHT - PAD_BOTTOM}L${PAD_LEFT},${HEIGHT - PAD_BOTTOM}Z`
    return { min, max, x, y, line, forecastLine, area }
  }, [points, shown, forecast])

  if (shown.length < 2) return null

  const first = shown[0].close
  const last = shown[shown.length - 1].close
  const change = last - first
  const changePct = (change / first) * 100
  const color = change >= 0 ? UP : DOWN

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH
    const frac = (px - PAD_LEFT) / (WIDTH - PAD_LEFT - PAD_RIGHT)
    const idx = Math.round(frac * (points.length - 1))
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)))
  }

  const hover = hoverIdx !== null ? points[hoverIdx] : null
  const hoverX = hoverIdx !== null ? geom.x(hoverIdx) : 0
  const hoverY = hover ? geom.y(hover.close) : 0
  const tooltipOnLeft = hoverX > WIDTH * 0.58

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <span className="text-2xl font-semibold font-mono tabular-nums">${last.toFixed(2)}</span>
          <span
            className="ml-2 text-sm font-medium tabular-nums"
            style={{ color: change >= 0 ? '#34d399' : '#fb7185' }}
          >
            {change >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
        <span className="text-xs text-ink-mute">{ticker} · past {range}</span>
      </div>

      <div className="flex gap-1 mb-3" role="group" aria-label="Chart range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setRange(r.key)
              setHoverIdx(null)
            }}
            aria-pressed={range === r.key}
            className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors duration-200 ${
              range === r.key
                ? 'bg-card-2 text-ink border border-edge'
                : 'text-ink-mute hover:text-ink border border-transparent'
            }`}
          >
            {r.key}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${ticker} closing price over the past ${range} with a short model-projected continuation`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* recessive min/max gridlines + right-edge price labels */}
        {[geom.max, geom.min].map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT}
              y1={geom.y(v)} y2={geom.y(v)}
              stroke={GRID} strokeWidth="1"
            />
            <text
              x={WIDTH - PAD_RIGHT + 8} y={geom.y(v) + 3.5}
              fill={AXIS_TEXT} fontSize="11" fontFamily="ui-monospace, monospace"
            >
              ${v.toFixed(2)}
            </text>
          </g>
        ))}

        <path d={geom.area} fill="url(#area-fill)" />
        <path d={geom.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <path
          d={geom.forecastLine}
          fill="none" stroke={FORECAST} strokeWidth="2"
          strokeDasharray="5 4" strokeLinejoin="round"
        />

        {/* first/last date labels, recessive */}
        <text x={PAD_LEFT} y={HEIGHT - 6} fill={AXIS_TEXT} fontSize="11">
          {formatDate(points[0].date)}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 6} fill={AXIS_TEXT} fontSize="11" textAnchor="end">
          {formatDate(points[points.length - 1].date)}
        </text>

        {hover && (
          <g>
            <line
              x1={hoverX} x2={hoverX}
              y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM}
              stroke="#475569" strokeWidth="1" strokeDasharray="3 3"
            />
            {/* 2px surface ring so the marker reads against the line */}
            <circle cx={hoverX} cy={hoverY} r="5.5" fill={CARD} />
            <circle cx={hoverX} cy={hoverY} r="4" fill={hover.projected ? FORECAST : color} />
            <g transform={`translate(${tooltipOnLeft ? hoverX - 138 : hoverX + 10}, ${PAD_TOP})`}>
              <rect width="128" height={hover.projected ? 54 : 40} rx="6" fill="#1b2338" stroke={GRID} />
              <text x="10" y="17" fill="#edf0f7" fontSize="13" fontWeight="600" fontFamily="ui-monospace, monospace">
                ${hover.close.toFixed(2)}
              </text>
              <text x="10" y="32" fill={AXIS_TEXT} fontSize="11">
                {formatDate(hover.date)}
              </text>
              {hover.projected && (
                <text x="10" y="46" fill={AXIS_TEXT} fontSize="10" fontStyle="italic">
                  projected
                </text>
              )}
            </g>
          </g>
        )}
      </svg>

      <p className="text-xs text-ink-mute mt-2 leading-relaxed">
        <span
          className="inline-block w-6 border-t-2 border-dashed align-middle mr-2"
          style={{ borderColor: FORECAST }}
        />
        The white dashed line is the model&apos;s projected path — direction from the
        prediction, magnitude scaled by recent volatility. Illustrative only.
      </p>
    </div>
  )
}
