"""Ticker -> GICS-style sector lookup, shared by app.py (tickers/movers) and
accounts.py (watchlist category breakdown).

S&P 500 names resolve for free from the constituents list Wikipedia already
tracks (see stock_predictor.data.get_sp500_constituents). Anything else —
a small-cap like QSI, an ETF, an index — falls back to a single yfinance
info lookup, cached for a long time since a company's sector essentially
never changes. Both layers cache "not found" too, so a bad/exotic symbol
doesn't get re-queried on every request.
"""

import time

from stock_predictor.data import get_sp500_constituents

_SP500_TTL_SECONDS = 24 * 60 * 60
_sp500_cache: dict = {"map": None, "at": 0.0}

_FALLBACK_TTL_SECONDS = 7 * 24 * 60 * 60
_fallback_cache: dict[str, tuple[str | None, float]] = {}

UNCATEGORIZED = "Uncategorized"


def _sp500_sector_map() -> dict[str, str]:
    if _sp500_cache["map"] is None or time.monotonic() - _sp500_cache["at"] > _SP500_TTL_SECONDS:
        _sp500_cache["map"] = {
            c["symbol"]: c["sector"] for c in get_sp500_constituents() if c.get("sector")
        }
        _sp500_cache["at"] = time.monotonic()
    return _sp500_cache["map"]


def get_sector(symbol: str) -> str | None:
    """Best-effort sector for `symbol`, or None if it can't be determined."""
    sector = _sp500_sector_map().get(symbol)
    if sector:
        return sector

    cached = _fallback_cache.get(symbol)
    if cached is not None and time.monotonic() - cached[1] < _FALLBACK_TTL_SECONDS:
        return cached[0]

    sector = None
    try:
        import yfinance as yf

        info = yf.Ticker(symbol).get_info()
        sector = info.get("sector") or None
    except Exception:
        pass
    _fallback_cache[symbol] = (sector, time.monotonic())
    return sector
