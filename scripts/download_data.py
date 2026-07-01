"""Download the S&P 500 daily OHLCV training panel via yfinance.

No API credentials required. Saves a tidy long-format panel to
data/raw/sp500_panel.csv (date, Ticker, open, high, low, close, volume).

Usage:
    python scripts/download_data.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from stock_predictor.data import download_price_panel, get_sp500_tickers

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
START, END = "2016-01-01", "2026-06-30"


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    tickers = get_sp500_tickers()
    print(f"Fetching {len(tickers)} tickers from {START} to {END}...")
    panel = download_price_panel(tickers, START, END)
    out_path = RAW_DIR / "sp500_panel.csv"
    panel.to_csv(out_path, index=False)
    print(f"Saved {panel.shape[0]} rows x {panel['Ticker'].nunique()} tickers to {out_path}")


if __name__ == "__main__":
    main()
