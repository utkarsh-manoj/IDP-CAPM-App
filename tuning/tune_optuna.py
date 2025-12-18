#!/usr/bin/env python3
# tuning/tune_optuna.py
#
# Updated: NONE-class handling integrated.
# Bayesian optimization (Optuna TPE) + k-fold CV tuner for invoice product description matcher
#
# Input:
#   tuning/labeled_training.csv      (query, expected_matnr)
#   tuning/product_master.csv        (matnr;verketten)
#
# Output:
#   tuning/best_params.json
#   tuning/matching_results.csv
#
# Run:
#   python3 tuning/tune_optuna.py --trials 80 --folds 5 --topk 80
#

import argparse
import json
import numpy as np
import optuna
import pandas as pd
from sklearn.model_selection import KFold
from sklearn.feature_extraction.text import CountVectorizer
from difflib import SequenceMatcher
import os
import math

# -----------------------------
# Normalization / Tokenization
# -----------------------------

STOP_WORDS = set([
    "info","info:","pos","pos.","menge","st","stk","st.","m","lfm","m2","qm","kg","liter",
    "art","art.","bezeichnung","="," :",":","x","beidseitig","nutzbar","langl","ca","ca.","inkl",
    "zzgl","breite","höhe","mm","cm","länge","farbe","und","mit","ohne","f.","f","für",
    "fürs","pro","a","b","das"
])

def normalize(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    s = s.replace("’","'").replace("`","'")
    # remove accents
    try:
        import unicodedata
        s = unicodedata.normalize("NFKD", s)
        s = "".join([c for c in s if not unicodedata.combining(c)])
    except:
        pass
    # keep german chars
    out = []
    for c in s:
        if c.isalnum() or c in [" ", "-", "/","ä","ö","ü","ß"]:
            out.append(c)
        else:
            out.append(" ")
    s = "".join(out)
    s = s.replace("-"," ").replace("/"," ")
    s = " ".join(s.split())
    return s

def tokenize(s: str):
    if not s: return []
    toks = normalize(s).split(" ")
    res = []
    for t in toks:
        t = t.strip()
        if len(t) < 2: continue
        if t in STOP_WORDS: continue
        res.append(t)
    return res

# -----------------------------
# Similarity metrics
# -----------------------------

def jaccard(a, b):
    A = set(a); B = set(b)
    if not A or not B: return 0.0
    return len(A & B) / len(A | B)

def dice(a, b):
    A = set(a); B = set(b)
    if not A or not B: return 0.0
    return (2 * len(A & B)) / (len(A) + len(B))

def cosine_sim(a, b):
    if not a or not b: return 0.0
    vec = CountVectorizer().fit([ " ".join(a), " ".join(b) ])
    m = vec.transform([ " ".join(a), " ".join(b) ])
    v1 = m[0].toarray()[0]
    v2 = m[1].toarray()[0]
    num = np.dot(v1, v2)
    den = math.sqrt(np.dot(v1, v1)) * math.sqrt(np.dot(v2, v2))
    if den == 0: return 0.0
    return num / den

def levenshtein_ratio(a, b):
    if not a or not b: return 0.0
    return SequenceMatcher(None, a, b).ratio()

def token_overlap(a, b):
    A = set(a); B = set(b)
    if not A or not B: return 0.0
    return len(A & B) / min(len(A), len(B))

# -----------------------------
# Inverted index prefilter
# -----------------------------

def build_inverted_index(master_df):
    inv = {}
    for _, row in master_df.iterrows():
        matnr = str(row["matnr"])
        toks = tokenize(row["verketten"])
        for t in toks:
            inv.setdefault(t, set()).add(matnr)
    return inv

def prefilter_candidates(query_tokens, inv_index, min_df=1):
    found_sets = []
    for t in query_tokens:
        if t in inv_index and len(inv_index[t]) >= min_df:
            found_sets.append(inv_index[t])

    if not found_sets:
        return None     # fallback → allow all
    candidates = set.union(*found_sets)
    return candidates

# -----------------------------
# Hybrid scoring
# -----------------------------

def hybrid_score(q_tokens, master_tokens, q_raw, master_raw, weights):
    t_score = token_overlap(q_tokens, master_tokens)
    j_score = jaccard(q_tokens, master_tokens)
    d_score = dice(q_tokens, master_tokens)
    c_score = cosine_sim(q_tokens, master_tokens)
    l_score = levenshtein_ratio(q_raw, master_raw)

    return (
        weights["token"]      * t_score +
        weights["jaccard"]    * j_score +
        weights["dice"]       * d_score +
        weights["cosine"]     * c_score +
        weights["levenshtein"]* l_score
    )

# -----------------------------
# Prediction
# -----------------------------

def predict_best_match(query, master_df, inv_index, params, topk=100):
    threshold = params["threshold"]
    weights = params["weights"]
    noneThreshold = params.get("noneThreshold", 0.35)

    q_raw = normalize(query)
    q_tokens = tokenize(query)

    candidates = prefilter_candidates(q_tokens, inv_index, params["invertedIndex"]["minDocFreq"])
    if candidates is None:
        sub = master_df
    else:
        sub = master_df[master_df["matnr"].isin(candidates)]

    scored = []
    for _, row in sub.iterrows():
        matnr = row["matnr"]
        v_raw = normalize(row["verketten"])
        v_tokens = tokenize(row["verketten"])
        sim = hybrid_score(q_tokens, v_tokens, q_raw, v_raw, weights)
        scored.append((matnr, sim, row["verketten"]))

    if not scored:
        return "NONE", 0.0, ""

    scored = sorted(scored, key=lambda x: x[1], reverse=True)[:topk]
    best = scored[0]
    matnr_best, score_best, match_text = best

    # If best score below noneThreshold -> NONE
    if score_best < noneThreshold:
        return "NONE", 0.0, ""
    # If best score >= noneThreshold but below runtime threshold, still return matnr (tuner decides threshold)
    return matnr_best, score_best, match_text

# -----------------------------
# Objective: k-fold CV with NONE handling
# -----------------------------

def objective(trial, train_df, master_df, inv_index, folds=5, topk=100):
    # Hyperparameters
    params = {
        "threshold": trial.suggest_float("threshold", 0.2, 0.9),
        "noneThreshold": trial.suggest_float("noneThreshold", 0.05, 0.5),
        "weights": {
            "token":       trial.suggest_float("w_token", 0.0, 1.0),
            "jaccard":     trial.suggest_float("w_jaccard", 0.0, 1.0),
            "dice":        trial.suggest_float("w_dice", 0.0, 1.0),
            "cosine":      trial.suggest_float("w_cosine", 0.0, 1.0),
            "levenshtein": trial.suggest_float("w_lev", 0.0, 1.0)
        },
        "invertedIndex": {
            "minDocFreq": trial.suggest_int("minDocFreq", 1, 3)
        }
    }

    # normalize weights
    ws = sum(params["weights"].values())
    for k in params["weights"]:
        params["weights"][k] /= ws

    kf = KFold(n_splits=folds, shuffle=True, random_state=42)
    f1_scores = []

    for train_index, test_index in kf.split(train_df):
        fold_df = train_df.iloc[test_index]
        tp = 0
        fp = 0
        fn = 0

        for _, r in fold_df.iterrows():
            query = r["query"]
            expected = str(r["expected_matnr"]).strip().upper() if pd.notna(r["expected_matnr"]) else ""
            pred, conf, _ = predict_best_match(query, master_df, inv_index, params, topk=topk)

            # Expected == NONE handling
            if expected == "NONE":
                if pred == "NONE":
                    tp += 1
                else:
                    fp += 1  # predicted real matnr when should be NONE
            else:
                if pred == expected:
                    tp += 1
                else:
                    if pred == "NONE":
                        fn += 1
                    else:
                        fp += 1

        # avoid division by zero
        precision = tp / (tp + fp + 1e-9)
        recall    = tp / (tp + fn + 1e-9)
        f1 = 2 * precision * recall / (precision + recall + 1e-9)
        f1_scores.append(f1)

    return np.mean(f1_scores)

# -----------------------------
# Main
# -----------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=60)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--topk", type=int, default=100)
    args = parser.parse_args()

    base = os.path.dirname(__file__)
    train_file = os.path.join(base, "labeled_training.csv")
    master_file = os.path.join(base, "product_master.csv")
    best_file = os.path.join(base, "best_params.json")
    results_file = os.path.join(base, "matching_results.csv")

    train_df = pd.read_csv(train_file, dtype=str)
    master_df = pd.read_csv(master_file, sep=";", dtype=str)

    inv_index = build_inverted_index(master_df)

    # OPTUNA
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler())
    study.optimize(
        lambda tr: objective(tr, train_df, master_df, inv_index, folds=args.folds, topk=args.topk),
        n_trials=args.trials
    )

    best = study.best_params
    print("Best params:", best)

    # Convert best params to final structure
    final_params = {
        "threshold": best["threshold"],
        "noneThreshold": best.get("noneThreshold", 0.35),
        "weights": {
            "token":       best["w_token"],
            "jaccard":     best["w_jaccard"],
            "dice":        best["w_dice"],
            "cosine":      best["w_cosine"],
            "levenshtein": best["w_lev"]
        },
        "invertedIndex": {
            "minDocFreq": best["minDocFreq"]
        }
    }

    # Weight normalization
    total = sum(final_params["weights"].values())
    for k in final_params["weights"]:
        final_params["weights"][k] /= total

    # Save best_params.json
    with open(best_file, "w") as f:
        json.dump(final_params, f, indent=2)

    # -------------------------------------------------------------
    # Produce full matching_results.csv across entire training set
    # -------------------------------------------------------------
    rows = []
    for _, r in train_df.iterrows():
        q = r["query"]
        expected = str(r["expected_matnr"]).strip().upper() if pd.notna(r["expected_matnr"]) else ""
        pred, conf, matched_text = predict_best_match(q, master_df, inv_index, final_params, topk=args.topk)

        rows.append({
            "query": q,
            "expected_matnr": expected,
            "predicted_matnr": pred if pred else "",
            "predicted_label_confidence": conf,
            "matched_text": matched_text
        })

    pd.DataFrame(rows).to_csv(results_file, index=False)
    print(f"Matching results written to {results_file}")
    print("Tuning complete → best_params.json saved.")

if __name__ == "__main__":
    main()