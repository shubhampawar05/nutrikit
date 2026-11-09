# Tasks

## 1. Label values and checks

- [x] 1.1 `fromOpenFoodFacts`: drop `~` values, sodium from salt, `basis`, `servingMl`, `issues`, `updatedAt`; `labelIssues` with per-serving rounding allowance
- [x] 1.2 Refetch cached products that predate the checks; tests in `test/packaged.test.mjs` and `test/api.test.mjs`

## 2. Store

- [x] 2.1 `scripts/build-packaged.mjs`: streamed export, country pre-filter, label sources, skip reasons, FTS, refuses `foods.db`
- [x] 2.2 `src/domain/packaged.ts`: barcode (UPC/EAN forms) and search; lookup reads the store first
- [x] 2.3 Fixture build test; full build from the export, counts reviewed
- [x] 2.4 Compact layout; live set (`data/packaged.db`, committed, in the Docker image) and `--all` full set
- [x] 2.5 Search collapses duplicate barcodes (`barcodes`); non-Latin names searchable only when sold in India
- [x] 2.6 Test over the committed store: live set only, every row passes the label checks; ODbL notice

## 3. API and docs

- [x] 3.1 `GET /v1/barcodes/search`, schemas, OpenAPI
- [x] 3.2 `docs/api.md`, `docs/configuration.md`, website docs v1.6, `CLEAN-ROOM.md`
