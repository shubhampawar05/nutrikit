// The food-logging accuracy benchmark: what each phrase SHOULD log, not what it logs today.
//
//   food       the logged food's name must match this; grams: [low, high] its weight must fall in
//   unmatched  the phrase must not be logged (nothing in the catalog is right for it); didYouMean: the respelling
//   ask        the food is right but the amount can't be weighed (a volume of a food with no cited USDA density, or a
//              plate of anything but plain cooked rice; portion-logging-v2): nothing is logged, and `food` must be among
//              the suggestions
//   gap        a food the catalog should have but doesn't yet: unmatched is expected, a wrong food never is
//   known      Nutrikit gets this wrong today: reported, and a `todo` in the tests until it is fixed
//
// Add a case for every bug fixed and every food added. Expectations come from what the phrase means, not from
// the current output; run `npm run benchmark -w server` to see the scores.

export const CASES = [
  // Everyday foods (US)
  { input: '2 eggs', food: /^Egg, whole/, grams: [90, 110] },
  { input: '1 boiled egg', food: /^Egg, whole, boiled/, grams: [40, 60] },
  { input: '1 banana', food: /^Banana, raw/, grams: [100, 140] },
  { input: '1 apple', food: /^Apple, raw/, grams: [150, 220] },
  { input: '1 orange', food: /^Orange, raw/, grams: [120, 190] },
  { input: '1 cup rice', food: /^Rice, cooked/, grams: [150, 170] },
  { input: '100 g cooked rice', food: /^Rice, cooked/, grams: [100, 100] },
  { input: '1 slice bread', food: /^Bread, white/, grams: [20, 35] },
  { input: '1 cup milk', food: /^Milk/, grams: [235, 250] },
  { input: '1 tbsp peanut butter', food: /^Peanut butter/, grams: [14, 18] },
  { input: '1 tbsp butter', food: /^Butter/, grams: [12, 16] },
  { input: '1 chicken breast', food: /^Chicken breast/, grams: [120, 200] },
  { input: '100 g salmon', food: /salmon/i, grams: [100, 100] },
  { input: '100 g tofu', food: /^Tofu/, grams: [100, 100] },
  { input: '100 g broccoli', food: /^Broccoli/, grams: [100, 100] },
  { input: '1 cup black beans', food: /^Black beans/, grams: [160, 200] },
  { input: '1 cup oatmeal', food: /^Oatmeal/, grams: [230, 250] },
  { input: 'a handful of almonds', food: /^Almonds/, grams: [25, 32] },
  { input: '1 bagel', food: /^Bagel/, grams: [90, 120] },
  { input: '1 donut', food: /^Doughnut/, grams: [50, 90] },
  { input: '1 slice pizza', food: /^Pizza/, grams: [70, 130] },
  { input: 'medium fries', food: /french fries/i, grams: [100, 140] },
  { input: '1 cup orange juice', food: /^Orange juice/, grams: [240, 255] },
  { input: '1 can soda', food: /soft drink/i, grams: [350, 380] },
  { input: '1 cup coffee', food: /^Coffee, brewed/, grams: [230, 250] },

  // Drinks and everyday words that mean one food
  { input: 'tea', food: /^Tea, hot/ },
  { input: '1 cup green tea', food: /^Tea, hot, leaf, green/ },
  { input: 'iced tea', food: /iced/i },
  { input: 'chai', food: /^Tea, hot, with milk/ },
  { input: 'salad', food: /^Lettuce|salad/i },
  { input: '1 glass buttermilk', food: /^Buttermilk/ },
  { input: '1 cup yogurt', food: /^Yogurt/ },
  { input: 'greek yogurt', food: /Greek/ },
  { input: '200 g sweetened yogurt', food: /^Yogurt, (?!frozen)(?!.*low[- ]calorie).*flavors other than fruit/i, grams: [200, 200] },
  { input: '1 cup sweet curd', food: /^Yogurt, whole milk, flavors other than fruit/ },
  { input: 'frozen yogurt', food: /^Frozen yogurt/ },

  // Indian foods
  // Home roti (INDB Chapati/Roti, 36 g each; CoFID agrees on 202 kcal/100 g), not USDA's commercial chapati (audit P0-3).
  { input: '2 rotis', food: /^Chapati\/Roti$/, grams: [65, 80] },
  { input: '1 naan', food: /naan/i },
  { input: '2 idli', food: /^Idli/ },
  { input: '1 dosa', food: /^Dosa/ },
  { input: '1 vada', food: /^Vada/ },
  { input: 'upma', food: /^Upma/ },
  { input: '1 ladoo', food: /^Ladoo/ },
  { input: '1 samosa', food: /^Samosa/, grams: [80, 120] },
  { input: '100 g paneer', food: /paneer/i, grams: [100, 100] },
  { input: '1 cup palak paneer', food: /^Palak Paneer/ },
  { input: '1 cup dal', food: /^Dal$/, grams: [230, 250] },
  { input: '1 cup masoor dal', food: /masoor/i, ask: true },
  { input: 'urad dal', food: /^Urad/ },
  { input: 'moong dal', food: /mung/i },
  { input: '1 cup chole', food: /chick ?pea/i, ask: true },
  { input: '1 bowl chole', food: /chick ?pea/i, ask: true },
  { input: '1 cup rajma', food: /red kidney bean/i, ask: true },
  { input: 'dal makhani', food: /black gram, whole and red kidney bean/ },
  { input: 'dal makhni', food: /black gram, whole and red kidney bean/ },
  { input: '1 cup khichdi', food: /^Khichadi/, ask: true },
  { input: 'biryani', food: /^Biryani/ },
  { input: '1 cup chicken biryani', food: /^Biryani, chicken/, ask: true },
  { input: 'aloo gobi', food: /cauliflower and potato/ },
  { input: '1 cup sambar', food: /^Sambar/ },
  { input: '100 g chicken curry', food: /^Chicken curry/, grams: [100, 100] },
  { input: '100 g fish curry', food: /^Fish curry/, grams: [100, 100] },
  { input: 'a cup of chai', food: /^Tea, hot, with milk/ },

  // Curd and dahi: plain, unsweetened, fat level kept
  { input: '1 cup curd', food: /^Yogurt, whole milk, plain/, grams: [240, 250] },
  { input: '1 cup dahi', food: /^Yogurt, whole milk, plain/ },
  { input: '200 g low fat curd', food: /low fat milk, plain/, grams: [200, 200] },
  { input: 'skim dahi', food: /nonfat milk, plain/ },
  { input: '100 g bean curd', food: /^Tofu/ },

  // Indian dishes from cited recipes, and common names for INDB dishes
  { input: '2 vada pav', food: /^Vada pav/, grams: [250, 258] },
  { input: '1 plate pani puri', food: /^Pani puri/, ask: true },
  { input: '1 plate golgappa', food: /^Pani puri/, ask: true },
  { input: '6 momos', food: /^Veg momos/, grams: [140, 148] },
  { input: '2 aloo tikki', food: /^Aloo tikki/, grams: [205, 215] },
  { input: '1 plate misal pav', food: /^Misal pav/, ask: true },
  { input: '1 plate chicken 65', food: /^Chicken 65/, ask: true },
  { input: '1 serving pongal', food: /^Ven pongal/, grams: [320, 335] },
  { input: '1 dal baati', food: /^Dal baati/, grams: [560, 580] },
  { input: '1 katori kadai paneer', food: /^Kadhai Paneer$/, ask: true },
  // INDB's kofta curries count the frying oil as eaten (72 g fat per 100 g) and are left out of the catalog.
  { input: '1 katori malai kofta', food: /kofta/i, gap: 'malai kofta (INDB value counts the frying oil)' },
  { input: '1 katori baingan bharta', food: /^Brinjal bhartha/, ask: true },
  { input: '1 glass nimbu pani', food: /^Lemonade$/, ask: true },
  // Portions: katori (200 ml, ICMR-NIN 2024, through the food's density) and bowl. A small or large katori has no
  // single published size, so its amount is asked for: the food is offered, nothing is logged.
  { input: '1 katori dal', food: /^Dal$/, grams: [198, 208] },
  { input: '1 small katori dal', unmatched: true },
  { input: '1 large katori rice', unmatched: true },
  { input: '1 katori curd', food: /^Yogurt, whole milk, plain/, grams: [202, 212] },
  { input: '1 bowl dal', food: /^Dal$/, grams: [198, 208] }, // provisional 200 ml bowl, labelled assumed-bowl
  { input: '1 bowl chips', food: /chips/i, grams: [15, 40] },
  { input: '1 bowl oats', food: /oats.*(prepared|cooked)/i },

  // Traps: a confident wrong food is the worst answer
  { input: '1 cup butter chicken', food: /^Butter chicken/, ask: true },
  { input: '1 plate poha', food: /Poha \(flattened rice/, ask: true },
  { input: '1 bowl wheat flour', unmatched: true },
  { input: 'poha fruit', food: /^Groundcherries/ },
  { input: 'cape gooseberries', food: /^Groundcherries/ },
  { input: '100 g raw rice', food: /^Rice, white.*raw/, grams: [100, 100] },
  { input: 'wild rice', food: /^Wild rice/ },
  { input: '1 tbsp butter with toast', food: /^Butter/ }, // not peanut butter
  { input: '1 sweet potato', food: /^Sweet potato/ },
  { input: '1 potato', food: /^Potato/ },
  { input: 'asdfgh', unmatched: true },

  // Misspellings: suggested, never logged
  { input: 'panner', unmatched: true, didYouMean: 'paneer' },
  { input: '1 cup panner', unmatched: true, didYouMean: '1 cup paneer' },
  { input: 'biriyani', food: /[Bb]iryani/ },
  { input: 'chiken curry', unmatched: true, didYouMean: 'chicken curry' },

  // Dishes the catalog doesn't have yet (need licensed recipes)
  // INDB's gulab jamun counts the frying oil as eaten and is left out; no other source has it yet.
  { input: '1 gulab jamun', food: /gulab jamun/i, gap: 'gulab jamun (INDB value counts the frying oil)' },
  { input: '2 poori', food: /^Bread, puri/, grams: [60, 85] },
  { input: '1 medu vada', food: /^Vada$/ },
  { input: '1 glass lassi', food: /^Lassi, sweet/, ask: true },
  { input: '1 glass chaas', food: /^Lassi.*salted/i, ask: true },
  { input: '1 masala dosa', food: /^Dosa, with filling/ },
  { input: '2 aloo parathas', food: /Potato parantha|paratha/ },
  { input: 'a plate of pav bhaji', food: /Pav bhaji/, ask: true },
  { input: '1 cup kheer', food: /^Kheer \(rice pudding\)/, ask: true },
  { input: '1 jalebi', food: /^Jalebi/ },
  // INDB's only weight is a 342 g recipe serving (several pieces with syrup): flagged until a cited piece weight exists (audit P0-5).
  { input: '1 rasgulla', food: /^Rasgulla/, gap: 'rasgulla piece weight (INDB serving is a recipe yield)' },
  { input: '1 dhokla', food: /^Instant dhokla|Dhokla/ },
  { input: '1 cup halwa', food: /halwa/i, ask: true },
  { input: '1 cup poha', food: /Poha \(flattened rice/, ask: true },
  // Reviewed aliases (data/aliases/recipes.json) win over a food merely named the same, and beat synonyms
  { input: '1 dosa', food: /^Dosa, plain$/ },
  { input: '1 plate curd rice', food: /^Curd rice/, ask: true },
  { input: '1 katori prawn curry', food: /^Prawn curry/, ask: true },
  { input: '1 plate jeera rice', food: /^Cumin pulao/, ask: true },
  { input: '2 phulka', food: /^Chapati\/Roti$/ },
  { input: '1 katori raita', food: /^Cucumber raita/, ask: true },
  { input: '2 cookies', food: /^Cookie, NFS$/ },
  { input: '1 plate veg biryani', food: /^Vegetable biryani/, ask: true },
  // Cited recipes for common dishes no dataset has
  { input: '1 plate sabudana khichdi', food: /^Sabudana khichdi/, ask: true },
  { input: '1 katori paneer bhurji', food: /^Paneer bhurji/, ask: true },
  { input: '1 katori mutton curry', food: /^Mutton curry/, ask: true },
  { input: '1 katori mix veg', food: /^Mixed vegetable sabzi/, ask: true },
  { input: '1 cup filter coffee', food: /^Filter coffee/, ask: true },
  { input: '1 bread omelette', food: /^Bread omelette/, grams: [190, 205] },
  // "Chips" in context and fish and chips (2026-11-20; test/chips-context.test.mjs checks every item of each meal).
  { input: 'fish and chips', food: /^Fish, (cod|haddock), fried$|^Potato, french fries, NFS$/, ask: true },
  { input: 'fish & chips', food: /^Fish, (cod|haddock), fried$|^Potato, french fries, NFS$/, ask: true },
  { input: 'fish n chips', food: /^Fish, (cod|haddock), fried$|^Potato, french fries, NFS$/, ask: true },
  { input: '1 plate fish and chips', food: /^Fish, (cod|haddock), fried$|^Potato, french fries, NFS$/, ask: true },
  { input: 'egg and chips', food: /^Egg, whole, raw$/ },
  { input: 'steak and chips', food: /^Beef, steak, NFS$/ },
  { input: 'burger and chips', food: /^Hamburger, NFS$/ },
  { input: 'chips and salsa', food: /^Potato chips, NFS$/ },
  { input: 'chips and dip', food: /^Potato chips, NFS$/ },
  { input: 'chips', food: /^Potato chips, NFS$/ },
  { input: 'french fries', food: /^Potato, french fries, NFS$/ },
  { input: 'potato chips', food: /^Potato chips, NFS$/ },
  { input: 'fried cod', food: /^Fish, cod, fried$/, ask: true },
  { input: 'fried haddock', food: /^Fish, haddock, fried$/, ask: true },
];
