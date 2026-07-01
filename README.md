# Stock Movement Predictor

A full-stack app where a user picks a stock ticker and gets a model-driven
prediction of its next-day **direction** (up/down) — not a price forecast.
Built as a portfolio project to demonstrate defensible ML methodology end to
end: data → model → API → frontend.

## Architecture

Three layers:

1. **Model** — scikit-learn classifier trained on engineered technical
   features (returns, momentum, volatility, RSI, volume ratio), evaluated
   with a chronological holdout and time-aware CV against naive baselines.
2. **API** — Flask service (`api/app.py`) that loads the trained model and,
   given any ticker, fetches recent data live and returns a direction
   prediction + confidence.
3. **Frontend** — React + TypeScript + Vite + Tailwind UI to query the API
   and visualize predictions.

## Why direction, not price

Raw stock price levels are dominated by autocorrelation — a model that just
echoes yesterday's price looks deceptively accurate. The EDA notebook
(`notebooks/01_eda.ipynb`) confirms this directly: daily closing price has
~0.999 lag-1 autocorrelation (trivial but useless), while daily *returns*
are close to zero autocorrelation. So this project predicts **next-day
direction** instead, uses a **chronological** train/test split (never
shuffled), and constrains every feature to only use information available
at or before the prediction time (no lookahead leakage — enforced by
`tests/test_features.py`). Every model is compared against naive baselines
(majority class, "same direction as yesterday") — see [Results](#results).

## Data

The original plan was to train on Kaggle's `camnugent/sandp500` dataset, but
no Kaggle API credentials were available. Instead, training data comes
directly from **[`yfinance`](https://pypi.org/project/yfinance/)**: daily
OHLCV for 499 of the 503 current S&P 500 constituents (4 recent additions
had too little history), 2016-01 to 2026-06, pooled across tickers so the
model learns generalizable patterns rather than one stock's quirks. No API
credentials needed, and the same library is reused for live serving.

For serving, the API fetches ~9 months of recent OHLCV live via `yfinance`
for whatever ticker the user requests, so predictions work for **any**
ticker — including ones outside the S&P 500 training set. Verified working
for `QSI` (Quantum-Si — a small-cap, not in the S&P 500) and `QCOM`
(Qualcomm — in the S&P 500). **Caveat:** since evaluation data only covers
S&P 500 names, accuracy on tickers well outside that distribution (like
QSI) is unverified — the API surfaces this caveat in every response.

## Repo structure

```
stock-predictor/
├── data/                       # raw/processed data (gitignored)
├── notebooks/
│   ├── 01_eda.ipynb            # data exploration, autocorrelation, class balance
│   └── 02_modeling.ipynb       # baselines, CV, final holdout evaluation
├── scripts/
│   ├── download_data.py        # fetches the S&P 500 panel via yfinance
│   └── build_features.py       # builds the engineered feature panel
├── src/stock_predictor/        # data.py, features.py, model.py (reusable pipeline code)
├── models/                     # direction_model.joblib + metrics.json (committed — small, lets the API run without retraining)
├── tests/                      # leakage / feature-correctness tests (pytest)
├── api/app.py                  # Flask serving layer
└── frontend/                   # React + TS + Vite + Tailwind UI
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python scripts/download_data.py     # ~30s, fetches data/raw/sp500_panel.csv via yfinance
python scripts/build_features.py    # builds data/processed_features.csv
pytest tests/ -q                    # leakage / correctness checks
```

Re-running the notebooks (`jupyter nbconvert --to notebook --execute --inplace notebooks/*.ipynb`)
regenerates `models/direction_model.joblib` and `models/metrics.json` from scratch.

### Run the API

```bash
python api/app.py    # http://127.0.0.1:5001, GET /api/predict?ticker=AAPL
```

### Run the frontend

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173, proxies /api to the Flask server
```

## Results

Chronological holdout: trained on 2016-02 to 2024-05 (~1.01M rows), evaluated
once on 2024-05 to 2026-06 (~261k rows, never touched during training or CV).

| Model | Accuracy | ROC-AUC |
|---|---|---|
| Majority-class baseline | 0.520 | — |
| Persistence baseline ("same as yesterday") | 0.491 | — |
| Logistic regression *(served)* | 0.519 | 0.507 |
| Random forest (depth-capped) | 0.520 | 0.510 |

**Neither model beats the naive majority-class baseline.** ROC-AUC barely
clears 0.50 for both. Full metrics: `models/metrics.json`; full walkthrough
with 5-fold expanding-window time-series CV: `notebooks/02_modeling.ipynb`.

## Limitations

- **The model does not predict market direction better than chance**, given
  only daily OHLCV-derived technical features. This is consistent with the
  near-zero return autocorrelation observed in the EDA and with the
  efficient-market-hypothesis expectation — not a bug to be tuned away.
- High recall (~0.95-0.97) in the results table is an artifact of both
  models leaning toward predicting "up" (the pooled class balance is itself
  slightly up-skewed, ~52%), not genuine predictive skill — precision stays
  near the base rate.
- Training data covers S&P 500 constituents only; accuracy on very different
  tickers (illiquid small-caps, newly-listed names, etc.) is unverified,
  even though the API will happily return a prediction for any ticker.
- **This is an educational demo, not investment advice**, and should not be
  used to make real trading decisions.
