# Set D v1 → v2: every changed expectation

All 217 cases kept; no case removed or added. 101 expectations changed. The PR #43 regression cases are unchanged
except "100 g chicken", which now also requires the 100 g to be kept.

| Phrase | Why | v1 | v2 |
|---|---|---|---|
| 1 katori dal | katori = 200 ml (NIN); dal density from its USDA cup | `{"behavior": "log", "items": [{"food": "^Dal$"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Dal$", "grams": [192.7, 213.0]}]}` |
| 2 katori rice | 2 x 200 ml katori x cooked-rice density | `{"behavior": "log", "items": [{"food": "^Rice"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Rice, cooked, NFS$", "grams": [253.8, 280.5]}]}` |
| 1 katori kheer | katori 200 ml x kheer density from its cited recipe portion | `{"behavior": "log", "items": [{"food": "^Kheer"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Kheer \\(rice pudding\\)$", "grams": [192.7, 213.0]}]}` |
| 1 small katori dal | NIN lists two small katoris (155 ml and 115 ml): ambiguous | `{"behavior": "log", "items": [{"food": "^Dal$"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| 1 katori rajma | no cited density for the rajma foods in the catalog | `{"behavior": "log", "items": [{"food": "kidney bean\|rajma"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| 1 bowl dal | bowl = provisional 200 ml, an assumption that must be shown | `{"behavior": "log", "items": [{"food": "^Dal$"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Dal$", "grams": [192.7, 213.0], "assumption": true}]}` |
| 1 bowl rice | bowl provisional 200 ml | `{"behavior": "log", "items": [{"food": "^Rice"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Rice, cooked, NFS$", "grams": [126.9, 140.2], "assumption": true}]}` |
| 1 bowl curd | bowl provisional 200 ml | `{"behavior": "log", "items": [{"food": "^Yogurt"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Yogurt, whole milk, plain$", "grams": [196.7, 217.5], "assumption": true}]}` |
| 1 bowl sambar | bowl provisional 200 ml | `{"behavior": "log", "items": [{"food": "^Sambar"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Sambar, vegetable stew$", "grams": [199.2, 220.1], "assumption": true}]}` |
| 1 bowl sweet corn soup | no cited density (the INDB bowl is a recipe yield) | `{"behavior": "log", "items": [{"food": "corn soup"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| 1 glass milk | glass = provisional 250 ml, shown as an assumption | `{"behavior": "log", "items": [{"food": "^Milk", "grams": [231.8, 256.2]}]}` | `{"behavior": "log", "items": [{"food": "^Milk", "grams": [244.9, 270.7], "assumption": true}]}` |
| 1 plate idli | NIN serving 2 idli (labelled assumption, not typical consumption) | `{"behavior": "log", "items": [{"food": "^Idli$"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Idli$", "grams": [72.2, 79.8], "assumption": true}]}` |
| 1 plate rice | NIN serving 1 cup (200 ml), labelled assumption | `{"behavior": "log", "items": [{"food": "^Rice"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Rice, cooked, NFS$", "grams": [126.9, 140.2], "assumption": true}]}` |
| 1 plate upma | NIN serving 1 cup (200 ml), labelled assumption | `{"behavior": "log", "items": [{"food": "^Upma"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "log", "items": [{"food": "^Upma$", "grams": [136.5, 150.9], "assumption": true}]}` |
| 1 plate poha | NIN gives 1 cup but no source gives cooked poha density | `{"behavior": "log", "items": [{"food": "^Poha"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| 1 plate biryani | no cited plate or serving for biryani | `{"behavior": "log", "items": [{"food": "biryani"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| half plate biryani | no cited plate for biryani | `{"behavior": "log", "items": [{"food": "biryani"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| 1 plate pav bhaji | pav bhaji plate UNKNOWN in the serving reference | `{"behavior": "log", "items": [{"food": "^Pav bhaji"}], "amountPending": "serving table: no published plate/bowl/katori weight yet adopted"}` | `{"behavior": "flag"}` |
| 100 g chicken | keep the 100 g; ask which chicken | `{"behavior": "suggest"}` | `{"behavior": "suggest", "preserve": "100 g"}` |
| chicken tikka | no dry chicken tikka in the catalog; tandoori chicken is not an equivalent | `{"behavior": "log", "items": [{"food": "chicken tikka(?! masala)\|tandoori chicken"}]}` | `{"behavior": "suggest"}` |
| egg roll | Indian egg roll (paratha wrap) vs Chinese egg roll: no single food | `{"behavior": "log", "items": [{"food": "egg roll"}]}` | `{"behavior": "suggest"}` |
| spring roll | only a meat spring roll in the catalog; bare "spring roll" is ambiguous | `{"behavior": "log", "items": [{"food": "spring roll"}]}` | `{"behavior": "suggest"}` |
| fish fry | exact reviewed catalog name(s): reviewed: Indian "fish fry" is fried fish; FNDDS generic fried fish | `["fish.*fried\|fried fish\|fish fry"]` | `["^Fish, NS as to type, fried$"]` |
| dal fry | exact reviewed catalog name(s): reviewed: USDA "Dal" is tempered lentil dal (search PHRASES maps dal fry/tadka to it) | `["^Dal$\|dahl\|dhal"]` | `["^Dal$"]` |
| dal tadka | exact reviewed catalog name(s): reviewed: as dal fry | `["^Dal$\|dahl\|dhal"]` | `["^Dal$"]` |
| aloo gobi | exact reviewed catalog name(s): reviewed: INDB aloo gobhi, or the CoFID dish the reviewed alias "aloo gobi" names | `["cauliflower\|gobhi"]` | `["^Potato cauliflower \\(Aloo gobhi\\)$\|^Curry, cauliflower and potato, homemade$"]` |
| gobi aloo | exact reviewed catalog name(s): as aloo gobi | `["cauliflower\|gobhi"]` | `["^Potato cauliflower \\(Aloo gobhi\\)$\|^Curry, cauliflower and potato, homemade$"]` |
| aloo gobhi | exact reviewed catalog name(s): as aloo gobi | `["cauliflower\|gobhi"]` | `["^Potato cauliflower \\(Aloo gobhi\\)$\|^Curry, cauliflower and potato, homemade$"]` |
| plain rice | exact reviewed catalog name(s) | `["^Rice, cooked\|^Rice, white, cooked"]` | `["^Rice, cooked, NFS$"]` |
| 1 paratha | exact reviewed catalog name(s) | `["^Bread, paratha$\|^Plain parantha"]` | `["^Bread, paratha$\|^Plain parantha/paratha$"]` |
| veg noodles | exact reviewed catalog name(s) | `["noodle\|chow ?mein"]` | `["^Vegetable chowmein$"]` |
| hakka noodles | exact reviewed catalog name(s) | `["noodle\|chow ?mein"]` | `["^Vegetable chowmein$"]` |
| paneer tikka | exact reviewed catalog name(s) | `["paneer.*tikka\|tikka.*paneer"]` | `["^Paneer shaslik/tikka$"]` |
| cold coffee | exact reviewed catalog name(s) | `["cold coffee\|iced coffee"]` | `["^Cold coffee \\(with cream\\)$\|^Cold coffee with ice cream$\|^Iced Coffee, brewed$"]` |
| tomato soup | exact reviewed catalog name(s) | `["tomato soup\|soup, tomato"]` | `["^Soup, tomato$"]` |
| chocolate cake | exact reviewed catalog name(s) | `["chocolate cake\|cake, chocolate"]` | `["^Chocolate cake$\|^Cake, chocolate"]` |
| aloo paratha | exact reviewed catalog name(s) | `["potato parantha\|aloo.*paratha"]` | `["^Potato parantha/paratha"]` |
| gobi paratha | exact reviewed catalog name(s) | `["cauliflower parantha\|gobi.*paratha"]` | `["^Cauliflower parantha/paratha"]` |
| chicken biryani | exact reviewed catalog name(s) | `["biryani.*chicken\|chicken.*biryani"]` | `["^Biryani with chicken$\|^Biryani, chicken, takeaway$"]` |
| fish curry | exact reviewed catalog name(s) | `["fish curry\|curry, fish"]` | `["^Fish curry$\|^Fish curry \\(Machli curry\\)$\|^Curry, fish, homemade$"]` |
| prawn curry | exact reviewed catalog name(s) | `["prawn curry\|shrimp curry\|curry, prawn"]` | `["^Prawn curry"]` |
| mutton curry | exact reviewed catalog name(s) | `["mutton curry\|lamb curry\|goat curry"]` | `["^Mutton curry"]` |
| masala chai | exact reviewed catalog name(s) | `["^Tea, hot, with milk\|chai"]` | `["^Tea, hot, with milk$"]` |
| buttermilk | exact reviewed catalog name(s) | `["buttermilk\|chaas\|lassi.*salted"]` | `["^Buttermilk$\|^Lassi \\(salted\\)$"]` |
| pasta | exact reviewed catalog name(s) | `["^Pasta\|spaghetti\|macaroni"]` | `["^Pasta, cooked$"]` |
| white sauce pasta | exact reviewed catalog name(s) | `["pasta.*(cream\|white\|alfredo)"]` | `["^Pasta with cream sauce"]` |
| french fries | exact reviewed catalog name(s) | `["french fries\|fries"]` | `["^Potato, french fries"]` |
| momos | exact reviewed catalog name(s) | `["momo\|dumpling"]` | `["^Veg momos"]` |
| chilli chicken | exact reviewed catalog name(s) | `["chilli chicken\|chili chicken"]` | `["^Chilli chicken$"]` |
| jeera rice | exact reviewed catalog name(s) | `["jeera\|cumin"]` | `["^Cumin pulao"]` |
| egg bhurji | exact reviewed catalog name(s) | `["bhurji\|scrambled"]` | `["^Scrambled egg \\(Ande ki bhurji\\)$\|^Egg, whole, cooked, scrambled$"]` |
| anda bhurji | exact reviewed catalog name(s) | `["bhurji\|scrambled"]` | `["^Scrambled egg \\(Ande ki bhurji\\)$\|^Egg, whole, cooked, scrambled$"]` |
| uttapam | exact reviewed catalog name(s) | `["uttapam\|uthappam"]` | `["^Uttapam$"]` |
| khichdi | exact reviewed catalog name(s) | `["khichdi\|khichadi\|khichri"]` | `["^Khichadi, with butter ghee$\|^Plain khi"]` |
| chicken curry | exact reviewed catalog name(s) | `["^Chicken curry\|curry, chicken"]` | `["^Chicken curry$"]` |
| sabzi | exact reviewed catalog name(s) | `["sabzi\|vegetable"]` | `["^Mixed vegetable sabzi"]` |
| salad | exact reviewed catalog name(s) | `["salad\|lettuce"]` | `["^Lettuce, salad with assorted vegetables"]` |
| matar aloo ki sabzi | exact reviewed catalog name(s) | `["pea potato\|potato and pea\|aloo matar"]` | `["^Pea potato curry \\(Aloo matar\\)$\|^Curry, potato and pea, homemade$"]` |
| aloo ki sabzi | exact reviewed catalog name(s) | `["aloo ki sabzi\|potato curry"]` | `["^Potato curry \\(Aloo ki sabzi\\)$"]` |
| gosht biryani | exact reviewed catalog name(s) | `["mutton biryani\|lamb biryani"]` | `["^Mutton biryani/biriyani$\|^Curry, lamb biryani, homemade$"]` |
| palak paneer | exact reviewed catalog name(s) | `["palak paneer\|spinach paneer"]` | `["^Palak Paneer$\|^Spinach paneer \\(Palak paneer\\)$"]` |
| palak panir | exact reviewed catalog name(s) | `["palak paneer\|spinach paneer"]` | `["^Palak Paneer$\|^Spinach paneer \\(Palak paneer\\)$"]` |
| mattar paneer | exact reviewed catalog name(s) | `["matar paneer\|pea paneer"]` | `["^Pea paneer curry \\(Matar paneer\\)$"]` |
| mutter paneer | exact reviewed catalog name(s) | `["matar paneer\|pea paneer"]` | `["^Pea paneer curry \\(Matar paneer\\)$"]` |
| rajma | exact reviewed catalog name(s) | `["kidney bean\|rajma"]` | `["^Curry, red kidney bean, Punjabi, homemade$\|^Kidney bean curry \\(Rajmah curry\\)$"]` |
| dal makhani | exact reviewed catalog name(s) | `["dal makhani\|black gram, whole and red kidney bean"]` | `["^Dal makhani$\|^Curry, black gram, whole and red kidney bean, homemade$"]` |
| chole | exact reviewed catalog name(s) | `["chick ?pea\|chole\|chana"]` | `["^Curry, chick pea, whole and tomato, Punjabi"]` |
| murgh korma | exact reviewed catalog name(s) | `["chicken korma"]` | `["^Curry, chicken korma, homemade$\|^Chicken korma$"]` |
| kakdi raita | exact reviewed catalog name(s) | `["cucumber raita"]` | `["^Cucumber raita \\(Kheere ka raita\\)$"]` |
| kheera raita | exact reviewed catalog name(s) | `["cucumber raita"]` | `["^Cucumber raita \\(Kheere ka raita\\)$"]` |
| kheere ka raita | exact reviewed catalog name(s) | `["raita"]` | `["^Cucumber raita \\(Kheere ka raita\\)$"]` |
| panir | exact reviewed catalog name(s) | `["paneer"]` | `["^Cheese, paneer$"]` |
| nan | exact reviewed catalog name(s) | `["naan"]` | `["^Bread, naan$\|^Naan$"]` |
| anda curry | exact reviewed catalog name(s) | `["egg curry"]` | `["^Egg curry \\(Anda curry\\)$"]` |
| omelette | exact reviewed catalog name(s) | `["omelet"]` | `["^Omelette, plain, homemade$"]` |
| pizza | exact reviewed catalog name(s) | `["pizza"]` | `["^Pizza, cheese"]` |
| 1 slice pizza | exact reviewed catalog name(s) | `["pizza"]` | `["^Pizza, cheese"]` |
| sprouts salad | exact reviewed catalog name(s) | `["sprout"]` | `["^Sprouted moong salad$"]` |
| chicken wings | exact reviewed catalog name(s) | `["chicken wing"]` | `["^Chicken wing"]` |
| jalebi | exact reviewed catalog name(s) | `["jalebi"]` | `["^Jalebi"]` |
| pani puri | exact reviewed catalog name(s) | `["pani puri"]` | `["^Pani puri"]` |
| vada pav | exact reviewed catalog name(s) | `["vada pav"]` | `["^Vada pav"]` |
| dhokla | exact reviewed catalog name(s) | `["dhokla"]` | `["^Instant dhokla$\|^Dhokla$"]` |
| mix veg pulao | exact reviewed catalog name(s) | `["mixed vegetable pulao"]` | `["^Mixed vegetable pulao$"]` |
| yellow moong daal | exact reviewed catalog name(s) | `["washed moong dal"]` | `["^Washed moong dal"]` |
| jira aloo | exact reviewed catalog name(s) | `["jeera aloo"]` | `["^Jeera aloo"]` |
| bengan bharta | exact reviewed catalog name(s) | `["brinjal bhartha"]` | `["^Brinjal bhartha \\(Baingan ka bhartha\\)$"]` |
| curd rice | exact reviewed catalog name(s) | `["curd rice"]` | `["^Curd rice"]` |
| lemon rice | exact reviewed catalog name(s) | `["lemon rice"]` | `["^Lemon rice"]` |
| sweet corn soup | exact reviewed catalog name(s) | `["corn soup"]` | `["^Sweet corn soup$"]` |
| ice cream | exact reviewed catalog name(s) | `["ice cream"]` | `["^Ice cream"]` |
| banana chips | exact reviewed catalog name(s) | `["banana chips"]` | `["^Banana chips"]` |
| peanut butter sandwich | exact reviewed catalog name(s) | `["peanut butter sandwich"]` | `["^Peanut butter sandwich"]` |
| paneer paratha | exact reviewed catalog name(s) | `["paneer parantha"]` | `["^Paneer parantha/paratha$"]` |
| chicken 65 | exact reviewed catalog name(s) | `["chicken 65"]` | `["^Chicken 65"]` |
| coconut water | exact reviewed catalog name(s) | `["coconut water"]` | `["^Coconut water"]` |
| orange juice | exact reviewed catalog name(s) | `["orange juice"]` | `["^Orange juice"]` |
| brown rice | exact reviewed catalog name(s) | `["rice, brown"]` | `["^Rice, brown, cooked"]` |
| mac and cheese | exact reviewed catalog name(s) | `["macaroni.*cheese"]` | `["^Macaroni or noodles with cheese\|^Macaroni cheese"]` |
| chicken tikka masala | exact reviewed catalog name(s) | `["tikka masala"]` | `["^Chicken tikka masala$"]` |
| 1 glass lassi | glass = provisional 250 ml, shown as an assumption | `{"behavior": "log", "items": [{"food": "^Lassi, sweet$", "grams": [237.5, 262.5]}]}` | `{"behavior": "log", "items": [{"food": "^Lassi, sweet$", "grams": [237.5, 262.5], "assumption": true}]}` |

## Outcome changes against the v1 baseline (main at f6a23c8)

21 cases moved from correct to incorrect; none moved the other way. 19 are measure or plate cases that pass today only
on food identity or an undefined measure (listed as "pending v2"); egg roll and spring roll now expect a suggestion
(listed under P1-8). The 78 identity tightenings changed no outcome: today's matches are the reviewed names.

## Final review revision (2026-11-19)

All 217 cases kept. Every food pattern that wasn't anchored at both ends was rewritten to exact catalog names (93
patterns, in 90 cases); each new pattern was checked to match only the names it lists. Kinds:

- **anchor:** the same food, end anchored or a truncated prefix spelled in full (34)
- **narrow:** the old pattern also matched different foods (spice mixes, dry mixes, meat versions, brands); now only the right ones (54)
- **problem:** today's match was a wrong or arbitrary variant, so the case is now known incorrect (3)
- **decision:** no generic food exists; anchored to today's pick and raised for the owner (2; serving-reference.md D8)

| Phrase | Kind | Before | After | Reason |
|---|---|---|---|---|
| vegetable fried rice | anchor | `^Rice, fried, meatless$\|^Chinese fried rice` | `^Rice, fried, meatless$\|^Chinese fried rice$` | second alternative end anchored |
| veg fried rice | anchor | `^Rice, fried, meatless$\|^Chinese fried rice` | `^Rice, fried, meatless$\|^Chinese fried rice$` | second alternative end anchored |
| egg fried rice | narrow | `^Rice, fried` | `^Rice, fried, meatless$\|^Rice, fried, NFS$\|^Chinese fried rice$` | ^Rice, fried accepted pork, beef, shrimp and chicken fried rice; no egg fried rice in the catalog, so meatless or NFS |
| tortilla chips | narrow | `^Tortilla chips` | `^Tortilla chips, plain$\|^Tortilla chips, yellow, plain, salted$` | excludes flavoured (Doritos) and reduced-fat chips |
| corn chips | narrow | `^Corn chips` | `^Corn chips, plain$\|^Corn chips, plain \(Fritos\)$` | excludes flavoured and reduced-sodium chips |
| french toast | narrow | `^French toast` | `^French toast, NFS$` | 12 matches incl. sticks and frozen products |
| apple pie | anchor | `^Pie, apple` | `^Pie, apple$\|^Pie, apple, prepared from recipe$\|^Pie, apple, commercially prepared, enriched flour$\|^Pie, apple, commercially prepared, unenriched flour$\|^Pie, apple, fast food$` | all five are apple pie; spelled in full |
| chicken and rice | narrow | `^Rice` | `^Rice, cooked, NFS$` | 216 matches incl. rice cakes, raw rice and rice milk |
| 1 large egg | narrow | `^Egg, whole` | `^Egg, whole, raw$\|^Egg, whole, cooked, NS as to cooking method$` | 27 matches incl. dried, frozen and fried eggs; whole egg by count, preparation not stated |
| 2 eggs | narrow | `^Egg, whole` | `^Egg, whole, raw$\|^Egg, whole, cooked, NS as to cooking method$` | 27 matches incl. dried, frozen and fried eggs; whole egg by count, preparation not stated |
| 10 almonds | narrow | `^Almonds` | `^Almonds, NFS$` | excludes almond butter-style and flavoured variants |
| 1 glass milk | narrow | `^Milk` | `^Milk, NFS$\|^Milk, whole$` | ^Milk also matched 85 foods incl. "Milk dessert, frozen" and buttermilk; plain milk only (NFS is the cited density food) |
| 200 ml milk | narrow | `^Milk` | `^Milk, NFS$\|^Milk, whole$` | ^Milk also matched 85 foods incl. "Milk dessert, frozen" and buttermilk; plain milk only (NFS is the cited density food) |
| 1 tbsp oil | decision | `^Oil` | `^Oil, palm$` | 76 matches; the catalog has no generic cooking oil, and bare "oil" logs palm oil, an arbitrary variant. Anchored to today's food pending owner decision |
| 2 tsp sugar | narrow | `^Sugar` | `^Sugar, NFS$` | 22 matches incl. sugar substitutes and syrups |
| 500 ml water | narrow | `^Water` | `^Water, NFS$` | 27 matches incl. flavoured and carbonated waters |
| 2 cups tea | narrow | `^Tea, hot` | `^Tea, hot, leaf, black$` | excludes herbal, green and decaffeinated teas |
| 100g paneer | narrow | `paneer` | `^Cheese, paneer$` | 24 matches incl. paneer dishes; "100g paneer" is the cheese |
| chicken fried rice | anchor | `^Rice, fried, with chicken` | `^Rice, fried, with chicken$` | single catalog name; end anchored |
| fried rice | narrow | `^Rice, fried` | `^Rice, fried, NFS$` | ^Rice, fried accepted every meat fried rice; bare phrase is NFS |
| veg burger | narrow | `^Veggie burger, on bun` | `^Veggie burger, on bun$` | excludes "with cheese" |
| chicken sandwich | anchor | `^Chicken sandwich` | `^Chicken sandwich$\|^Chicken sandwich \(toasted\)$` | both catalog names spelled in full |
| veg sandwich | narrow | `^Vegetable sandwich` | `^Vegetable sandwich on white$\|^Vegetable sandwich on wheat$` | excludes with-cheese and wrap variants |
| green tea | narrow | `^Tea, hot, leaf, green` | `^Tea, hot, leaf, green$` | excludes decaffeinated |
| lemon rice | anchor | `^Lemon rice` | `^Lemon rice \(Pulihora, Elumichai sadam, Chitranna\)$` | single catalog name; end anchored |
| curd rice | anchor | `^Curd rice` | `^Curd rice \(Dahi bhaat/Dahi chawal/ Perugu annam/Daddojanam/Thayir saadam\)$` | single catalog name; end anchored |
| fruit salad | narrow | `^Fruit salad(?!.*marshmallow)` | `^Fruit salad, fresh or raw, excluding citrus fruits, no dressing$\|^Fruit salad, fresh or raw, including citrus fruits, no dressing$` | the lookahead still accepted canned-in-syrup, whipped-cream and mayonnaise salads; fresh fruit salad only |
| chocolate cake | narrow | `^Chocolate cake$\|^Cake, chocolate` | `^Chocolate cake$\|^Cake, chocolate, prepared from recipe without frosting$\|^Cake, chocolate, commercially prepared with chocolate frosting, in-store bakery$` | excludes "Cake, chocolate, flourless", a different cake |
| ice cream | narrow | `^Ice cream` | `^Ice cream, NFS$` | 72 matches incl. brand and novelty items; bare "ice cream" is the NFS food |
| peanut butter sandwich | narrow | `^Peanut butter sandwich` | `^Peanut butter sandwich, NFS$` | bare phrase is the NFS food; bread/peanut-butter variants not stated |
| aloo paratha | anchor | `^Potato parantha/paratha` | `^Potato parantha/paratha \(Aloo ka parantha/paratha\)$` | single catalog name; end anchored |
| gobi paratha | anchor | `^Cauliflower parantha/paratha` | `^Cauliflower parantha/paratha \(Phoolgobhi ka parantha/paratha\)$` | single catalog name; end anchored |
| potato chips | narrow | `^Potato chips` | `^Potato chips, NFS$` | 25 matches incl. flavoured and restructured chips |
| banana chips | anchor | `^Banana chips` | `^Banana chips$` | single catalog name; end anchored |
| chicken wings | problem | `^Chicken wing` | `^Chicken wing, NS as to cooking method$` | 16 matches across cooking methods; bare "chicken wings" names no preparation, so only the NS food is right. Today logs a marinated barbecued variant: incorrect, P1-8 |
| prawn curry | anchor | `^Prawn curry` | `^Prawn curry \(with coconut\) \(Jhinga curry\)$` | single catalog name; end anchored |
| mutton curry | anchor | `^Mutton curry` | `^Mutton curry \(home-style Indian goat curry\)$` | single catalog name; end anchored |
| chicken 65 | anchor | `^Chicken 65` | `^Chicken 65 \(spicy deep-fried chicken\)$` | single catalog name; end anchored |
| jalebi | anchor | `^Jalebi` | `^Jalebi \(fermented batter, fried and soaked in syrup\)$` | single catalog name; end anchored |
| orange juice | narrow | `^Orange juice` | `^Orange juice, 100%, NFS$` | 20 matches incl. frozen concentrate undiluted; bare phrase is the NFS juice |
| coconut water | narrow | `^Coconut water` | `^Coconut water, unsweetened$` | excludes the sweetened product |
| peanuts | narrow | `^Peanuts` | `^Peanuts, NFS$` | 26 matches by type and roasting; bare phrase is NFS |
| almonds | narrow | `^Almonds` | `^Almonds, NFS$` | excludes almond butter-style and flavoured variants |
| white sauce pasta | narrow | `^Pasta with cream sauce` | `^Pasta with cream sauce, home recipe$\|^Pasta with cream sauce, restaurant$\|^Pasta with cream sauce, ready-to-heat$` | 24 matches incl. meat, seafood and vegetable versions; plain cream-sauce pasta only |
| pizza | narrow | `^Pizza, cheese` | `^Pizza, cheese, from restaurant or fast food, NS as to type of crust$` | 29 matches across crusts and sources; bare "pizza" is the NS-crust cheese pizza |
| 1 slice pizza | narrow | `^Pizza, cheese` | `^Pizza, cheese, from restaurant or fast food, NS as to type of crust$` | 29 matches across crusts and sources; bare "pizza" is the NS-crust cheese pizza |
| french fries | narrow | `^Potato, french fries` | `^Potato, french fries, NFS$` | 16 matches incl. with cheese and with chili |
| momos | anchor | `^Veg momos` | `^Veg momos \(steamed dumplings with cabbage filling\)$` | single catalog name; end anchored |
| jeera rice | anchor | `^Cumin pulao` | `^Cumin pulao \(Jeera/Zeera pulao\)$` | single catalog name; end anchored |
| brown rice | narrow | `^Rice, brown, cooked` | `^Rice, brown, cooked, NS as to fat$\|^Rice, brown, cooked, no added fat$` | excludes butter, margarine, oil and "as ingredient" variants |
| oats | narrow | `^Oat` | `^Oats, raw$\|^Oats, whole grain, rolled, old fashioned$\|^Oats, whole grain, steel cut$\|^Oats \(Includes foods for USDA's Food Distribution Program\)$` | ^Oat matched oat bran, oat milk, oat flour and "Oats burfi" |
| boiled egg | anchor | `^Egg, whole, boiled` | `^Egg, whole, boiled or poached$` | single catalog name; end anchored |
| poha | narrow | `^Poha` | `^Poha$\|^Poha \(flattened rice with onion and peanuts\)$` | excludes "Poha with curd" |
| upma | anchor | `^Upma` | `^Upma$` | end anchored |
| khichdi | anchor | `^Khichadi, with butter ghee$\|^Plain khi` | `^Khichadi, with butter ghee$\|^Plain khitchdi \(Plain khichri/khichdi\)$` | "^Plain khi" was a truncated prefix; both reviewed names spelled in full |
| pav bhaji | narrow | `^Pav bhaji` | `^Pav bhaji$\|^Pav bhaji \(vegetable mash with buttered rolls\)$` | ^Pav bhaji matched "Pav bhaji masala", a spice mix |
| vada pav | anchor | `^Vada pav` | `^Vada pav \(potato fritter in a bun with chutneys\)$` | single catalog name; end anchored |
| pani puri | anchor | `^Pani puri` | `^Pani puri \(hollow puris with potato filling and spiced water\)$` | single catalog name; end anchored |
| thepla | anchor | `thepla` | `^Methi thepla$` | single catalog name; anchored both ends |
| butter chicken | anchor | `^Butter chicken` | `^Butter chicken$` | end anchored |
| mac and cheese | problem | `^Macaroni or noodles with cheese\|^Macaroni cheese` | `^Macaroni or noodles with cheese$\|^Macaroni or noodles with cheese, from restaurant$` | 16 matches incl. dry mixes "unprepared", tuna and meat versions; today logs the Easy Mac packaged product: incorrect, P1-8 |
| sabzi | anchor | `^Mixed vegetable sabzi` | `^Mixed vegetable sabzi \(semi-dry Indian mixed vegetables\)$` | single catalog name; end anchored |
| salad | anchor | `^Lettuce, salad with assorted vegetables` | `^Lettuce, salad with assorted vegetables including tomatoes and/or carrots, no dressing$\|^Lettuce, salad with assorted vegetables excluding tomatoes and carrots, no dressing$` | both catalog names spelled in full |
| matar ki sabzi | anchor | `^Pea curry` | `^Pea curry \(Matar ki sabzi\)$` | single catalog name; end anchored |
| palak | narrow | `^Spinach` | `^Spinach, cooked, boiled, drained, without salt$\|^Spinach, cooked, boiled, drained, with salt$` | 47 matches incl. raw, canned, frozen and spinach dishes; "palak" as eaten is cooked spinach |
| jira aloo | anchor | `^Jeera aloo` | `^Jeera aloo \(potatoes tempered with cumin\)$` | single catalog name; end anchored |
| yellow moong daal | anchor | `^Washed moong dal` | `^Washed moong dal \(Dhuli moong ki dal\)$` | single catalog name; end anchored |
| samose | narrow | `^Samosa` | `^Samosa$\|^Samosas, vegetable, retail$` | ^Samosa matched "Samosas, lamb, baked, homemade"; a plain samosa is vegetable |
| masala dosai | anchor | `^Dosa, with filling` | `^Dosa, with filling$` | end anchored |
| masaala dosa | anchor | `^Dosa, with filling` | `^Dosa, with filling$` | end anchored |
| chole | anchor | `^Curry, chick pea, whole and tomato, Punjabi` | `^Curry, chick pea, whole and tomato, Punjabi, with vegetable oil, homemade$\|^Curry, chick pea, whole and tomato, Punjabi, with butter, homemade$` | both catalog names spelled in full |
| dal, rice and salad | narrow | `^Rice` | `^Rice, cooked, NFS$` | 216 matches incl. rice cakes, raw rice and rice milk |
| dal, rice and salad | narrow | `salad\|lettuce` | `^Lettuce, salad with assorted vegetables including tomatoes and/or carrots, no dressing$\|^Lettuce, salad with assorted vegetables excluding tomatoes and carrots, no dressing$` | 336 matches incl. tuna, chicken and pasta salads; same reviewed names as bare "salad" |
| tea with milk and sugar | narrow | `^Tea` | `^Tea, hot, leaf, black$` | 46 matches incl. iced, herbal and instant teas |
| tea with milk and sugar | narrow | `^Milk` | `^Milk, NFS$\|^Milk, whole$` | ^Milk also matched 85 foods incl. "Milk dessert, frozen" and buttermilk; plain milk only (NFS is the cited density food) |
| tea with milk and sugar | narrow | `^Sugar` | `^Sugar, NFS$` | 22 matches incl. sugar substitutes and syrups |
| coffee with sugar | narrow | `^Coffee` | `^Coffee, brewed$` | 107 matches incl. coffee drinks and creamers |
| coffee with sugar | narrow | `^Sugar` | `^Sugar, NFS$` | 22 matches incl. sugar substitutes and syrups |
| idli with sambar | narrow | `^Sambar` | `^Sambar, vegetable stew$\|^Sambar, homemade$\|^Sambar$` | ^Sambar matched "Sambar powder (Sambar masala)", a spice mix |
| dosa with chutney | narrow | `^Dosa` | `^Dosa, plain$` | excludes filled dosa; "dosa with chutney" is a plain dosa |
| dosa with chutney | narrow | `chutney` | `^Chutney$` | 26 matches incl. specific chutneys and chutney sandwiches; bare "chutney" is the generic food |
| tea and biscuits | narrow | `^Tea` | `^Tea, hot, leaf, black$` | 46 matches incl. iced, herbal and instant teas |
| tea and biscuits | problem | `biscuit\|cookie` | `^Cookie, NFS$\|^Cookie, butter or sugar$` | 311 matches. In Indian English "biscuits" with tea are cookies; today logs "Biscuit, NFS", the US bread biscuit: incorrect, P1-8 |
| rice and beans | narrow | `^Rice` | `^Rice, cooked, NFS$` | 216 matches incl. rice cakes, raw rice and rice milk |
| rice and beans | narrow | `bean` | `^Beans, NFS$` | 489 matches incl. green beans, bean sprouts and coffee beans |
| bread and butter | narrow | `^Bread` | `^Bread, white$` | 199 matches incl. breadsticks, bread pudding and stuffing |
| bread and butter | narrow | `^Butter` | `^Butter, NFS$` | 24 matches incl. buttermilk, butter beans and butterscotch |
| 2 paratha with raita | narrow | `paratha\|parantha` | `^Bread, paratha$\|^Plain parantha/paratha$` | 15 matches incl. stuffed parathas; same reviewed names as "1 paratha" |
| 2 paratha with raita | decision | `raita` | `^Cucumber raita \(Kheere ka raita\)$` | 23 matches across 14 kinds of raita and no generic raita; bare "raita" logs cucumber raita, an arbitrary variant. Anchored to today's food pending owner decision |
| masala dosa, sambar | anchor | `^Dosa, with filling` | `^Dosa, with filling$` | end anchored |
| masala dosa, sambar | narrow | `^Sambar` | `^Sambar, vegetable stew$\|^Sambar, homemade$\|^Sambar$` | ^Sambar matched "Sambar powder (Sambar masala)", a spice mix |
| anda curry with 3 roti | anchor | `egg curry` | `^Egg curry \(Anda curry\)$` | single catalog name; anchored both ends |
| 2 mattar paneer and 3 phulka | anchor | `matar paneer\|pea paneer` | `^Pea paneer curry \(Matar paneer\)$` | single catalog name; anchored both ends |

### Other expectation changes

| Phrase | Reason | Before | After |
|---|---|---|---|
| 1 katori kheer | kheer audit: the recipe's 240 g "1 cup" is the INDB importer's blanket default, not a measured density; firni (260 g per USDA cup) is a different dish and not adopted | `{"behavior": "log", "items": [{"food": "^Kheer \\(rice pudding\\)$", "grams": [192.7, 213.0]}]}` | `{"behavior": "flag"}` |
| 1 glass lassi | same finding as kheer: lassi-sweet.json's "1 glass = 250 g" and "1 cup = 240 g" are unsourced authoring defaults, so no cited density | `{"behavior": "log", "items": [{"food": "^Lassi, sweet$", "grams": [237.5, 262.5], "assumption": true}]}` | `{"behavior": "flag"}` |
| 2 roti and 1 bowl dal | a bowl inside a multi-food phrase passed on food identity alone; now the same 200 ml labelled assumption as "1 bowl dal" | `{"behavior": "log", "items": [{"food": "^Chapati/Roti$"}, {"food": "^Dal$"}]}` | `{"behavior": "log", "items": [{"food": "^Chapati/Roti$"}, {"food": "^Dal$", "grams": [192.7, 213.0], "assumption": true}]}` |

Rationale wording only (no expectation change): "1 cup dal", "2 cups tea", "1 cup curd", "200 ml milk", "500 ml water"
(USDA standard cup, 236.6 ml), "1 plate rice", "1 plate upma", "1 plate poha" (named NIN serving cup, 200 ml), "1 katori dal",
"2 katori rice" (NIN katori, not a cup).

### Outcomes against the first v2 baseline (185 / 7 / 25)

Now 181 correct, 7 safely uncertain, 29 incorrect, all 29 known (0 unexpected). Four cases moved from correct to known
incorrect: chicken wings, mac and cheese, tea and biscuits (identity audit) and 2 roti and 1 bowl dal (the bowl rule).
"1 katori kheer" and "1 glass lassi" stay known incorrect with a new reason (they should now flag).

## Owner decisions on oil and raita (2026-11-19)

| Phrase | Before | After | Reason |
|---|---|---|---|
| 1 tbsp oil | `{"behavior": "log", "items": [{"food": "^Oil, palm$", "grams": [12.9, 14.3]}]}` | `{"behavior": "suggest", "preserve": "1 tbsp"}` | 76 oils, no generic: ask which oil and keep the amount |
| 2 paratha with raita | `{"behavior": "log", "items": [paratha, "^Cucumber raita \\(Kheere ka raita\\)$"]}` | `{"behavior": "log", "items": [paratha], "ask": ["raita"]}` | 14 raitas, no generic: log the paratha, ask which raita |

The judge gained `ask`: foods a log case must list back unmatched rather than log. Both cases are known incorrect
(P1-8). Outcomes: 179 correct, 7 safely uncertain, 31 known incorrect, 0 unexpected.

## Owner correction: idli and upma plates (2026-11-19, increment 5)

| Phrase | Before | After | Reason |
|---|---|---|---|
| 1 plate idli | `{"behavior": "log", "items": [{"food": "^Idli$", "grams": [72.2, 79.8], "assumption": true}]}` | `{"behavior": "flag"}` | NIN's 2 idli (150 kcal) implies about 117 g of USDA idli, not 76 g: the count and the weight describe different preparations |
| 1 plate upma | `{"behavior": "log", "items": [{"food": "^Upma$", "grams": [136.5, 150.9], "assumption": true}]}` | `{"behavior": "flag"}` | NIN's 1 cup (270 kcal) implies about 310 g of USDA upma, not 144 g: more than 2x apart |

Authorised explicitly by the owner as a correction to the earlier approval. "1 plate rice" is unchanged (rationale
wording only: NIN's 1-cup serving, not a NIN plate). Set D after increment 5: 199 correct, 7 safely uncertain, 11 known
incorrect (all food-matching findings), 0 unexpected.

## Food-matching review (2026-11-20)

No Set D expectation changed. Outcomes against the increment-5 baseline (199 / 7 / 11 known / 0 unexpected):

| Phrase | Was | Now |
|---|---|---|
| chicken fried rice, fruit salad, chicken wings, mac and cheese | known incorrect (wrong food) | correct (reviewed dish) |
| chicken tikka, egg roll, spring roll, 1 tbsp oil | known incorrect (logged where it should ask) | correct (asked, as expected) |
| 2 paratha with raita | known incorrect (cucumber raita) | correct (paratha logged, raita asked) |
| tandoori chicken | known incorrect (CoFID curry) | safely uncertain (asked; INDB dish offered, whole-bird portion) |
| tea and biscuits | known incorrect (US bread biscuit) | safely uncertain (biscuits asked; expectation open for the owner) |

Set D now: 208 correct, 9 safely uncertain, 0 known incorrect, 0 unexpected.

## Owner decision: tea and biscuits (2026-11-20)

| Phrase | Before | After | Reason |
|---|---|---|---|
| tea and biscuits | `{"behavior": "log", "items": [tea, "^Cookie, NFS$\\|^Cookie, butter or sugar$"]}` | `{"behavior": "log", "items": [tea], "ask": ["biscuits?"], "uncertain": true}` | Culturally ambiguous; Cookie, NFS (492 kcal/100 g) differs materially from the Indian biscuits in the catalog (381-406). Log tea, ask which biscuits |

The new `uncertain` flag scores the case safely uncertain when the app behaves as expected, never correct automatic
logging. No matching code changed. Set D: 208 correct, 9 safely uncertain, 0 incorrect, 0 unexpected.

## Owner decision: paratha with raita (2026-11-20)

| Phrase | Before | After | Reason |
|---|---|---|---|
| 2 paratha with raita | `{"behavior": "log", "items": [paratha], "ask": ["raita"]}` | `{"behavior": "log", "items": [paratha], "ask": ["raita"], "uncertain": true}` | 23 raitas, no generic one: logging the parathas and asking which raita is the best outcome, so it scores safely uncertain, like tea and biscuits |

The `uncertain` flag stays explicit and reviewed per case: the judge never applies it on its own to a partial log
with a question. No matching code changed.

