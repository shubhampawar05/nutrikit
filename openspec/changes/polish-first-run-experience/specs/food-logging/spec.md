# Spec Delta

## Purpose

Turns what people type or say about a meal into matched foods with quantities, portions, grams and nutrients,
reading everyday phrases the way a person would and never inflating a meal through an implausible portion.

## ADDED Requirements

### Requirement: Meal text is split into foods with quantities
Logging text SHALL split a meal description into one item per food. Each item SHALL carry the phrase it came from,
the matched food, the quantity and unit the user gave (or a default when none), its grams, nutrients, a confidence
and up to three alternatives. Phrases that match no food SHALL be listed as unmatched rather than guessed.

#### Scenario: Several foods with counts
- **WHEN** a caller logs "2 eggs, toast with butter and an orange juice"
- **THEN** four items come back, the eggs with quantity 2 and unit "egg", and the totals equal the sum of the items

#### Scenario: Nothing recognisable
- **WHEN** a caller logs "asdfgh qwerty"
- **THEN** no items are returned, the phrase is listed as unmatched, and the totals are zero

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
A bare common name SHALL match the food people usually mean. "tea" and "chai" SHALL match hot black tea, "salad"
SHALL match a green or garden salad when the catalog has one and otherwise lettuce, and none of these SHALL match
iced, branded or meat-based variants unless the words say so.

#### Scenario: Tea
- **WHEN** a caller logs "tea"
- **THEN** the item is a hot tea, not iced tea

#### Scenario: Chai
- **WHEN** a caller logs "a cup of chai"
- **THEN** the item is a hot black tea, not a branded soy drink

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
