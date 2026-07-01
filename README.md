# Stock Movement Predictor

A full-stack app where a user picks a stock ticker and gets a model-driven
prediction of its next-period **direction** (up/down) — not a price forecast.
Built as a portfolio project to demonstrate defensible ML methodology end to
end: data → model → API → frontend.

## Architecture

Three layers:

1. **Model** — scikit-learn classifier trained on engineered technical
   features (returns, momentum, volume ratios, etc.), evaluated with
   time-aware validation against naive baselines.
2. **API** — Flask service that loads the trained model and, given a ticker,
   returns a direction prediction + confidence.
3. **Frontend** — React + TypeScript + Vite + Tailwind UI to query the API
   and visualize predictions.

## Why direction, not price

Raw stock price levels are dominated by autocorrelation — a model that just
echoes yesterday's price looks deceptively accurate. This project predicts
**direction/returns** instead, uses a **chronological** train/test split
(never shuffled), and constrains every feature to only use information
available at or before the prediction time (no lookahead leakage). Every
model is compared against naive baselines (e.g. "same as yesterday",
majority class) — see [Results](#results) once Phase 3 lands.

## Data

Training data: Kaggle [`camnugent/sandp500`](https://www.kaggle.com/datasets/camnugent/sandp500)
— daily OHLCV for all S&P 500 constituents, 2013-2018, pooled across tickers
so the model learns generalizable patterns rather than one stock's quirks.

For serving, the API fetches recent OHLCV live via
[`yfinance`](https://pypi.org/project/yfinance/) so predictions work for
**any** ticker a user requests — including ones outside the S&P 500 training
set (e.g. small-caps). Caveat: since evaluation data only covers S&P 500
names, accuracy on tickers well outside that distribution is unverified —
this will be called out explicitly once serving is live.

## Repo structure

```
stock-predictor/
├── data/                  # raw/processed data (gitignored, fetched via scripts/download_data.py)
├── notebooks/             # EDA notebooks
├── scripts/
│   └── download_data.py   # pulls the Kaggle dataset
├── src/stock_predictor/   # data loading, feature engineering, training, evaluation
├── models/                # trained model artifacts (gitignored)
├── tests/                 # feature engineering / leakage tests
├── api/                   # Flask serving layer (added in Phase 4)
└── frontend/              # React + TS + Vite + Tailwind UI (added in Phase 5)
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Kaggle API credentials: place your `kaggle.json` (from
kaggle.com → Account → Create New API Token) at `~/.kaggle/kaggle.json`,
then:

```bash
python scripts/download_data.py
```

## Status

- [x] Phase 0 — repo scaffolding
- [ ] Phase 1 — data + EDA
- [ ] Phase 2 — feature engineering
- [ ] Phase 3 — model training + evaluation
- [ ] Phase 4 — Flask serving API
- [ ] Phase 5 — React frontend
- [ ] Phase 6 — polish (final methodology, results, and limitations writeup)

## Results

_Not yet available — filled in after Phase 3._

## Limitations

_Not yet available — filled in as each phase lands. This project does not
claim to predict markets reliably; the goal is a methodologically honest
demonstration, not a trading signal._
