"""End-to-end training: features -> CV model selection -> one test evaluation.

Selection happens on expanding-window CV over the TRAINING period only; the
chronological test set is touched exactly once, by the selected model (plus a
reference row for the others so the README table stays honest about what was
selected and why).

Usage:
    python scripts/train_model.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import joblib
import numpy as np

from stock_predictor.data import fetch_market_context, load_panel
from stock_predictor.features import FEATURE_COLUMNS, build_feature_panel
from stock_predictor.model import (
    build_models,
    chronological_split,
    evaluate,
    get_X_y,
    naive_baselines,
    time_series_cv_scores,
)

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    panel = load_panel(str(ROOT / "data" / "raw" / "sp500_panel.csv"))
    start = str(panel["date"].min().date())
    end = str(panel["date"].max().date())
    print(f"Fetching market context (^GSPC, ^VIX) {start}..{end}")
    market = fetch_market_context(start=start, end=end)

    print("Building feature panel...")
    features = build_feature_panel(panel, market)
    features.to_csv(ROOT / "data" / "processed_features.csv", index=False)
    print(f"  {features.shape[0]} rows x {len(FEATURE_COLUMNS)} features")

    train_df, test_df = chronological_split(features, test_frac=0.2)
    X_train, y_train = get_X_y(train_df)
    X_test, y_test = get_X_y(test_df)

    print("Model selection via expanding-window CV on the training period:")
    models = build_models()
    cv_scores = {}
    for name, model in models.items():
        scores = time_series_cv_scores(model, X_train, y_train, train_df["date"])
        cv_scores[name] = scores
        print(f"  {name}: CV acc {np.mean(scores):.4f} ({[round(s, 4) for s in scores]})")

    selected = max(cv_scores, key=lambda n: np.mean(cv_scores[n]))
    print(f"Selected by CV: {selected}")

    print("Final fit + single test evaluation...")
    test_metrics = {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        test_metrics[name] = evaluate(model, X_test, y_test)
        print(f"  {name}: {test_metrics[name]}")

    metrics = {
        "feature_columns": FEATURE_COLUMNS,
        "train_date_range": [str(train_df["date"].min().date()), str(train_df["date"].max().date())],
        "test_date_range": [str(test_df["date"].min().date()), str(test_df["date"].max().date())],
        "n_train_rows": int(len(train_df)),
        "n_test_rows": int(len(test_df)),
        "baselines": naive_baselines(train_df, test_df),
        "selected_model": selected,
        "selection_rule": "highest mean expanding-window CV accuracy on the training period",
        "cv_accuracy_by_model": cv_scores,
        "test_metrics_by_model": test_metrics,
    }
    with open(ROOT / "models" / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    joblib.dump(models[selected], ROOT / "models" / "direction_model.joblib")
    print(f"Saved models/direction_model.joblib ({selected}) and models/metrics.json")


if __name__ == "__main__":
    main()
