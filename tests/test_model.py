import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from stock_predictor.model import chronological_split, time_series_cv_scores


class _SpyModel:
    """Records which rows each CV fold trains and validates on."""

    def __init__(self):
        self.folds = []
        self._train_index = None

    def fit(self, X, y):
        self._train_index = X.index

    def predict(self, X):
        self.folds.append((self._train_index, X.index))
        return np.zeros(len(X))


def _panel_frame(n_days=30, tickers=("AAA", "BBB", "CCC")):
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    rows = []
    for t in tickers:  # grouped by ticker on purpose — the panel's real layout
        for d in dates:
            rows.append({"date": d, "Ticker": t, "x": 0.0, "target_next_up": 0})
    return pd.DataFrame(rows)


def test_cv_folds_split_on_dates_not_row_position():
    """Every validation date must be strictly after every training date in
    its fold, even though the panel is sorted by (Ticker, date). A row-based
    TimeSeriesSplit fails this — that leak once inflated CV accuracy from
    ~0.52 to ~0.66 via date-fingerprinting of market features."""
    df = _panel_frame()
    X = df[["x"]]
    y = df["target_next_up"]
    spy = _SpyModel()

    time_series_cv_scores(spy, X, y, df["date"], n_splits=4)

    assert len(spy.folds) == 4
    for train_index, val_index in spy.folds:
        assert df.loc[train_index, "date"].max() < df.loc[val_index, "date"].min()
        # every ticker appears in both sides — the split axis is time, not entity
        assert set(df.loc[val_index, "Ticker"]) == {"AAA", "BBB", "CCC"}


def test_chronological_split_never_shares_dates():
    df = _panel_frame()
    train, test = chronological_split(df, test_frac=0.2)
    assert train["date"].max() < test["date"].min()
    assert len(train) + len(test) == len(df)
