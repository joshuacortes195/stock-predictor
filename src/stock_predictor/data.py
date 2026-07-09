"""Data acquisition: S&P 500 ticker list + historical OHLCV panel via yfinance.

Originally the plan was to train on Kaggle's camnugent/sandp500 dataset, but no
Kaggle API credentials were available in this environment. yfinance covers the
same ticker universe with a longer, more current history and needs no auth,
so it's used for both training-data acquisition and live inference (see
scripts/download_data.py and the Flask API in api/app.py).
"""

from __future__ import annotations

import io

import pandas as pd
import requests
import yfinance as yf

WIKI_SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
_BROWSER_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

# Fallback list (large/liquid names) used only if the Wikipedia fetch fails.
# Sector is a best-effort GICS sector for this small fallback set only — the
# normal path reads the real sector straight from the Wikipedia table.
_FALLBACK_TICKERS = [
    ("AAPL", "Information Technology"), ("MSFT", "Information Technology"),
    ("GOOGL", "Communication Services"), ("AMZN", "Consumer Discretionary"),
    ("NVDA", "Information Technology"), ("META", "Communication Services"),
    ("TSLA", "Consumer Discretionary"), ("AVGO", "Information Technology"),
    ("ORCL", "Information Technology"), ("CRM", "Information Technology"),
    ("ADBE", "Information Technology"), ("AMD", "Information Technology"),
    ("QCOM", "Information Technology"), ("CSCO", "Information Technology"),
    ("INTC", "Information Technology"), ("IBM", "Information Technology"),
    ("TXN", "Information Technology"), ("INTU", "Information Technology"),
    ("NOW", "Information Technology"), ("JPM", "Financials"), ("V", "Financials"),
    ("MA", "Financials"), ("UNH", "Health Care"), ("HD", "Consumer Discretionary"),
    ("PG", "Consumer Staples"), ("JNJ", "Health Care"), ("XOM", "Energy"),
    ("KO", "Consumer Staples"), ("PEP", "Consumer Staples"), ("WMT", "Consumer Staples"),
]


def get_sp500_constituents() -> list[dict[str, str]]:
    """Current S&P 500 constituents from Wikipedia as
    [{symbol, name, sector}, ...], alphabetical by symbol (yfinance ticker
    format). Sector is the GICS Sector Wikipedia tracks for index membership."""
    try:
        resp = requests.get(WIKI_SP500_URL, headers=_BROWSER_HEADERS, timeout=15)
        resp.raise_for_status()
        table = pd.read_html(io.StringIO(resp.text))[0]
        out = [
            {"symbol": str(sym).replace(".", "-"), "name": str(name), "sector": str(sector)}
            for sym, name, sector in zip(table["Symbol"], table["Security"], table["GICS Sector"])
        ]
    except Exception:
        out = [{"symbol": t, "name": t, "sector": s} for t, s in _FALLBACK_TICKERS]
    return sorted(out, key=lambda c: c["symbol"])


def get_sp500_tickers() -> list[str]:
    """Current S&P 500 constituent symbols (yfinance ticker format)."""
    return [c["symbol"] for c in get_sp500_constituents()]


def download_price_panel(
    tickers: list[str], start: str, end: str, min_rows: int = 500
) -> pd.DataFrame:
    """Download daily OHLCV for `tickers` and return a tidy long-format panel.

    Columns: date, Ticker, open, high, low, close, volume. Tickers with too
    little history (e.g. recent IPOs) are dropped so every name in the panel
    has enough data for lag/rolling features.
    """
    raw = yf.download(
        tickers, start=start, end=end, group_by="ticker",
        progress=False, auto_adjust=True, threads=True,
    )
    frames = []
    for ticker in raw.columns.get_level_values(0).unique():
        sub = raw[ticker].dropna(how="all")
        if len(sub) < min_rows:
            continue
        sub = sub.copy()
        sub["Ticker"] = ticker
        frames.append(sub.reset_index())

    panel = pd.concat(frames, ignore_index=True)
    panel = panel.rename(columns={
        "Date": "date", "Open": "open", "High": "high",
        "Low": "low", "Close": "close", "Volume": "volume",
    })
    panel = panel[["date", "Ticker", "open", "high", "low", "close", "volume"]]
    panel = panel.dropna(subset=["open", "high", "low", "close"])
    return panel.sort_values(["Ticker", "date"]).reset_index(drop=True)


def load_panel(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["date"])
    return df.sort_values(["Ticker", "date"]).reset_index(drop=True)


def fetch_market_context(
    start: str | None = None, end: str | None = None, period: str | None = None
) -> pd.DataFrame:
    """Daily S&P 500 index close + VIX close, for the market-context features.

    Both series come from yfinance like everything else, so the same function
    serves training (start/end) and live inference (period). Columns:
    date, mkt_close, vix_close.
    """
    kwargs = {"start": start, "end": end} if start else {"period": period or "9mo"}
    raw = yf.download(
        ["^GSPC", "^VIX"], group_by="ticker", progress=False,
        auto_adjust=True, threads=True, **kwargs,
    )
    closes = pd.DataFrame({
        "mkt_close": raw["^GSPC"]["Close"],
        "vix_close": raw["^VIX"]["Close"],
    }).dropna().reset_index()
    closes = closes.rename(columns={closes.columns[0]: "date"})
    closes["date"] = pd.to_datetime(closes["date"]).dt.tz_localize(None)
    return closes.sort_values("date").reset_index(drop=True)


def fetch_recent_ohlcv(ticker: str, period: str = "9mo") -> pd.DataFrame:
    """Recent daily OHLCV for a single ticker, for live inference.

    ~9 months comfortably covers the 20-trading-day rolling windows the
    feature pipeline needs, for any ticker a user requests — not just ones
    seen during training.
    """
    hist = yf.Ticker(ticker).history(period=period, auto_adjust=True)
    if hist.empty:
        raise ValueError(f"No data returned for ticker '{ticker}' — check the symbol.")
    hist = hist.reset_index()
    hist = hist.rename(columns={
        "Date": "date", "Open": "open", "High": "high",
        "Low": "low", "Close": "close", "Volume": "volume",
    })
    hist["date"] = pd.to_datetime(hist["date"]).dt.tz_localize(None)
    hist["Ticker"] = ticker.upper()
    return hist[["date", "Ticker", "open", "high", "low", "close", "volume"]]
