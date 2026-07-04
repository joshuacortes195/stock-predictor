# Stock Movement Predictor

A full-stack app where a user picks a stock ticker and gets a model-driven
prediction of its **direction** (up/down) over the next day, week, or month —
not a price forecast. Users can register and keep a persistent watchlist.
Built as a portfolio project to demonstrate defensible ML methodology end to
end: data → model → API → frontend.

## Architecture

Four layers:

1. **Model** — scikit-learn classifier trained on engineered technical
   features (returns, momentum, volatility, RSI, volume ratio) plus
   market-context features (S&P 500 index returns, VIX level/change,
   excess return over the index, day-of-week), evaluated with a
   chronological holdout and time-aware CV against naive baselines.
2. **API** — Flask service (`api/app.py`) that loads the trained per-horizon
   models and, given any ticker, fetches recent data live and returns a
   direction prediction + confidence + per-feature explanation.
3. **Accounts & watchlist** (`api/accounts.py`) — SQLite-backed users and
   per-user watchlists. Passwords are scrypt-hashed (Werkzeug); login state
   is a signed HttpOnly SameSite=Lax session cookie; every query is
   parameterized; auth endpoints are rate-limited; mutating endpoints
   require a JSON body (CSRF belt-and-braces on top of SameSite).
4. **Frontend** — React + TypeScript + Vite + Tailwind UI: ticker search
   with an accessible combobox, price chart, prediction cards, login/signup,
   and an infinite-scroll watchlist page.

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

Two auxiliary datasets add market context, also via `yfinance` so the same
features are computable live at serving time: the **S&P 500 index** (`^GSPC`
— market return, market volatility, and each stock's excess return over the
market) and the **CBOE Volatility Index** (`^VIX` — the market's forward
volatility expectation, level and 5-day change). Both join the stock panel
by date using only information available at or before each row's close.

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
├── data/                       # raw/processed data + app.db + secret key (all gitignored)
├── notebooks/
│   ├── 01_eda.ipynb            # data exploration, autocorrelation, class balance
│   └── 02_modeling.ipynb       # baselines, CV, final holdout evaluation
├── scripts/
│   ├── download_data.py        # fetches the S&P 500 panel via yfinance
│   ├── build_features.py       # builds the engineered feature panel
│   └── train_model.py          # CV model selection + single holdout evaluation
├── src/stock_predictor/        # data.py, features.py, model.py (reusable pipeline code)
├── models/                     # direction_model.joblib + metrics.json (committed — small, lets the API run without retraining)
├── tests/                      # leakage / feature-correctness / auth+watchlist tests (pytest)
├── api/
│   ├── app.py                  # Flask serving layer (predictions, metrics, tickers)
│   └── accounts.py             # users + watchlist: SQLite, scrypt hashing, sessions
└── frontend/                   # React + TS + Vite + Tailwind UI
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python scripts/download_data.py     # ~30s, fetches data/raw/sp500_panel.csv via yfinance
python scripts/train_model.py       # features + CV model selection + holdout eval, saves models/
pytest tests/ -q                    # leakage / correctness checks
```

`scripts/train_model.py` is the canonical training path (it regenerates
`models/direction_model_{1d,1w,1m}.joblib` and `models/metrics.json`); the
notebooks document the original EDA and Phase 3 modeling walkthrough.

### Run the API

```bash
python api/app.py    # http://127.0.0.1:5001, GET /api/predict?ticker=AAPL
```

The serving layer is hardened for a local demo: it binds to localhost with
the Werkzeug debugger off (opt back in with `FLASK_DEBUG=1`), validates the
ticker against a strict Yahoo-symbol pattern before any upstream fetch,
restricts CORS to the Vite dev origin (override with `CORS_ORIGINS`),
rate-limits per IP, and returns generic errors instead of tracebacks.
Dependencies are pinned in `requirements.txt` and audited with `pip-audit`.

Accounts live in `data/app.db` (SQLite, created on first run alongside a
0600 session-signing key at `data/.secret_key`; both gitignored), or in
Postgres when `DATABASE_URL` is set — see [Deployment](#deployment). Set
`SECRET_KEY` to override the key file and `COOKIE_SECURE=1` when serving
over TLS. Auth endpoints: `POST /api/auth/register|login|logout`,
`GET /api/auth/me`; watchlist: `GET/POST /api/watchlist`,
`DELETE /api/watchlist/<symbol>`, `GET /api/watchlist/symbols` —
all watchlist routes require a logged-in session and are scoped to it.

### Run the frontend

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173, proxies /api to the Flask server
```

## Deployment

The repo deploys as a single free-tier web service on
[Render](https://render.com) with accounts stored in a free
[Neon](https://neon.tech) Postgres database (Render's free disk is wiped on
every restart, so SQLite can't persist there). The multi-stage `Dockerfile`
builds the React app with Node, then serves everything from one gunicorn
process — same origin, so no CORS or cookie complications — and
`render.yaml` is a Render Blueprint describing the service.

1. **Neon** — create a free project, copy the *pooled* connection string
   (`postgresql://…-pooler…/neondb?sslmode=require`).
2. **Render** — New → Blueprint → point it at this GitHub repo. It reads
   `render.yaml`, generates a `SECRET_KEY`, and prompts for `DATABASE_URL`;
   paste the Neon string.
3. That's it: the app is live at `https://<service>.onrender.com`. The
   schema is created automatically on first boot.

Free-tier behavior: the service spins down after ~15 idle minutes and the
first request after that takes ~1 minute to wake. Production knobs, all via
env vars: `DATABASE_URL` (Postgres; unset = SQLite), `SECRET_KEY`,
`COOKIE_SECURE=1` (HTTPS-only cookies), `TRUST_PROXY=1` (honor
`X-Forwarded-For` from exactly one proxy hop so per-IP rate limiting sees
real client IPs), `CORS_ORIGINS` (only needed if the frontend is served
from a different origin).

## Results

The app serves three horizons (next day / week / month), each with its own
model selected by expanding-window CV and evaluated once on the chronological
holdout:

| Horizon | Majority baseline | Selected model | CV accuracy | Test accuracy | Test ROC-AUC |
|---|---|---|---|---|---|
| Next day (1d) | 0.520 | Logistic regression | 0.519 | 0.520 | 0.507 |
| Next week (1w) | 0.534 | Random forest | 0.549 | 0.531 | 0.521 |
| Next month (1m) | 0.554 | Random forest | 0.576 | 0.553 | 0.516 |

**No horizon beats its majority-class baseline on the holdout.** The longer
horizons carry marginally more rankable signal (ROC-AUC above 0.5) but the
headline is unchanged: predictions cluster near coin-flip, and the UI says so.
Note the baselines themselves rise with horizon — over a month most stocks
drift up, so "always predict up" gets harder to beat, not easier.

Next-day detail (the horizon studied most thoroughly):

Chronological holdout: trained on 2016-02 to 2024-05 (~1.01M rows), evaluated
once on 2024-05 to 2026-06 (~261k rows, never touched during training or CV).
The served model is selected by expanding-window CV on the training period
(date-based folds — see the leakage note below), then evaluated once on the
holdout.

| Model | CV accuracy (selection) | Test accuracy | Test ROC-AUC |
|---|---|---|---|
| Majority-class baseline | — | 0.520 | — |
| Persistence baseline ("same as yesterday") | — | 0.491 | — |
| Logistic regression *(selected & served)* | 0.519 | 0.520 | 0.507 |
| Random forest (depth-capped) | 0.519 | 0.521 | 0.521 |
| Hist. gradient boosting | 0.513 | 0.503 | 0.500 |

**No model meaningfully beats the naive majority-class baseline**, even after
adding market-context features (index returns, VIX, excess returns,
day-of-week). The market features did lift the random forest's ROC-AUC from
0.510 to 0.521 — a real but tiny amount of signal, nowhere near tradable.
Full metrics: `models/metrics.json`.

### A leakage bug worth documenting

The first CV run with market features showed gradient boosting at **65.7%
CV accuracy** — which promptly collapsed to 50.8% on the holdout. The cause:
`TimeSeriesSplit` on a multi-ticker panel sorted by *(ticker, date)* splits
by row position, not by date, so folds validated on calendar dates the model
had already seen through other tickers' rows. Date-synchronized features
(market return, VIX) act as a *date fingerprint*, letting a flexible model
memorize each date's market direction instead of learning anything
generalizable. The fix — folds defined on unique dates, so every validation
date is strictly after every training date — is enforced by a regression
test (`tests/test_model.py`). CV numbers above are from the fixed splitter;
the ~52% they show is the honest number.

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
