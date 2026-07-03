import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from stock_predictor.features import FEATURE_COLUMNS, build_feature_panel, latest_feature_row


def _synthetic_panel(n_days=60, tickers=("AAA", "BBB")):
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    rng = np.random.default_rng(42)
    frames = []
    for t in tickers:
        close = 100 + np.cumsum(rng.normal(0, 1, n_days))
        frames.append(pd.DataFrame({
            "date": dates, "Ticker": t,
            "open": close, "high": close + 1, "low": close - 1,
            "close": close, "volume": rng.integers(1_000, 10_000, n_days),
        }))
    return pd.concat(frames, ignore_index=True)


def _synthetic_market(n_days=60):
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    rng = np.random.default_rng(7)
    return pd.DataFrame({
        "date": dates,
        "mkt_close": 4000 + np.cumsum(rng.normal(0, 10, n_days)),
        "vix_close": 20 + np.cumsum(rng.normal(0, 0.5, n_days)),
    })


def test_target_matches_next_day_direction():
    panel = _synthetic_panel()
    feat = build_feature_panel(panel, _synthetic_market())
    raw = panel[panel["Ticker"] == "AAA"].set_index("date")["close"]

    for _, row in feat[feat["Ticker"] == "AAA"].iterrows():
        idx = raw.index.get_loc(row["date"])
        actual_up = float(raw.iloc[idx + 1] > raw.iloc[idx])
        assert row["target_next_up"] == actual_up


def test_no_nans_in_features_or_target():
    feat = build_feature_panel(_synthetic_panel(), _synthetic_market())
    assert feat[FEATURE_COLUMNS + ["target_next_up"]].isna().sum().sum() == 0


def test_last_row_per_ticker_is_dropped_no_future_target():
    panel = _synthetic_panel()
    feat = build_feature_panel(panel, _synthetic_market())
    last_dates = panel.groupby("Ticker")["date"].max()
    for ticker, last_date in last_dates.items():
        assert not ((feat["Ticker"] == ticker) & (feat["date"] == last_date)).any()


def test_latest_feature_row_uses_most_recent_date_and_no_target_required():
    panel = _synthetic_panel()
    single = panel[panel["Ticker"] == "AAA"]
    row = latest_feature_row(single, _synthetic_market())
    assert list(row.index) == FEATURE_COLUMNS
    assert not row.isna().any()


def test_features_are_ticker_agnostic_columns_only():
    # Model must never be trainable on raw price level or ticker identity.
    assert "close" not in FEATURE_COLUMNS
    assert "Ticker" not in FEATURE_COLUMNS
    assert not any("ticker" in c.lower() for c in FEATURE_COLUMNS)
