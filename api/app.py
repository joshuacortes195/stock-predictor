"""Flask API: given a ticker and horizon, fetch recent data live via yfinance,
compute the same leakage-safe features used in training, and return a
direction prediction + confidence from the persisted per-horizon model.

Works for any ticker (not just ones seen during training) since features are
ticker-agnostic — see MODEL_NOTE below for the accuracy caveat this implies.
"""

import json
import os
import re
import sys
import time
from collections import defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import joblib
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from sklearn.linear_model import LogisticRegression

from stock_predictor.data import fetch_market_context, fetch_recent_ohlcv, get_sp500_constituents
from stock_predictor.features import FEATURE_COLUMNS, HORIZON_DAYS, latest_feature_row

ROOT = Path(__file__).resolve().parent.parent
MODELS = {
    h: joblib.load(ROOT / "models" / f"direction_model_{h}.joblib") for h in HORIZON_DAYS
}
with open(ROOT / "models" / "metrics.json") as f:
    METRICS = json.load(f)

HORIZON_LABELS = {"1d": "next trading day", "1w": "next week", "1m": "next month"}
FORECAST_DAYS = {"1d": 5, "1w": 5, "1m": 21}

MODEL_NOTE = (
    "Educational demo, not financial advice. On held-out historical S&P 500 "
    "data these models perform at or near a simple majority-class baseline — "
    "see README for the full methodology and results. Accuracy on tickers "
    "outside the S&P 500 training set is unverified."
)

FEATURE_LABELS = {
    "ret_0": "Today's return",
    "ret_lag_1": "Yesterday's return",
    "ret_lag_2": "Return 2 days ago",
    "ret_lag_3": "Return 3 days ago",
    "ret_lag_5": "Return 5 days ago",
    "momentum_5": "5-day momentum",
    "momentum_10": "10-day momentum",
    "momentum_20": "20-day momentum",
    "volatility_5": "5-day volatility",
    "volatility_10": "10-day volatility",
    "volatility_20": "20-day volatility",
    "vol_ratio_20": "Volume vs 20-day average",
    "price_to_sma20": "Price vs 20-day average",
    "rsi_14": "RSI (14-day)",
    "mkt_ret_0": "S&P 500 return today",
    "mkt_ret_lag_1": "S&P 500 return yesterday",
    "mkt_volatility_10": "Market volatility (10-day)",
    "excess_ret_0": "Return vs the market today",
    "vix_close": "VIX level",
    "vix_chg_5": "VIX 5-day change",
    "dow_mon": "It's a Monday",
    "dow_tue": "It's a Tuesday",
    "dow_wed": "It's a Wednesday",
    "dow_thu": "It's a Thursday",
}

# Yahoo-style symbols only: optional ^ prefix (indices), then letters/digits
# with . - = separators (AAPL, BRK-B, BF.B, ^GSPC, EURUSD=X). Anything else is
# rejected before it can reach the upstream data request.
TICKER_RE = re.compile(r"^\^?[A-Z0-9][A-Z0-9.\-=]{0,9}$")

# Demo-grade per-IP sliding-window rate limit, since every /api/predict call
# triggers an upstream yfinance fetch. In-memory only — behind a real proxy
# you'd use flask-limiter or the proxy's limiter instead.
RATE_LIMIT_REQUESTS = 30
RATE_LIMIT_WINDOW_SECONDS = 60.0
_request_log: dict[str, deque] = defaultdict(deque)

# Ticker-independent data cached with a TTL so each predict doesn't refetch
# it: market context (index + VIX closes) and the S&P 500 constituent list.
MARKET_TTL_SECONDS = 15 * 60
TICKERS_TTL_SECONDS = 24 * 60 * 60
_market_cache: dict = {"value": None, "at": 0.0}
_tickers_cache: dict = {"value": None, "at": 0.0}

# Comma-separated allowlist; defaults to the local Vite dev server.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

app = Flask(__name__)
CORS(app, origins=ALLOWED_ORIGINS)


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


def _cached(cache: dict, ttl: float, fetch):
    if cache["value"] is None or time.monotonic() - cache["at"] > ttl:
        cache["value"] = fetch()
        cache["at"] = time.monotonic()
    return cache["value"]


def _rate_limited(client_ip: str) -> bool:
    now = time.monotonic()
    window = _request_log[client_ip]
    while window and now - window[0] > RATE_LIMIT_WINDOW_SECONDS:
        window.popleft()
    if len(window) >= RATE_LIMIT_REQUESTS:
        return True
    window.append(now)
    return False


# How far |P(up) - 0.5| must reach before the "should I invest?" verdict is
# anything other than "sit out". Calibrated to these models' probability range
# (predictions cluster within ~±0.05 of 0.5) and kept deliberately honest:
# near-coin-flip output should read as "no edge", not as advice.
EDGE_NONE = 0.02
EDGE_WEAK = 0.06


def investment_signal(proba_up: float, horizon: str) -> dict:
    """Plain-language verdict derived from the model's probability.

    Never returns unqualified 'invest' — the strongest positive verdict is a
    hedged lean, matching what the evaluation actually supports (see README).
    """
    period = HORIZON_LABELS[horizon]
    edge = abs(proba_up - 0.5)
    leans_up = proba_up >= 0.5
    if edge < EDGE_NONE:
        return {
            "verdict": "no_edge",
            "label": "No edge — sit this one out",
            "detail": (
                f"The model sees essentially a coin flip for the {period}. "
                "A prediction this close to 50% carries no usable signal."
            ),
        }
    if edge < EDGE_WEAK:
        return {
            "verdict": "weak_up" if leans_up else "weak_down",
            "label": "Weak lean up" if leans_up else "Weak lean down",
            "detail": (
                f"The model leans slightly "
                f"{'positive' if leans_up else 'negative'} for the {period}, "
                "but the edge is small and these models do not beat a naive "
                "baseline historically. Treat it as a curiosity, not a trade signal."
            ),
        }
    return {
        "verdict": "lean_up" if leans_up else "lean_down",
        "label": "Notable lean up" if leans_up else "Notable lean down",
        "detail": (
            f"This is an unusually confident output for the {period} — still "
            "an educational demo prediction, not investment advice."
        ),
    }


def explain_prediction(model, features: pd.Series) -> list[dict]:
    """Top per-feature contributions for the served prediction.

    For the scaled logistic regression this is exact: coefficient × the
    feature's z-score is that feature's additive push on the log-odds of
    'up'. For tree models it falls back to global importances (marked as
    such) since per-row attribution needs SHAP-style machinery.
    """
    clf = model.named_steps.get("clf")
    if isinstance(clf, LogisticRegression) and "scale" in model.named_steps:
        scaler = model.named_steps["scale"]
        z = (features.to_numpy() - scaler.mean_) / scaler.scale_
        contributions = clf.coef_[0] * z
        top = sorted(zip(FEATURE_COLUMNS, contributions), key=lambda p: -abs(p[1]))[:5]
        return [
            {"feature": FEATURE_LABELS.get(name, name), "impact": round(float(c), 4), "scope": "this_prediction"}
            for name, c in top
        ]
    if hasattr(clf, "feature_importances_"):
        top = sorted(zip(FEATURE_COLUMNS, clf.feature_importances_), key=lambda p: -p[1])[:5]
        return [
            {"feature": FEATURE_LABELS.get(name, name), "impact": round(float(i), 4), "scope": "model_global"}
            for name, i in top
        ]
    return []


def forecast_path(history: pd.DataFrame, proba_up: float, horizon: str) -> list[dict]:
    """Projected close path for the chart's dashed 'prediction' line.

    Direction comes from the model; magnitude is ILLUSTRATIVE — the expected
    move over the horizon is the model's edge (2·P(up) − 1) scaled by recent
    volatility over that horizon (daily vol × √days), spread across the
    projected business days. The UI labels it as illustrative.
    """
    days = HORIZON_DAYS[horizon]
    n_steps = FORECAST_DAYS[horizon]
    closes = history.sort_values("date")["close"]
    daily_vol = float(closes.pct_change().tail(20).std())
    expected_total = (2 * proba_up - 1) * daily_vol * (days ** 0.5)
    per_step = expected_total / n_steps
    last_date = history["date"].max()
    last_close = float(closes.iloc[-1])
    path = []
    for d in pd.bdate_range(last_date + pd.Timedelta(days=1), periods=n_steps):
        last_close *= 1 + per_step
        path.append({"date": str(d.date()), "close": round(last_close, 2)})
    return path


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/metrics")
def metrics():
    return jsonify(METRICS)


@app.get("/api/tickers")
def tickers():
    constituents = _cached(_tickers_cache, TICKERS_TTL_SECONDS, get_sp500_constituents)
    return jsonify({"tickers": constituents})


@app.get("/api/predict")
def predict():
    if _rate_limited(request.remote_addr or "unknown"):
        return jsonify({"error": "Too many requests — try again in a minute."}), 429

    ticker = request.args.get("ticker", "").strip().upper()
    if not ticker:
        return jsonify({"error": "Query param 'ticker' is required, e.g. /api/predict?ticker=AAPL"}), 400
    if not TICKER_RE.fullmatch(ticker):
        return jsonify({"error": "Invalid ticker format — use symbols like AAPL, BRK-B, or ^GSPC."}), 400

    horizon = request.args.get("horizon", "1d").strip().lower()
    if horizon not in MODELS:
        return jsonify({"error": f"Invalid horizon — use one of {sorted(MODELS)}."}), 400

    try:
        history = fetch_recent_ohlcv(ticker, period="1y")
        market = _cached(_market_cache, MARKET_TTL_SECONDS, lambda: fetch_market_context(period="1y"))
        features = latest_feature_row(history, market)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        app.logger.exception("Prediction failed for ticker %s", ticker)
        return jsonify({"error": "Could not fetch data for that ticker right now — try again later."}), 502

    model = MODELS[horizon]
    proba_up = float(model.predict_proba(features.to_frame().T)[0, 1])
    direction = "up" if proba_up >= 0.5 else "down"
    confidence = proba_up if direction == "up" else 1 - proba_up

    # Up to a year of closes for the frontend chart — reuses the history
    # already fetched for feature computation, so no extra upstream call.
    recent = history.sort_values("date").tail(252)
    chart = [
        {"date": str(d.date()), "close": round(float(c), 2)}
        for d, c in zip(recent["date"], recent["close"])
    ]

    return jsonify({
        "ticker": ticker,
        "as_of_date": str(history["date"].max().date()),
        "horizon": horizon,
        "horizon_label": HORIZON_LABELS[horizon],
        "prediction": direction,
        "confidence": round(confidence, 4),
        "probability_up": round(proba_up, 4),
        "signal": investment_signal(proba_up, horizon),
        "explanation": explain_prediction(model, features),
        "history": chart,
        "forecast": forecast_path(history, proba_up, horizon),
        "note": MODEL_NOTE,
    })


if __name__ == "__main__":
    # Debug mode (Werkzeug debugger = arbitrary code execution if reachable)
    # is opt-in via FLASK_DEBUG=1 and the server binds to localhost only.
    app.run(
        host="127.0.0.1",
        port=5001,
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
    )
