# Spec Delta

## ADDED Requirements

### Requirement: Unlicensed data stays in a personal catalog
Data without a licence SHALL be built only into the gitignored personal catalog, never into the committed catalog,
the container image or the deployed service. The build SHALL refuse to write it into the committed catalog.

#### Scenario: Normal build
- **WHEN** the catalog is built without the personal option
- **THEN** it contains no INDB foods and no INDB metadata

#### Scenario: Personal build
- **WHEN** the catalog is built with the personal option
- **THEN** a separate personal catalog file contains the INDB dishes with source "indb" and the reason for every skipped dish

### Requirement: INDB dishes are recomputed from their ingredients
An INDB dish SHALL be composed from its ingredients mapped to catalog foods, adding the water dry pulses and grains
absorb (from USDA's raw and cooked forms) when the recipe lists less. A deep-fried dish, or one where an unmapped
ingredient is 2% or more of the dish, SHALL be skipped, not estimated.

#### Scenario: Rajma
- **WHEN** INDB's kidney bean curry lists dry beans and no water
- **THEN** its composed value per 100 g accounts for the water the beans absorb

#### Scenario: Deep frying
- **WHEN** a recipe lists a cup or more of oil for frying
- **THEN** the dish is skipped with the reason recorded

### Requirement: An exactly named food leads search
A food named exactly what was searched (by its name's head or a cited alias) SHALL lead the results; a USDA food so
named SHALL lead over CoFID and INDB foods; otherwise a CoFID or INDB food SHALL lead only when no USDA food matched.

#### Scenario: Roti in the personal catalog
- **WHEN** a caller logs "2 rotis"
- **THEN** the item is USDA's chapati, not a speciality INDB roti
