"""Training, time-aware evaluation, and naive baselines for direction prediction.

Chronological split only (never random-shuffle time series): all rows dated
before the cutoff are train, everything from the cutoff onward is test.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from stock_predictor.features import FEATURE_COLUMNS


def chronological_split(df: pd.DataFrame, test_frac: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split by a date cutoff, not row count — every ticker's test rows share
    the same date range, so no future dates leak into training via another
    ticker's row order."""
    dates = np.sort(df["date"].unique())
    cutoff = dates[int(len(dates) * (1 - test_frac))]
    return df[df["date"] < cutoff].copy(), df[df["date"] >= cutoff].copy()


def naive_baselines(train_df: pd.DataFrame, test_df: pd.DataFrame) -> dict[str, float]:
    """Two baselines every real model must beat on the held-out test set."""
    majority_class = train_df["target_next_up"].mean() >= 0.5
    majority_acc = accuracy_score(
        test_df["target_next_up"], np.full(len(test_df), majority_class)
    )
    # "Tomorrow moves the same direction as today" (today's realized return sign).
    persistence_pred = (test_df["ret_0"] > 0).astype(int)
    persistence_acc = accuracy_score(test_df["target_next_up"], persistence_pred)
    return {"majority_class_baseline": majority_acc, "persistence_baseline": persistence_acc}


def build_models() -> dict[str, Pipeline]:
    return {
        "logistic_regression": Pipeline([
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(max_iter=1000, C=1.0)),
        ]),
        "random_forest": Pipeline([
            ("clf", RandomForestClassifier(
                n_estimators=300, max_depth=6, min_samples_leaf=200,
                n_jobs=-1, random_state=42,
            )),
        ]),
        # Histogram gradient boosting: usually the strongest tabular baseline
        # (MLU decision-tree track). Depth/leaf caps guard against overfitting
        # the noisy target; early stopping is OFF because its internal
        # validation split is shuffled, which mixes dates within the training
        # slice — a chronological no-no in a panel with date-shared features.
        "hist_gradient_boosting": Pipeline([
            ("clf", HistGradientBoostingClassifier(
                max_depth=4, min_samples_leaf=500, learning_rate=0.05,
                max_iter=300, early_stopping=False,
                random_state=42,
            )),
        ]),
    }


def time_series_cv_scores(
    model: Pipeline, X: pd.DataFrame, y: pd.Series, dates: pd.Series, n_splits: int = 5
) -> list[float]:
    """Expanding-window CV on the training period only (model selection, not
    final evaluation), with folds defined on UNIQUE DATES, not row positions.

    In a multi-ticker panel, row-position splits (plain TimeSeriesSplit on X)
    leak: rows are grouped by ticker, so a "later" fold contains dates the
    model already saw via other tickers' rows, and date-synchronized features
    (market return, VIX) let a flexible model fingerprint the date and recall
    its outcome. Splitting the date axis ensures every validation date is
    strictly after every training date.
    """
    unique_dates = np.sort(pd.Series(dates.unique()).to_numpy())
    tscv = TimeSeriesSplit(n_splits=n_splits)
    scores = []
    for train_idx, val_idx in tscv.split(unique_dates):
        train_mask = dates.isin(unique_dates[train_idx]).to_numpy()
        val_mask = dates.isin(unique_dates[val_idx]).to_numpy()
        model.fit(X[train_mask], y[train_mask])
        preds = model.predict(X[val_mask])
        scores.append(accuracy_score(y[val_mask], preds))
    return scores


def evaluate(model: Pipeline, X_test: pd.DataFrame, y_test: pd.Series) -> dict[str, float]:
    preds = model.predict(X_test)
    proba = model.predict_proba(X_test)[:, 1]
    return {
        "accuracy": accuracy_score(y_test, preds),
        "precision": precision_score(y_test, preds),
        "recall": recall_score(y_test, preds),
        "f1": f1_score(y_test, preds),
        "roc_auc": roc_auc_score(y_test, proba),
    }


def get_X_y(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    return df[FEATURE_COLUMNS], df["target_next_up"].astype(int)
