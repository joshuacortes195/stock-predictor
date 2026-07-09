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
    api_app._market_cache.update({"value": None, "at": 0.0})
    api_app._tickers_cache.update({"value": None, "at": 0.0})
    api_app.app.config["TESTING"] = True
    with patch.object(api_app, "fetch_market_context", return_value=_fake_market(250)), \
         patch.object(api_app, "get_sector", return_value="Information Technology"):
        yield api_app.app.test_client()


def _fake_history(n_days=60):
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    rng = np.random.default_rng(7)
    close = 100 + np.cumsum(rng.normal(0, 1, n_days))
    return pd.DataFrame({
        "date": dates, "Ticker": "AAPL",
        "open": close, "high": close + 1, "low": close - 1,
        "close": close, "volume": rng.integers(1_000, 10_000, n_days),
    })


def _fake_market(n_days=60):
    dates = pd.bdate_range("2023-01-02", periods=n_days)
    rng = np.random.default_rng(11)
    return pd.DataFrame({
        "date": dates,
        "mkt_close": 4000 + np.cumsum(rng.normal(0, 10, n_days)),
        "vix_close": 20 + np.cumsum(rng.normal(0, 0.5, n_days)),
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
    assert body["sector"] == "Information Technology"


def test_response_includes_chart_history_and_signal(client):
    history = _fake_history(n_days=300)
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=history):
        body = client.get("/api/predict?ticker=AAPL").get_json()

    assert len(body["history"]) == 252  # capped at ~1 year of trading days
    assert body["history"][-1]["date"] == str(history["date"].max().date())
    assert all(set(p) == {"date", "close"} for p in body["history"])

    assert body["signal"]["verdict"] in ("no_edge", "weak_up", "weak_down", "lean_up", "lean_down")
    assert body["signal"]["label"]
    assert body["signal"]["detail"]


def test_forecast_extends_past_last_close(client):
    history = _fake_history(n_days=200)
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=history):
        body = client.get("/api/predict?ticker=AAPL").get_json()

    assert len(body["forecast"]) == 5
    last_actual = body["history"][-1]["date"]
    assert all(p["date"] > last_actual for p in body["forecast"])
    assert all(p["close"] > 0 for p in body["forecast"])
    # projected path moves in the predicted direction (0 drift allowed when
    # the probability is a near-coin-flip and rounding flattens the path)
    drift = body["forecast"][-1]["close"] - body["history"][-1]["close"]
    assert drift == 0 or (drift > 0) == (body["probability_up"] >= 0.5)


@pytest.mark.parametrize("horizon", ["1d", "1w", "1m"])
def test_all_horizons_served(client, horizon):
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=_fake_history(200)):
        body = client.get(f"/api/predict?ticker=AAPL&horizon={horizon}").get_json()
    assert body["horizon"] == horizon
    assert body["prediction"] in ("up", "down")
    assert len(body["forecast"]) == api_app.FORECAST_DAYS[horizon]


def test_invalid_horizon_is_400(client):
    with patch.object(api_app, "fetch_recent_ohlcv") as fetch:
        resp = client.get("/api/predict?ticker=AAPL&horizon=1y")
    assert resp.status_code == 400
    fetch.assert_not_called()


def test_explanation_present_and_bounded(client):
    with patch.object(api_app, "fetch_recent_ohlcv", return_value=_fake_history(200)):
        body = client.get("/api/predict?ticker=AAPL").get_json()
    assert 0 < len(body["explanation"]) <= 5
    for item in body["explanation"]:
        assert set(item) == {"feature", "impact", "scope"}
        assert item["scope"] in ("this_prediction", "model_global")


def test_metrics_endpoint(client):
    resp = client.get("/api/metrics")
    assert resp.status_code == 200
    assert "feature_columns" in resp.get_json()


def test_tickers_endpoint_serves_cached_constituents(client):
    fake = [{"symbol": "AAPL", "name": "Apple Inc."}, {"symbol": "MSFT", "name": "Microsoft"}]
    with patch.object(api_app, "get_sp500_constituents", return_value=fake) as fetch:
        first = client.get("/api/tickers").get_json()
        second = client.get("/api/tickers").get_json()
    assert first["tickers"] == fake
    assert second["tickers"] == fake
    fetch.assert_called_once()  # second hit comes from the TTL cache


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
    assert api_app.investment_signal(proba, "1d")["verdict"] == verdict


def test_investment_signal_never_says_invest_outright():
    for proba in np.linspace(0.0, 1.0, 101):
        signal = api_app.investment_signal(float(proba), "1w")
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
