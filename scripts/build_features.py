"""Build the engineered feature panel from the raw OHLCV data.

Usage:
    python scripts/build_features.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from stock_predictor.data import load_panel
from stock_predictor.features import build_feature_panel

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    panel = load_panel(str(ROOT / "data" / "raw" / "sp500_panel.csv"))
    features = build_feature_panel(panel)
    out_path = ROOT / "data" / "processed_features.csv"
    features.to_csv(out_path, index=False)
    print(f"Saved {features.shape[0]} rows x {features.shape[1]} cols to {out_path}")


if __name__ == "__main__":
    main()
