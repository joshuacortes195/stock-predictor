"""Download the training dataset from Kaggle.

Dataset: camnugent/sandp500 ("S&P 500 stock data") — daily OHLCV for all
S&P 500 constituents, 2013-2018. Requires Kaggle API credentials at
~/.kaggle/kaggle.json (see README.md for setup).

Usage:
    python scripts/download_data.py
"""

from pathlib import Path

from kaggle.api.kaggle_api_extended import KaggleApi

DATASET = "camnugent/sandp500"
RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    api = KaggleApi()
    api.authenticate()
    api.dataset_download_files(DATASET, path=str(RAW_DIR), unzip=True)
    print(f"Downloaded {DATASET} to {RAW_DIR}")


if __name__ == "__main__":
    main()
