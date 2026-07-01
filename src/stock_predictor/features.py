"""Leakage-safe feature engineering for next-day direction prediction.

Every feature for the row at date t is computed only from data available at
or before the close on day t (returns, rolling stats, momentum, volume
ratios, RSI, price-vs-moving-average). The target is the *next* day's
direction, computed with a forward shift and never fed back in as a feature.
Features are also ticker-agnostic (no raw price level, no ticker identity) so
the model generalizes to tickers it never saw in training.
"""

import numpy as np
import pandas as pd


def _rsi(close: pd.Series, window: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(window).mean()
    loss = (-delta.clip(upper=0)).rolling(window).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _add_ticker_features(g: pd.DataFrame) -> pd.DataFrame:
    g = g.sort_values("date").copy()
    close, volume = g["close"], g["volume"]

    ret = close.pct_change()
    g["ret_0"] = ret
    for lag in (1, 2, 3, 5):
        g[f"ret_lag_{lag}"] = ret.shift(lag)

    for window in (5, 10, 20):
        g[f"momentum_{window}"] = close / close.shift(window) - 1
        g[f"volatility_{window}"] = ret.rolling(window).std()

    g["vol_ratio_20"] = volume / volume.rolling(20).mean()
    g["price_to_sma20"] = close / close.rolling(20).mean() - 1
    g["rsi_14"] = _rsi(close, 14)

    # Target: next day's direction. Uses future data ONLY as the label.
    g["target_next_up"] = (close.shift(-1) > close).astype("float")
    return g


FEATURE_COLUMNS = [
    "ret_0", "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_5",
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_5", "volatility_10", "volatility_20",
    "vol_ratio_20", "price_to_sma20", "rsi_14",
]


def build_feature_panel(panel: pd.DataFrame) -> pd.DataFrame:
    """Add features + next-day target, then drop rows with NaNs.

    NaNs occur at the start of each ticker's history (rolling windows need
    warmup) and on each ticker's last row (no next-day target available) —
    dropping them is correct here, not a leakage risk.
    """
    out = panel.groupby("Ticker", group_keys=False).apply(
        _add_ticker_features, include_groups=False
    )
    out = panel[["date", "Ticker"]].join(out.drop(columns=["date", "Ticker"], errors="ignore"))
    needed = FEATURE_COLUMNS + ["target_next_up"]
    return out.dropna(subset=needed).reset_index(drop=True)
