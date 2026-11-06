# Spec Delta

## Purpose

The read-only food catalog: which open sources it is built from, how they are combined, how missing or invalid values
are handled, and how dishes the sources lack are added as recipes.

## ADDED Requirements

### Requirement: Values come only from open sources or are absent
Every nutrient value the API returns SHALL come from USDA FoodData Central, Open Food Facts, a nutrition label the
caller supplied, or a recipe of USDA foods from a licensed source. A value no source provides SHALL be absent, never zero or
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
Nutrition Facts label nutrients (calories, protein, fat, carbohydrate, fiber, sugars, saturated fat, cholesterol,
sodium, potassium, calcium, iron, vitamin D), preferring Foundation, then survey, then SR Legacy on a tie. It SHALL
NOT combine values from the two records into one food.

#### Scenario: Collision with equal label coverage
- **WHEN** Foundation and SR Legacy both list "Pears, raw, bartlett (…)" with the same label nutrients
- **THEN** the Foundation record is kept

#### Scenario: Collision with unequal label coverage
- **WHEN** the Foundation record of "Kiwifruit, green, raw" lacks label nutrients that the SR Legacy record has
- **THEN** the SR Legacy record is kept, with only its own values

### Requirement: Dry-yield portions are not used as volumes
A portion describing the cooked yield of a dry measure ("1 cup, dry, yields") SHALL NOT be used to convert a volume
the caller gave into grams.

#### Scenario: A cup of barley
- **WHEN** a caller logs "1 cup barley"
- **THEN** the grams are those of a cup of the food, not the 740 g yield of a cup of dry barley

### Requirement: Recipe dishes come only from licensed sources
A dish the sources lack MAY be added as a recipe of USDA catalog foods only when the recipe names its verifiable source,
licence and URL. The build SHALL fail on a recipe that does not. Until such a recipe exists, a dish the sources lack
SHALL be unmatched.

#### Scenario: A recipe without a source
- **WHEN** a recipe file has no source name, licence and URL
- **THEN** the catalog build fails and names the recipe

#### Scenario: A dish no source has
- **WHEN** a caller logs "1 cup rajma" and no USDA food or sourced recipe is rajma
- **THEN** the phrase is listed as unmatched

### Requirement: Recipes are composed from their ingredients
A recipe's nutrients SHALL be the sum of its USDA ingredients scaled to its cooked weight, and it SHALL be identified
with source `recipe`. The build SHALL fail if a recipe refers to a food the catalog does not have, or if its composed
values fail the catalog sanity checks.

#### Scenario: A recipe refers to a missing food
- **WHEN** a recipe lists an ingredient id that is not in the catalog
- **THEN** the catalog build fails and names the recipe and the id

### Requirement: Documented coverage matches the catalog
The API documentation SHALL state which nutrients each source covers and how missing values are reported, and SHALL
NOT claim that every food has every nutrient.

#### Scenario: Reading the docs
- **WHEN** a developer reads the nutrient section of the API docs
- **THEN** it shows coverage by source and explains `missingFrom` and absent keys
