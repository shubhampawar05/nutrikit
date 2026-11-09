# Proposal

## Why

Packaged foods (Amul butter, Parle-G, Kurkure, US branded products) are what Nutrikit's catalog lacks: USDA,
CoFID and INDB describe generic foods and home-cooked dishes. Barcode lookups already call the live Open Food Facts
API, but a scan of the full Open Food Facts export (4.9 million products) showed two accuracy problems in what is
served today:

- Open Food Facts mixes its own estimates into the same fields as label values (its added-sugar estimate from the
  ingredients, marked `~`), and Nutrikit serves them as if printed on the pack.
- About 3% of US products and 0.5% of Indian ones have labels that contradict themselves (per-serving figures typed
  as per 100 g, kJ typed as kcal: 969 kcal and 344 g of macronutrients per 100 g of cookies), and Nutrikit serves
  them unchecked.

The export (ODbL 1.0) also allows a local store: barcodes answered without the live API, and packaged products
searched by name.

## What Changes

- Barcode products use only label values: values Open Food Facts marks as calculated (`~`) are dropped; sodium is
  derived from salt (EU 1169/2011: salt = sodium x 2.5) where only salt is on the label.
- Label consistency checks; a product whose values contradict each other is returned with `per100g: {}` and
  `issues` saying why. Products cached before the checks are fetched again.
- New fields: `basis` (`100g` or `100ml`), `servingMl`, `issues`, `updatedAt`; `perServing` only when the serving
  is in the unit the values are per.
- `npm run build:packaged -w server -- <export.jsonl>` streams the export into `data/packaged.db` (gitignored):
  products sold in India or the US with a valid barcode, a name and checked label energy, protein, carbohydrate and
  fat. Barcode lookups read it first (`local: true`).
- `GET /v1/barcodes/search?q=&country=in|us` (1 token) searches it by name and brand; 503
  `packaged_foods_unavailable` where no store is loaded.

**Out of scope:** logging packaged foods from text ("1 packet parle-g"), SDK and playground support for the search
endpoint, shipping the store to the hosted service (it is built from an 80 GB export).

## Capabilities

### New Capabilities

- `packaged-foods`: label-only Open Food Facts values, consistency checks, the local store and its search.

## Impact

- **Server:** `src/domain/barcode.ts`, new `src/domain/packaged.ts`, `src/routes/v1.ts`, `src/schemas.ts`, new
  `scripts/build-packaged.mjs`, `package.json` (`build:packaged`), tests.
- **API:** additive fields and one new endpoint; withheld values for contradictory labels.
- **Docs:** `docs/api.md`, `docs/configuration.md`, website docs (v1.6), `CLEAN-ROOM.md`, OpenAPI.
