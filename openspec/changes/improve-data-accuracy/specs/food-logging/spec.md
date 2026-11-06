# Spec Delta

## MODIFIED Requirements

### Requirement: Meal text is split into foods with quantities
Logging text SHALL split a meal description into one item per food. Each item SHALL carry the phrase it came from,
the matched food, the quantity and unit the user gave (or a default when none), its grams, nutrients, a confidence
and up to three alternatives. Phrases that match no food SHALL be listed as unmatched rather than guessed. A phrase
whose only match shares fewer than half of its words with the matched food's name SHALL also be listed as unmatched,
with up to three suggested foods, and SHALL NOT count toward the totals.

#### Scenario: Several foods with counts
- **WHEN** a caller logs "2 eggs, toast with butter and an orange juice"
- **THEN** four items come back, the eggs with quantity 2 and unit "egg", and the totals equal the sum of the items

#### Scenario: Nothing recognisable
- **WHEN** a caller logs "asdfgh qwerty"
- **THEN** no items are returned, the phrase is listed as unmatched, and the totals are empty

#### Scenario: A dish the catalog lacks
- **WHEN** a caller logs a dish whose name matches no food on all of its words, and the best partial match covers
  fewer than half of them
- **THEN** the phrase is listed as unmatched with suggestions, and no item for it is counted in the totals

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

## ADDED Requirements

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
