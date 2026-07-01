"""Flask API: given a ticker, fetch recent data live via yfinance, compute
the same leakage-safe features used in training, and return a next-day
direction prediction + confidence from the persisted model.

Works for any ticker (not just ones seen during training) since features are
ticker-agnostic — see MODEL_NOTE below for the accuracy caveat this implies.
"""

import sys
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

app = Flask(__name__)
CORS(app)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/predict")
def predict():
    ticker = request.args.get("ticker", "").strip().upper()
    if not ticker:
        return jsonify({"error": "Query param 'ticker' is required, e.g. /api/predict?ticker=AAPL"}), 400

    try:
        history = fetch_recent_ohlcv(ticker)
        features = latest_feature_row(history)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

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
    app.run(debug=True, port=5001)
