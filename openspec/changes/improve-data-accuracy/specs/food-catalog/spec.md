# Spec Delta

## Purpose

The read-only food catalog: which open sources it is built from, how they are combined, how missing or invalid values
are handled, and how dishes the sources lack are added as recipes.

## ADDED Requirements

### Requirement: Values come only from open sources or are absent
Every nutrient value the API returns SHALL come from USDA FoodData Central, Open Food Facts, a nutrition label the
caller supplied, or a recipe composed of USDA foods. A value no source provides SHALL be absent, never zero or
estimated.

#### Scenario: Open Food Facts null
- **WHEN** an Open Food Facts product has `null` for a nutrient
- **THEN** the barcode response omits that nutrient rather than reporting 0

#### Scenario: Open Food Facts energy missing
- **WHEN** an Open Food Facts product has neither a valid kcal nor a valid kJ value
- **THEN** the barcode response has no calories value

### Requirement: Invalid source values are corrected at build time
The catalog build SHALL store no negative nutrient amount. A negative source amount SHALL be stored as 0, and the build
SHALL record how many values it corrected.

#### Scenario: By-difference carbohydrate below zero
- **WHEN** a USDA food lists carbohydrate as −0.47 g per 100 g
- **THEN** the catalog stores 0 g

### Requirement: Same-name foods keep the most complete record
When two source datasets contain a food with the same name, the catalog SHALL keep the record with values for more
nutrients, preferring Foundation, then survey, then SR Legacy on a tie. It SHALL NOT combine values from the two
records into one food.

#### Scenario: Collision with equal coverage
- **WHEN** Foundation and survey both list "Broccoli, raw" with the same number of nutrients
- **THEN** the Foundation record is kept

#### Scenario: Collision with unequal coverage
- **WHEN** the survey record has more nutrients than the Foundation record of the same name
- **THEN** the survey record is kept, with only its own values

### Requirement: Dry-yield portions are not used as volumes
A portion describing the cooked yield of a dry measure ("1 cup, dry, yields") SHALL NOT be used to convert a volume
the caller gave into grams.

#### Scenario: A cup of barley
- **WHEN** a caller logs "1 cup barley"
- **THEN** the grams are those of a cup of the food, not the 740 g yield of a cup of dry barley

### Requirement: Missing dishes are added as recipes of USDA foods
A dish the sources lack MAY be added as a recipe: USDA catalog foods with gram weights, a cooked weight and household
portions, written for this project. Its nutrients SHALL be the ingredient sum scaled to the cooked weight, and it SHALL
be identified with source `recipe`. The build SHALL fail if a recipe refers to a food the catalog does not have, or if
its composed values fail the catalog sanity checks.

#### Scenario: Logging a recipe dish
- **WHEN** a caller logs "1 cup rajma"
- **THEN** the item is the rajma recipe food with source "recipe" and its nutrients scaled from its per-100 g values

#### Scenario: A recipe refers to a missing food
- **WHEN** a recipe lists an ingredient id that is not in the catalog
- **THEN** the catalog build fails and names the recipe and the id

### Requirement: Documented coverage matches the catalog
The API documentation SHALL state which nutrients each source covers and how missing values are reported, and SHALL
NOT claim that every food has every nutrient.

#### Scenario: Reading the docs
- **WHEN** a developer reads the nutrient section of the API docs
- **THEN** it shows coverage by source and explains `missingFrom` and absent keys
