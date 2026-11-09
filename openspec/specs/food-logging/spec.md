# food-logging Specification

## Purpose
Turns what people type or say about a meal into matched foods with quantities, portions, grams and nutrients,
reading everyday phrases the way a person would and never inflating a meal through an implausible portion.

## Requirements

### Requirement: Meal text is split into foods with quantities
Logging text SHALL split a meal description into one item per food. Each item SHALL carry the phrase it came from,
the matched food, the quantity and unit the user gave (or a default when none), its grams, nutrients, a confidence
and up to three alternatives. Phrases that match no food SHALL be listed as unmatched rather than guessed. A phrase
that no food matches on all of its words, and whose best partial match shares no more than half of its words, SHALL
also be listed as unmatched, with suggested foods that share some of its words, and SHALL NOT count toward the totals.

#### Scenario: Several foods with counts
- **WHEN** a caller logs "2 eggs, toast with butter and an orange juice"
- **THEN** four items come back, the eggs with quantity 2 and unit "egg", and the totals equal the sum of the items

#### Scenario: Nothing recognisable
- **WHEN** a caller logs "asdfgh qwerty"
- **THEN** no items are returned, the phrase is listed as unmatched, and the totals are empty

#### Scenario: A dish the catalog lacks
- **WHEN** a caller logs "1 cup butter chicken" and no food has both words
- **AND** the best partial match (butter) covers only half of them
- **THEN** the phrase is listed as unmatched with suggestions, and no item for it is counted in the totals

### Requirement: Unquantified add-ons get a plausible serving
A food added to another without its own amount ("with sugar", "with milk", "with honey") SHALL be sized as a
typical add-on serving: at most 15 g for sugars, sweeteners, fats and oils, and at most 60 g for other add-ons.
Within that cap, the food's own small household portion SHALL be preferred.

#### Scenario: Sugar in tea
- **WHEN** a caller logs "a cup of tea with sugar"
- **THEN** the sugar item is between 3 g and 15 g, not a cup of sugar

#### Scenario: Milk in coffee
- **WHEN** a caller logs "coffee with milk"
- **THEN** the milk item is between 15 g and 60 g

#### Scenario: Stated amount wins
- **WHEN** a caller logs "tea with 2 tbsp sugar"
- **THEN** the sugar item is two tablespoons of sugar, whatever the add-on cap

### Requirement: Bare everyday words match the everyday food
A bare common name SHALL match the food people usually mean. "tea" SHALL match hot black tea, "chai" SHALL match hot
tea with milk, "salad" SHALL match a green or garden salad when the catalog has one and otherwise lettuce, and none of
these SHALL match iced, branded or meat-based variants unless the words say so.

#### Scenario: Tea
- **WHEN** a caller logs "tea"
- **THEN** the item is a hot tea, not iced tea

#### Scenario: Chai
- **WHEN** a caller logs "a cup of chai"
- **THEN** the item is hot tea with milk, not plain black tea or a branded soy drink

#### Scenario: Salad
- **WHEN** a caller logs "a salad"
- **THEN** the item is a green salad or lettuce, not a beef, chicken or ham salad

#### Scenario: Words that ask for a variant
- **WHEN** a caller logs "iced tea" or "chicken salad"
- **THEN** the iced or chicken variant is matched

### Requirement: Hot drinks without a size default to one cup
A hot drink named without an amount (tea, coffee, hot chocolate) SHALL be sized as one cup (about 240 ml), not a
café size or a bottle.

#### Scenario: Plain tea
- **WHEN** a caller logs "tea"
- **THEN** the item is 1 cup, about 240 g

### Requirement: Size words get realistic servings
A size word (small, medium, large) on a food that has no portion of that size SHALL use a typical serving for that
size when one is known for the food, and otherwise the food's default portion. The result SHALL never be smaller for
"large" than for "medium", or for "medium" than for "small".

#### Scenario: Medium fries
- **WHEN** a caller logs "medium fries"
- **THEN** the fries item is between 100 g and 140 g

#### Scenario: Sizes are ordered
- **WHEN** a caller logs "small fries", "medium fries" and "large fries"
- **THEN** the grams increase from small to medium to large

### Requirement: Search does not repeat the same food
Food search SHALL NOT return two results that are the same food from different data sources (names equal after
normalising word order, punctuation and brand). The generic, as-eaten entry SHALL be kept and the others dropped.

#### Scenario: Greek yogurt
- **WHEN** a caller searches for "greek yogurt"
- **THEN** "whole milk, plain" Greek yogurt appears once among the results

### Requirement: Search matches whole words before prefixes
Food search SHALL first look for foods containing every query word as a whole word, and SHALL use prefix matching only
when that finds nothing.

#### Scenario: A word that is the prefix of another
- **WHEN** a caller logs "1 cup chole"
- **THEN** the item is not a food matched only through a longer word such as "cholesterol"

#### Scenario: Partial typing still works
- **WHEN** a caller searches for "chick"
- **THEN** chicken or chickpea foods are returned

### Requirement: Inverted catalog names match their food
When a catalog name begins with a category word ("Fish, salmon, …", "Cheese, paneer"), a query for the food SHALL
match it as readily as a name that begins with the food.

#### Scenario: Salmon
- **WHEN** a caller logs "100 g salmon"
- **THEN** the item is a plain salmon food, not canned or smoked salmon

#### Scenario: Paneer
- **WHEN** a caller logs "100 g paneer"
- **THEN** the item is paneer cheese, not a paneer dish

### Requirement: Regional food words match the regional food
Common Indian English food words SHALL match what they mean in India: "curd" and "dahi" SHALL match plain yogurt.
"bean curd" SHALL still match tofu.

#### Scenario: Curd
- **WHEN** a caller logs "1 cup curd"
- **THEN** the item is a plain yogurt

### Requirement: A bare count uses the regular size
A count with no unit ("1 samosa", "a bagel") SHALL use the food's regular or medium portion when it has one, before a
small, mini or thin portion.

#### Scenario: Samosa
- **WHEN** a caller logs "1 samosa"
- **THEN** the item uses the regular samosa portion, not the small one

#### Scenario: Bagel
- **WHEN** a caller logs "1 bagel"
- **THEN** the item is between 90 g and 120 g

### Requirement: Plain foods are preferred over prepared forms
A plain food query SHALL prefer the plain cooked or raw form over coated, breaded or battered forms unless the words ask
for one.

#### Scenario: Chicken breast
- **WHEN** a caller logs "1 chicken breast"
- **THEN** the item is not a coated, breaded or battered chicken breast

### Requirement: Totals flag missing nutrients
When some items of a meal have no value for a nutrient, that nutrient's total SHALL say how many items lacked it, so a
caller can tell a complete total from a partial one. A nutrient that no item has SHALL be absent from the totals.

#### Scenario: One item lacks a nutrient
- **WHEN** a meal has two items and only one has a vitamin D value
- **THEN** the vitamin D total equals that item's amount and reports that one item lacked it

#### Scenario: Every item has the nutrient
- **WHEN** every item has a calorie value
- **THEN** the calorie total reports no missing items

### Requirement: AI recognition stays with its own item
On photo and AI text logging, each logged item's recognition label and confidence SHALL be the ones the AI gave for
that item, even when earlier items were unmatched.

#### Scenario: First item unmatched
- **WHEN** the AI recognises "zzzunknown" then "banana" and only the banana matches
- **THEN** the banana item's recognition label is "banana"
