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

from stock_predictor.data import fetch_recent_ohlcv
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


def _rate_limited(client_ip: str) -> bool:
    now = time.monotonic()
    window = _request_log[client_ip]
    while window and now - window[0] > RATE_LIMIT_WINDOW_SECONDS:
        window.popleft()
    if len(window) >= RATE_LIMIT_REQUESTS:
        return True
    window.append(now)
    return False


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


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
        features = latest_feature_row(history)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        app.logger.exception("Prediction failed for ticker %s", ticker)
        return jsonify({"error": "Could not fetch data for that ticker right now — try again later."}), 502

    proba_up = float(MODEL.predict_proba(features.to_frame().T)[0, 1])
    direction = "up" if proba_up >= 0.5 else "down"
    confidence = proba_up if direction == "up" else 1 - proba_up

    return jsonify({
        "ticker": ticker,
        "as_of_date": str(history["date"].max().date()),
        "prediction": direction,
        "confidence": round(confidence, 4),
        "probability_up": round(proba_up, 4),
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
