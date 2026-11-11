// The food-logging accuracy benchmark: what each phrase SHOULD log, not what it logs today.
//
//   food       the logged food's name must match this; grams: [low, high] its weight must fall in
//   unmatched  the phrase must not be logged (nothing in the catalog is right for it); didYouMean: the respelling
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
  { input: '2 rotis', food: /chapati or roti/, grams: [100, 150] },
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
  { input: '1 cup masoor dal', food: /masoor/i },
  { input: 'urad dal', food: /^Urad/ },
  { input: 'moong dal', food: /mung/i },
  { input: '1 cup chole', food: /chick ?pea/i },
  { input: '1 bowl chole', food: /chick ?pea/i, grams: [200, 260] },
  { input: '1 cup rajma', food: /red kidney bean/i },
  { input: 'dal makhani', food: /black gram, whole and red kidney bean/ },
  { input: 'dal makhni', food: /black gram, whole and red kidney bean/ },
  { input: '1 cup khichdi', food: /^Khichadi/ },
  { input: 'biryani', food: /^Biryani/ },
  { input: '1 cup chicken biryani', food: /^Biryani, chicken/ },
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

  // Portions: katori (taken in cups) and bowl
  { input: '1 katori dal', food: /^Dal$/, grams: [235, 245] },
  { input: '1 small katori dal', food: /^Dal$/, grams: [175, 185] },
  { input: '1 large katori rice', food: /^Rice, cooked/, grams: [230, 250] },
  { input: '1 katori curd', food: /^Yogurt, whole milk, plain/, grams: [240, 250] },
  { input: '1 bowl dal', food: /^Dal$/, grams: [230, 250] },
  { input: '1 bowl chips', food: /chips/i, grams: [15, 40] },
  { input: '1 bowl oats', food: /oats.*(prepared|cooked)/i },

  // Traps: a confident wrong food is the worst answer
  { input: '1 cup butter chicken', gap: 'butter chicken (never a cup of butter)' },
  { input: '1 plate poha', unmatched: true }, // dry flakes are not a plate of cooked poha; no validated recipe yet
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
  { input: 'biriyani', unmatched: true, didYouMean: 'biryani' },
  { input: 'chiken curry', unmatched: true, didYouMean: 'chicken curry' },

  // Dishes the catalog doesn't have yet (need licensed recipes)
  { input: '1 gulab jamun', gap: 'gulab jamun' },
  { input: '1 glass lassi', gap: 'lassi' },
  { input: '1 glass chaas', gap: 'chaas (spiced buttermilk)' },
  { input: '1 masala dosa', gap: 'masala dosa' },
  { input: '2 aloo parathas', gap: 'aloo paratha' },
  { input: 'a plate of pav bhaji', gap: 'pav bhaji' },
  { input: '1 cup kheer', gap: 'kheer' },
  { input: '1 jalebi', gap: 'jalebi' },
  { input: '1 dhokla', gap: 'dhokla' },
  { input: '1 cup halwa', gap: 'halwa' },
  { input: '1 cup poha', gap: 'cooked poha' },
];
