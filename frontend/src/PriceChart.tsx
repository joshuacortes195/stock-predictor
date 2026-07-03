import { useMemo, useRef, useState } from 'react'

export interface PricePoint {
  date: string
  close: number
}

interface PriceChartProps {
  data: PricePoint[]
  ticker: string
}

const WIDTH = 640
const HEIGHT = 220
const PAD_TOP = 12
const PAD_BOTTOM = 22
const PAD_LEFT = 8
const PAD_RIGHT = 64

// Polarity colors validated for the dark surface (dataviz six-checks pass);
// direction is never color-alone — the header shows a signed % alongside.
const UP = '#059669'
const DOWN = '#f43f5e'

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function PriceChart({ data, ticker }: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const geom = useMemo(() => {
    const closes = data.map((p) => p.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM
    const x = (i: number) => PAD_LEFT + (i / Math.max(data.length - 1, 1)) * innerW
    const y = (c: number) => PAD_TOP + (1 - (c - min) / span) * innerH
    const line = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join('')
    const area = `${line}L${x(data.length - 1).toFixed(2)},${HEIGHT - PAD_BOTTOM}L${PAD_LEFT},${HEIGHT - PAD_BOTTOM}Z`
    return { min, max, x, y, line, area }
  }, [data])

  if (data.length < 2) return null

  const first = data[0].close
  const last = data[data.length - 1].close
  const change = last - first
  const changePct = (change / first) * 100
  const color = change >= 0 ? UP : DOWN

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH
    const frac = (px - PAD_LEFT) / (WIDTH - PAD_LEFT - PAD_RIGHT)
    const idx = Math.round(frac * (data.length - 1))
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
  }

  const hover = hoverIdx !== null ? data[hoverIdx] : null
  const hoverX = hoverIdx !== null ? geom.x(hoverIdx) : 0
  const hoverY = hover ? geom.y(hover.close) : 0
  const tooltipOnLeft = hoverX > WIDTH * 0.62

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-2xl font-semibold font-mono">${last.toFixed(2)}</span>
          <span className="ml-2 text-sm font-medium" style={{ color }}>
            {change >= 0 ? '▲' : '▼'} {change >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
        <span className="text-xs text-slate-500">{ticker} · past 6 months</span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${ticker} closing price over the past six months, from $${first.toFixed(2)} to $${last.toFixed(2)}`}
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
              stroke="#1e293b" strokeWidth="1"
            />
            <text
              x={WIDTH - PAD_RIGHT + 8} y={geom.y(v) + 3.5}
              fill="#64748b" fontSize="11" fontFamily="ui-monospace, monospace"
            >
              ${v.toFixed(2)}
            </text>
          </g>
        ))}

        <path d={geom.area} fill="url(#area-fill)" />
        <path d={geom.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />

        {/* first/last date labels, recessive */}
        <text x={PAD_LEFT} y={HEIGHT - 6} fill="#64748b" fontSize="11">
          {formatDate(data[0].date)}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 6} fill="#64748b" fontSize="11" textAnchor="end">
          {formatDate(data[data.length - 1].date)}
        </text>

        {hover && (
          <g>
            <line
              x1={hoverX} x2={hoverX}
              y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM}
              stroke="#475569" strokeWidth="1" strokeDasharray="3 3"
            />
            {/* 2px surface ring so the marker reads against the line */}
            <circle cx={hoverX} cy={hoverY} r="5.5" fill="#0f172a" />
            <circle cx={hoverX} cy={hoverY} r="4" fill={color} />
            <g transform={`translate(${tooltipOnLeft ? hoverX - 118 : hoverX + 10}, ${PAD_TOP})`}>
              <rect width="108" height="40" rx="6" fill="#1e293b" stroke="#334155" />
              <text x="10" y="17" fill="#f1f5f9" fontSize="13" fontWeight="600" fontFamily="ui-monospace, monospace">
                ${hover.close.toFixed(2)}
              </text>
              <text x="10" y="32" fill="#94a3b8" fontSize="11">
                {formatDate(hover.date)}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  )
}
