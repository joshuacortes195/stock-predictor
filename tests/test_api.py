import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from api import app as api_app


@pytest.fixture()
def client():
    api_app._request_log.clear()
    api_app.app.config["TESTING"] = True
    return api_app.app.test_client()


def _fake_history(n_days=60):
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    rng = np.random.default_rng(7)
    close = 100 + np.cumsum(rng.normal(0, 1, n_days))
    return pd.DataFrame({
        "date": dates, "Ticker": "AAPL",
        "open": close, "high": close + 1, "low": close - 1,
        "close": close, "volume": rng.integers(1_000, 10_000, n_days),
    })


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_missing_ticker_is_400(client):
    resp = client.get("/api/predict")
    assert resp.status_code == 400
    assert "required" in resp.get_json()["error"]


@pytest.mark.parametrize("bad", [
    "AAPL; DROP",            # injection-shaped
    "<script>",              # markup
    "A" * 11,                # too long
    "../etc/passwd",         # traversal-shaped
    "AAPL GOOG",             # whitespace
])
def test_malformed_tickers_rejected_before_any_fetch(client, bad):
    with patch.object(api_app, "fetch_recent_ohlcv") as fetch:
        resp = client.get("/api/predict", query_string={"ticker": bad})
    assert resp.status_code == 400
    assert "Invalid ticker" in resp.get_json()["error"]
    fetch.assert_not_called()


@pytest.mark.parametrize("good", ["AAPL", "BRK-B", "BF.B", "^GSPC", "EURUSD=X", "aapl"])
def test_yahoo_style_tickers_accepted(client, good):
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=_fake_history()):
        resp = client.get("/api/predict", query_string={"ticker": good})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ticker"] == good.upper()
    assert body["prediction"] in ("up", "down")
    assert 0.5 <= body["confidence"] <= 1.0


def test_response_includes_chart_history_and_signal(client):
    history = _fake_history(n_days=200)
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=history):
        body = client.get("/api/predict?ticker=AAPL").get_json()

    assert len(body["history"]) == 126  # capped at ~6 months of trading days
    assert body["history"][-1]["date"] == str(history["date"].max().date())
    assert all(set(p) == {"date", "close"} for p in body["history"])

    assert body["signal"]["verdict"] in ("no_edge", "weak_up", "weak_down", "lean_up", "lean_down")
    assert body["signal"]["label"]
    assert body["signal"]["detail"]


@pytest.mark.parametrize("proba,verdict", [
    (0.50, "no_edge"),
    (0.519, "no_edge"),
    (0.481, "no_edge"),
    (0.53, "weak_up"),
    (0.47, "weak_down"),
    (0.57, "lean_up"),
    (0.43, "lean_down"),
])
def test_investment_signal_thresholds(proba, verdict):
    assert api_app.investment_signal(proba)["verdict"] == verdict


def test_investment_signal_never_says_invest_outright():
    for proba in np.linspace(0.0, 1.0, 101):
        signal = api_app.investment_signal(float(proba))
        assert "invest" not in signal["label"].lower()


def test_upstream_failure_is_502_not_traceback(client):
    with patch.object(api_app, "fetch_recent_ohlcv", side_effect=RuntimeError("boom")):
        resp = client.get("/api/predict", query_string={"ticker": "AAPL"})
    assert resp.status_code == 502
    assert "boom" not in resp.get_data(as_text=True)


def test_rate_limit_kicks_in(client):
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=_fake_history()):
        for _ in range(api_app.RATE_LIMIT_REQUESTS):
            assert client.get("/api/predict?ticker=AAPL").status_code == 200
        resp = client.get("/api/predict?ticker=AAPL")
    assert resp.status_code == 429


def test_security_headers_present(client):
    resp = client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["Cache-Control"] == "no-store"
