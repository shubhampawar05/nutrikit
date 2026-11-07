# Spec Delta

## ADDED Requirements

### Requirement: CoFID composite dishes are in the catalog
The catalog SHALL include the foods in the groups CoFID 2021 names as dishes (DR, MR, JR, CD, CDE, CDH) with source
`cofid`, read from the gov.uk workbook whose checksum the build pins. The build SHALL refuse a workbook with any
other checksum.

#### Scenario: Logging a CoFID dish
- **WHEN** a caller logs "1 cup red kidney bean curry"
- **THEN** the item is a CoFID food with source "cofid"

#### Scenario: A different workbook
- **WHEN** the CoFID file under the raw data folder has a different checksum
- **THEN** the catalog build fails and names the expected checksum

### Requirement: CoFID values follow Nutrikit's nutrient definitions
A CoFID value SHALL be reported only as published where the definitions match, by an exact formula where one
exists, or by the documented carbohydrate and sugar conversion. A value with no exact or documented conversion
SHALL be absent.

#### Scenario: Folate
- **WHEN** a CoFID dish is returned
- **THEN** it has no folate value, since CoFID's total folate cannot be converted to folate DFE

#### Scenario: Not determined
- **WHEN** CoFID marks a nutrient `N` for a dish
- **THEN** that nutrient is absent for the dish

#### Scenario: Fibre
- **WHEN** a CoFID dish has NSP fibre but no AOAC fibre
- **THEN** it has no fiber value

### Requirement: Dish names in other languages are cited aliases
A food MAY carry aliases in other languages only from the reviewed alias list, where each alias names its CoFID
food by code and name and gives a public reference. The build SHALL fail on an alias without a reference or whose
code and name do not match the workbook. A query equal to an alias SHALL match that food.

#### Scenario: Rajma
- **WHEN** a caller logs "1 cup rajma"
- **THEN** the item is the CoFID red kidney bean curry the alias names
