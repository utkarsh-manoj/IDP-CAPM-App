# Getting Started

Welcome to your new project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`package.json` | project metadata and configuration
`readme.md` | this getting started guide


## Next Steps

- Open a new terminal and run `cds watch`
- (in VS Code simply choose _**Terminal** > Run Task > cds watch_)
- Start adding content, for example, a [db/schema.cds](db/schema.cds).


## Learn More

Learn more at https://cap.cloud.sap/docs/get-started/.


# BMI IDP EXTRACTION CAP – v1.0

This project provides:
- CAP service for invoice ingestion, Doc AI extraction, product description validation, redaction.
- Background DOX polling worker queue.
- Hybrid similarity engine (token + cosine + jaccard + dice + levenshtein).
- Product Master stored in HANA (with dynamic Verketten generation).
- Auto-sync to /tuning/product_master.csv and local JSON cache.
- End-to-end hyperparameter tuning pipeline using Optuna (Bayesian + k-fold CV).
- best_params.json auto-loaded at startup → persisted into HANA Config.

### Key Commands
Refresh product master:
    npm run refresh:products

Run tuning pipeline:
    npm run tune

Generate testcases.json automatically:
    npm run gen:testcases

### Data locations
- `tuning/labeled_training.csv` → Business-provided ground truth
- `tuning/product_master.csv` → Latest refreshed dataset
- `tuning/best_params.json` → Production similarity weights
- `srv/utils/__cache/product_master.json` → Optimized memory index


