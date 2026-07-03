"""Flask API: given a ticker, fetch recent data live via yfinance, compute
the same leakage-safe features used in training, and return a next-day
direction prediction + confidence from the persisted model.

Works for any ticker (not just ones seen during training) since features are
ticker-agnostic — see MODEL_NOTE below for the accuracy caveat this implies.
"""

import os
import re
import sys
import time
from collections import defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import joblib
from flask import Flask, jsonify, request
from flask_cors import CORS

import pandas as pd

from stock_predictor.data import fetch_market_context, fetch_recent_ohlcv, get_sp500_constituents
from stock_predictor.features import latest_feature_row

ROOT = Path(__file__).resolve().parent.parent
MODEL = joblib.load(ROOT / "models" / "direction_model.joblib")

MODEL_NOTE = (
    "Educational demo, not financial advice. On held-out historical S&P 500 "
    "data this model does not beat a simple majority-class baseline "
    "(~52% accuracy) — see README for the full methodology and results. "
    "Accuracy on tickers outside the S&P 500 training set is unverified."
)

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


# Ticker-independent data cached with a TTL so each predict doesn't refetch
# it: market context (index + VIX closes) and the S&P 500 constituent list.
MARKET_TTL_SECONDS = 15 * 60
TICKERS_TTL_SECONDS = 24 * 60 * 60
_market_cache: dict = {"value": None, "at": 0.0}
_tickers_cache: dict = {"value": None, "at": 0.0}


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
# anything other than "sit out". Calibrated to this model's probability range
# (predictions cluster within ~±0.05 of 0.5) and kept deliberately honest:
# near-coin-flip output should read as "no edge", not as advice.
EDGE_NONE = 0.02
EDGE_WEAK = 0.06


def investment_signal(proba_up: float) -> dict:
    """Plain-language verdict derived from the model's probability.

    Never returns unqualified 'invest' — the strongest positive verdict is a
    hedged lean, matching what the evaluation actually supports (see README).
    """
    edge = abs(proba_up - 0.5)
    leans_up = proba_up >= 0.5
    if edge < EDGE_NONE:
        return {
            "verdict": "no_edge",
            "label": "No edge — sit this one out",
            "detail": (
                "The model sees essentially a coin flip for tomorrow. "
                "A prediction this close to 50% carries no usable signal."
            ),
        }
    if edge < EDGE_WEAK:
        return {
            "verdict": "weak_up" if leans_up else "weak_down",
            "label": "Weak lean up" if leans_up else "Weak lean down",
            "detail": (
                "The model leans slightly "
                f"{'positive' if leans_up else 'negative'}, but the edge is small "
                "and this model does not beat a naive baseline historically. "
                "Treat it as a curiosity, not a trade signal."
            ),
        }
    return {
        "verdict": "lean_up" if leans_up else "lean_down",
        "label": "Notable lean up" if leans_up else "Notable lean down",
        "detail": (
            "This is an unusually confident output for this model — still an "
            "educational demo prediction, not investment advice."
        ),
    }


def forecast_path(history: pd.DataFrame, proba_up: float, days: int = 5) -> list[dict]:
    """Short projected close path for the chart's dashed 'prediction' line.

    Direction comes from the model; magnitude is ILLUSTRATIVE — the expected
    daily move is the model's edge (2·P(up) − 1) scaled by the stock's recent
    daily volatility, compounded over the next `days` business days. The model
    only predicts next-day direction, so anything drawn past one day is a
    visualization aid, and the UI labels it that way.
    """
    closes = history.sort_values("date")["close"]
    daily_vol = float(closes.pct_change().tail(20).std())
    expected_daily_ret = (2 * proba_up - 1) * daily_vol
    last_date = history["date"].max()
    last_close = float(closes.iloc[-1])
    path = []
    for d in pd.bdate_range(last_date + pd.Timedelta(days=1), periods=days):
        last_close *= 1 + expected_daily_ret
        path.append({"date": str(d.date()), "close": round(last_close, 2)})
    return path


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


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

    try:
        history = fetch_recent_ohlcv(ticker)
        market = _cached(_market_cache, MARKET_TTL_SECONDS, fetch_market_context)
        features = latest_feature_row(history, market)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        app.logger.exception("Prediction failed for ticker %s", ticker)
        return jsonify({"error": "Could not fetch data for that ticker right now — try again later."}), 502

    proba_up = float(MODEL.predict_proba(features.to_frame().T)[0, 1])
    direction = "up" if proba_up >= 0.5 else "down"
    confidence = proba_up if direction == "up" else 1 - proba_up

    # ~6 months of closes for the frontend chart — reuses the history already
    # fetched for feature computation, so no extra upstream call.
    recent = history.sort_values("date").tail(126)
    chart = [
        {"date": str(d.date()), "close": round(float(c), 2)}
        for d, c in zip(recent["date"], recent["close"])
    ]

    return jsonify({
        "ticker": ticker,
        "as_of_date": str(history["date"].max().date()),
        "prediction": direction,
        "confidence": round(confidence, 4),
        "probability_up": round(proba_up, 4),
        "signal": investment_signal(proba_up),
        "history": chart,
        "forecast": forecast_path(history, proba_up),
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
