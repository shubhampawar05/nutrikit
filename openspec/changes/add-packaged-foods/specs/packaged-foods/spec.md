# Spec Delta

## ADDED Requirements

### Requirement: Packaged products carry label values only
A barcode product SHALL report only nutrient values printed on the label. Values Open Food Facts calculated itself
SHALL be absent.

#### Scenario: Estimated added sugars
- **WHEN** Open Food Facts gives added sugars with the `~` modifier
- **THEN** the product has no `addedSugar` value

### Requirement: Contradictory labels are withheld
A product whose label values contradict each other SHALL be returned with empty `per100g`, no `perServing`, and
`issues` naming each contradiction.

#### Scenario: Per-serving values typed as per 100 g
- **WHEN** a product lists 960 kcal, 32 g protein, 240 g carbohydrate and 112 g fat per 100 g
- **THEN** `per100g` is `{}` and `issues` is not empty

### Requirement: A local export answers barcodes and searches
When a packaged-foods store is loaded, barcode lookups SHALL read it before the live API, and
`GET /v1/barcodes/search` SHALL return its products matching every word of the query. Without a store the search
SHALL answer 503 `packaged_foods_unavailable` and charge nothing.

#### Scenario: Searching a brand
- **WHEN** a caller searches "parle" with `country=in` and the store is loaded
- **THEN** the results are Parle products sold in India

#### Scenario: No store
- **WHEN** the server has no store loaded
- **THEN** the search answers 503 and no tokens are charged
