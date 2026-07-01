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
_FALLBACK_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AVGO", "ORCL",
    "CRM", "ADBE", "AMD", "QCOM", "CSCO", "INTC", "IBM", "TXN", "INTU", "NOW",
    "JPM", "V", "MA", "UNH", "HD", "PG", "JNJ", "XOM", "KO", "PEP", "WMT",
]


def get_sp500_tickers() -> list[str]:
    """Current S&P 500 constituents from Wikipedia (yfinance ticker format)."""
    try:
        resp = requests.get(WIKI_SP500_URL, headers=_BROWSER_HEADERS, timeout=15)
        resp.raise_for_status()
        table = pd.read_html(io.StringIO(resp.text))[0]
        return table["Symbol"].str.replace(".", "-", regex=False).tolist()
    except Exception:
        return list(_FALLBACK_TICKERS)


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
