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
    # next_close.isna() must be preserved as NaN, not coerced to False by the
    # comparison -- otherwise each ticker's last row gets a bogus "down" label.
    next_close = close.shift(-1)
    g["target_next_up"] = np.where(next_close.isna(), np.nan, (next_close > close).astype("float"))
    return g


BASE_FEATURE_COLUMNS = [
    "ret_0", "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_5",
    "momentum_5", "momentum_10", "momentum_20",
    "volatility_5", "volatility_10", "volatility_20",
    "vol_ratio_20", "price_to_sma20", "rsi_14",
]

# Market context: same-day S&P 500 index return (known at the close, like
# ret_0), its lag, index volatility, the stock's excess return over the
# index, and the VIX level/5-day change. All observable at or before time t.
MARKET_FEATURE_COLUMNS = [
    "mkt_ret_0", "mkt_ret_lag_1", "mkt_volatility_10",
    "excess_ret_0", "vix_close", "vix_chg_5",
]

# Day-of-week dummies (Friday is the reference level).
CALENDAR_FEATURE_COLUMNS = ["dow_mon", "dow_tue", "dow_wed", "dow_thu"]

FEATURE_COLUMNS = BASE_FEATURE_COLUMNS + MARKET_FEATURE_COLUMNS + CALENDAR_FEATURE_COLUMNS


def build_market_features(market: pd.DataFrame) -> pd.DataFrame:
    """Market-level features from a (date, mkt_close, vix_close) frame."""
    m = market.sort_values("date").copy()
    mkt_ret = m["mkt_close"].pct_change()
    m["mkt_ret_0"] = mkt_ret
    m["mkt_ret_lag_1"] = mkt_ret.shift(1)
    m["mkt_volatility_10"] = mkt_ret.rolling(10).std()
    m["vix_chg_5"] = m["vix_close"].pct_change(5)
    return m[["date", "mkt_ret_0", "mkt_ret_lag_1", "mkt_volatility_10", "vix_close", "vix_chg_5"]]


def _merge_market_and_calendar(df: pd.DataFrame, market_feats: pd.DataFrame) -> pd.DataFrame:
    """Attach market + calendar features by date.

    merge_asof(direction='backward') pairs each stock row with the most
    recent market row at or before it — only past information, and robust to
    the occasional holiday mismatch between a ticker and the index.
    """
    df = df.assign(date=df["date"].astype("datetime64[ns]"))
    market_feats = market_feats.assign(date=market_feats["date"].astype("datetime64[ns]"))
    out = pd.merge_asof(
        df.sort_values("date"),
        market_feats.sort_values("date"),
        on="date",
        direction="backward",
    )
    out["excess_ret_0"] = out["ret_0"] - out["mkt_ret_0"]
    dow = out["date"].dt.dayofweek
    for i, name in enumerate(CALENDAR_FEATURE_COLUMNS):
        out[name] = (dow == i).astype(float)
    return out


def build_feature_panel(panel: pd.DataFrame, market: pd.DataFrame) -> pd.DataFrame:
    """Add per-ticker + market + calendar features and the next-day target,
    then drop rows with NaNs.

    NaNs occur at the start of each ticker's history (rolling windows need
    warmup) and on each ticker's last row (no next-day target available) —
    dropping them is correct here, not a leakage risk.
    """
    out = panel.groupby("Ticker", group_keys=False).apply(
        _add_ticker_features, include_groups=False
    )
    out = panel[["date", "Ticker"]].join(out.drop(columns=["date", "Ticker"], errors="ignore"))
    out = _merge_market_and_calendar(out, build_market_features(market))
    needed = FEATURE_COLUMNS + ["target_next_up"]
    out = out.dropna(subset=needed)
    return out.sort_values(["Ticker", "date"]).reset_index(drop=True)


def latest_feature_row(ticker_df: pd.DataFrame, market: pd.DataFrame) -> pd.Series:
    """Feature vector for the most recent date in a single ticker's history.

    Used at serving time, where there's no next-day target yet — unlike
    build_feature_panel, this does not require target_next_up to be non-NaN.
    """
    g = _add_ticker_features(ticker_df)
    g = _merge_market_and_calendar(g, build_market_features(market))
    g = g.dropna(subset=FEATURE_COLUMNS)
    if g.empty:
        raise ValueError("Not enough history to compute features (need 20+ trading days).")
    return g.iloc[-1][FEATURE_COLUMNS]
