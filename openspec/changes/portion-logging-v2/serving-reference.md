# Serving reference table (for review, not yet adopted)

Status: revised after the owner's Set D v1 corrections (2026-11-19); awaiting approval. Nothing in the app uses these
figures yet. §D holds the adopted definitions that Set D v2 now tests; the app is expected to fail those cases until
Portion & Logging v2 implements them.

## A. How to read this

- **Origin:** the research below (§C) was done by a research agent working from published sources only:
  - ICMR-NIN Dietary Guidelines 2024 and 2011
  - USDA FNDDS 2021–2023
  - peer-reviewed Indian portion-size studies
  - Indian Journal of Dairy Science market studies

  No recipe blogs or calorie apps were used, and no AI APIs.
- **Verification by the main session, 2026-11-19:**
  - **All 20 USDA FNDDS figures cited match the catalog's own portions exactly** (`server/data/foods.db`): roti
    27/40/52 g, idli 38, dosa 35/80/155, vada 30, samosa 25/100, puri 36, paratha 70, upma 170 per US cup, biryani
    196/172, rice pilaf 206, white rice 158, dal 240, sambar 248, vegetable curry 240, yogurt 245, firni 260, barfi 45,
    ladoo 60.
  - **The NIN and journal quotes were not re-checked independently.** The NIN 2011 PDF is an image scan and no
    text-extraction tool is installed here. They rest on the agent's reading, with page and table references, so
    please spot-check the few the decisions below depend on.
- **Confidence (from the research):** 5 high, 24 medium, 7 low, 5 UNKNOWN (pav bhaji, chole bhature, rajma chawal and
  manchurian plates; jalebi piece).

## B. What this means for Nutrikit, and the decisions needed

Compared with what the app assumes today:

| Measure | App today | Published evidence | Gap |
|---|---|---|---|
| Katori / cup | 1 US cup = 236.6 ml (`utensils.ts`) | **200 ml** (NIN 2024 Annexure I, high; NIN 2011, high) | app is 18% larger |
| Glass | 1 US cup = 236.6 ml | 200 ml (NIN 2011) to about 250 ml (NIN 2024 "eight glasses ≈ two litres"); 306 ml observed | sources disagree |
| Teaspoon of oil or ghee | 4.5–4.7 g (USDA) | 5 g (NIN 2024, high) | small |
| 1 roti | 36 g (INDB home roti) | FNDDS 27/40/52 g (small/medium/large); raw flour 20–35 g | consistent |
| 1 plate idli | 38 g (one idli: **bug**) | NIN serving 2 pieces = 76 g; NIN menus 3–4 pieces | plate ≠ 1 piece |
| 1 plate biryani or rice | 196 / 158 g (1 US cup) | rice: NIN 1 cup (200 ml) ≈ 134 g; observed median 140 g; NIN menus 2 cups for a man. Biryani: **no plate source** | plate undefined |
| 1 bowl dal | 240 g (1 US cup) | NIN serving ½ cup ≈ 100 g; 200 ml katori ≈ 203 g; observed median 242 g | 2x spread |

The owner's decisions on these points are recorded in §D, which supersedes the options first proposed here.

## C. Research (verbatim from the research agent's report)


Prepared for Nutrikit serving-size review. Research date: 2026-11-19.

## Method

**Sources searched and opened**

- **ICMR-NIN, *Dietary Guidelines for Indians* (Revised Edition 2024).** The live NIN URL returns HTTP 404. I opened the Internet Archive copy (snapshot 2026-03-11) and extracted its text in full, all 147 PDF pages.
- **NIN, *Dietary Guidelines for Indians – A Manual* (2nd edition, 2011).** Full PDF from nin.res.in.
- **USDA FoodData Central, FNDDS 2021–2023 survey foods.** This is the official CSV release dated 2024-10-31, read from `food_portion.csv`. The FDC search API's DEMO_KEY hit its rate limit, so I used the bulk file instead.
- **Peer-reviewed full texts via Europe PMC** (pmc.ncbi.nlm.nih.gov shows a CAPTCHA, which I did not bypass):
  - Gupta N et al. 2016
  - Banerjee J et al. 2025 (LASI-DAD)
  - Ghosh-Jerath S et al. 2025
  - Gupta A et al. 2025
  - Bhagtani D et al. 2025 (South Asia Intake24)
  - Daniel CR et al. (NINA-DISH): no gram data found
- **Other journal articles:**
  - Sharma & Chadha 2020 (journal website)
  - Indian Journal of Dairy Science abstracts for market gulab jamun (2021) and market rasogolla (2017)
- **MDRF / Dr. Mohan's "Atlas of Indian Foods"** product page. This is low weight: a commercial atlas, and I saw only the publisher's description, not the book.
- **NIN "My Plate" policy brief (2024) and NIN "What India Eats" (2020).** Both opened; neither gives household portion weights.

**Not accessible or not used**

- **UK "Food Portion Sizes" (MAFF/FSA, Mills & Patel; 3rd ed. 2002).** No open copy found. archive.org holds the 1988 and 1993 editions as borrow-only, so I did not read them. No figures are taken from it.
- **FSSAI.** I found no FSSAI publication that gives gram weights for household servings. The 2022 labelling guidance only requires outlets to declare a serve size on menus.
- **IFCT 2017.** It gives raw-food composition per 100 g, with no household portions, so I did not use it for portions.
- **Recipe blogs and calorie apps.** These showed up in searches and were excluded, as the brief requires.
- **INDB per-serving weights.** Excluded, as the brief requires.

**Key definitions used throughout**

- **FNDDS "1 cup"** is the US 8 fl oz cup (≈236.6 ml). Where I scale an FNDDS cup weight to a 200 ml Indian cup or katori, the arithmetic is shown. These scaled values assume the food's density is the same at both volumes.
- **DGI 2011 Annexure 8** gives the number of pieces or the volume per serving, plus kcal. It gives **no gram weights**.
- **The "1 plate" problem.** Neither NIN edition defines "1 plate" for any dish. Where I give a plate figure, it is built from NIN's "quantity for one serving" plus a weight per piece or per volume from another source.

**Raw vs as-eaten**

- DGI 2011 Annexure 14 and DGI 2024 Annexure II give **raw** weights, for example cereal at 30 g raw per portion.
- FNDDS, Sharma & Chadha (except where noted), and the dairy-science papers give **as-eaten** weights.
- No raw-to-cooked conversion was made.

---

## 1. Plates / servings (as eaten)

| Food, serving | Pieces / volume | Reference weight (g) | Source(s) | Confidence | Evidence (quoted) | Disagreements / notes |
|---|---|---|---|---|---|---|
| Idli, 1 plate | **2 pieces** per serving (DGI 2011). Sample breakfast: 4 for a sedentary man, 3 for a sedentary woman. | **76 g as-eaten** (2 × 38 g). FNDDS default "Quantity not specified" is also 76 g. | [S2] Annex 8, p.106; Annex 2a/2b pp.87–88. [S3] FNDDS 55702000. | medium (arithmetic: 2 × 38 g) | S2: "Idli 2 Nos. 150" (kcal). S3: "1 item = 38.0 g"; "Quantity not specified = 76.0 g". | DGI sample menus imply 3–4 idli per breakfast, which is 114–152 g at 38 g each. |
| Dosa (plain), 1 plate | **1 piece** per serving | 80 g as-eaten (FNDDS medium). Small 35 g, large 155 g. | [S2] Annex 8. [S3] FNDDS 55702100. [S10] MDRF atlas. | medium | S2: "Dosa 1 No. 125". S3: "1 medium = 80.0 g". | MDRF atlas: small dosa 55 g, large dosa 80 g. So MDRF's *large* equals FNDDS *medium*. DGI sample menus allow 2–3 dosa per breakfast. Masala dosa: FNDDS "Dosa, with filling" medium is 267 g. |
| Vada, 1 plate | **2 pieces** per serving | **60 g as-eaten** (2 × 30 g). FNDDS default is also 60 g. | [S2] Annex 8. [S3] FNDDS 58175000. | medium (arithmetic) | S2: "Vada 2 Nos. 140". S3: "1 item, any size = 30.0 g". | Only one weight source exists. FNDDS "Vada" is generic, not specifically medu vada. |
| Poha, 1 plate | **1 cup = 200 ml** | Weight UNKNOWN. No source gives grams for cooked poha. | [S2] Annex 8 and p.87 ("1 Cup = 200 ml") | low (volume only) | S2: "Poha 1 cup 270". | FNDDS has no poha entry. |
| Upma, 1 plate | **1 cup = 200 ml** (DGI 2011). Sample menu: 1½ cups for a man, 1 cup for a woman. | 170 g per US cup (FNDDS). Scaled to 200 ml: 170 × 200 / 236.6 ≈ **144 g**. | [S2] Annex 8. [S3] FNDDS 58174000. | medium (arithmetic) | S2: "Upma 1 cup 270". S3: "1 cup, cooked = 170.0 g". | The scaled figure assumes the same packing density. |
| Biryani, 1 plate | none defined | FNDDS: 196 g per US cup; default 245 g (meat or chicken). Veg biryani: 172 g per cup; default 215 g. | [S3] FNDDS 27213010, 27243100, 58160000 | low (no plate definition) | S3: "1 cup = 196.0 g"; "Quantity not specified = 245.0 g". | No Indian source defines a biryani plate. The FNDDS default is US intake data, not an Indian plate. |
| Pulao, 1 plate | none defined | 206 g per US cup (FNDDS "Rice pilaf", not an Indian pulao) | [S3] FNDDS 58162310 | low | S3: "1 cup = 206.0 g". | Proxy food only. |
| Plain cooked rice, 1 plate | **1 cup = 200 ml** per serving (DGI 2011). Sample menu: "Rice 2 Cups" per meal for a man, 1 cup for a woman. | FNDDS 158 g per US cup; scaled to 200 ml ≈ **134 g**. Observed median per eating occasion: **140 g** (P25–P75: 110–205 g). | [S2] Annex 8, p.87. [S3] FNDDS 56205008. [S4] Table 2. | medium | S2: "Rice 1 cup 170". S3: "1 cup, cooked = 158.0 g". S4: "140 (110,205)", household measure Bowl-2. | The two weight sources agree (134 vs 140 g). DGI's own menu serves 2 cups (≈268 g) per meal for a man. Intake24 South Asia notes rice "is commonly eaten in larger portions". |
| Khichdi, 1 plate | **1 cup = 200 ml** | Weight UNKNOWN | [S2] Annex 8 | low (volume only) | S2: "Kichidi 1 cup 200". | No FNDDS entry. |
| Pav bhaji, 1 plate (bhaji + pav) | — | **UNKNOWN** | — | UNKNOWN | — | See the UNKNOWN list. |
| Chole bhature, 1 plate | — | **UNKNOWN** for the plate. Component only: chole curry median 188 g per eating occasion (P25–P75: 184–356). | [S4] Table 2 (component only) | UNKNOWN | S4: "188 (184,356)", household measure Bowl-1. | No source gives a bhatura weight. |
| Rajma chawal, 1 plate | — | **UNKNOWN** for the plate. Components: rajmah curry median 236 g; boiled rice median 140 g per eating occasion. | [S4] Table 2 | UNKNOWN | S4: "236 (228.5,343)". | FNDDS "Kidney beans and white rice" is 170 g per cup, but that is a US dish, not rajma chawal. |
| Manchurian, 1 plate | — | **UNKNOWN** | — | UNKNOWN | — | — |

## 2. Bowls / katori (as eaten)

| Food, serving | Pieces / volume | Reference weight (g) | Source(s) | Confidence | Evidence (quoted) | Disagreements / notes |
|---|---|---|---|---|---|---|
| **Standard katori volume** | Large 360 ml; **medium 200 ml**; small 155 ml and 115 ml. Diet charts state "1 cup/Katori = 200ml". | — | [S1] Annexure I, p.111; diet-chart footnotes pp.63, 65, 103 | **high** | S1: "Medium Katori C7 - 200ml"; "1 cup/Katori =200ml". | Banerjee 2025 (LASI-DAD) also gives katori = 200 ml. Ghosh-Jerath 2025 uses a 210 ml katori. NNMB reference sizes differ; see the next row. |
| **Standard bowl volume** | No single standard. NNMB reference set: small 105, medium 140, large 200 ml. Urban Delhi: Bowl-1 200 ml, Bowl-2 250 ml. Rural Haryana: small 240, medium 320, large 600 ml. | — | [S5] Gupta N 2016 Methods/Results. [S4] Table 2 footnote. [S6] Fig. 2 | medium (sources disagree) | S5: "small-105 mL, medium-140 mL, and large-200 mL". S4: "Bowl-1: 200ml, Bowl-2: 250 ml". | Gupta N 2016 found local bowls were "56-67% larger" than the NNMB reference sizes. |
| Dal, 1 bowl/katori | DGI 2011 serving: **½ cup (100 ml)** of plain dal. Sambar is 1 cup. | FNDDS "Dal" 240 g per US cup; 200 ml katori ≈ **203 g**. Observed median per eating occasion: red gram dal 242 g (Bowl-2). | [S2] Annex 8. [S3] FNDDS 41305050. [S4] Table 2. | medium (arithmetic) | S2: "Plain dhal ½ cup 100". S3: "1 cup = 240.0 g". S4: "242 (212,341)". | NIN's serving (½ cup ≈ 100 g) is about half of one full 200 ml katori, and about 40% of the observed Delhi median. |
| Sabzi (dry vegetable), 1 katori | DGI 2011 serving: **1 cup** dry vegetable | Observed median per eating occasion: mixed dry vegetable **156 g** (Bowl-1 = 200 ml). Cauliflower-potato: 220 g. Fenugreek-potato: 154 g. | [S2] Annex 8. [S4] Table 2. | medium | S2: "Dry 1 cup 150" (kcal). S4: "156 (105,191)", Bowl-1. | Only one weight source. DGI sample menus give "Veg. curry ¾ Cup" per meal. |
| Curry with gravy, 1 bowl | DGI 2011 serving: **1 cup** vegetable with gravy; ¾ cup for meat curries | FNDDS vegetable curry 240 g per US cup; 200 ml ≈ **203 g**. Chicken curry is also 240 g per cup. | [S2] Annex 8. [S3] FNDDS 75440600, 27146150. | medium (arithmetic) | S2: "With gravy 1 cup 170". S3: "1 cup = 240.0 g". | NIN's meat-curry serving is ¾ cup (150 ml ≈ 152 g by the same scaling). |
| Raita, 1 katori | Bowl-1 = 200 ml | Observed median per eating occasion: boondi raita **169 g** (P25–P75: 126–169) | [S4] Table 2 | medium (one source) | S4: "169 (126,169)", Bowl-1. | Sharma & Chadha report raita (and curd) by weight as served. They list these as exceptions to their cooked-weight basis. |
| Curd / dahi, 1 katori | Observed at ¾ of Bowl-1 (≈150 ml) | Observed median per eating occasion **142 g**. FNDDS plain yogurt 245 g per US cup, so 200 ml ≈ **207 g**. | [S4] Table 2. [S3] FNDDS 11411100. | medium | S4: "142 (142,208)", ¾ Bowl-1. S3: "1 cup = 245.0 g". | DGI 2011 menus: "Curd 1/2 Cup" (100 ml). DGI 2024 diet charts: "Curd 100ml" or "150ml". So 100, 142 and 207 g all have a source, depending on whether the definition is a serving or a full katori. |
| Kheer, 1 katori | — | Proxy only: FNDDS "Firni, Indian pudding" 260 g per US cup; 200 ml ≈ **220 g** | [S3] FNDDS 13210450 | low (firni is not kheer) | S3: "1 cup = 260.0 g". | DGI 2011 has no kheer serving. Its nearest desserts (halwa, double ka meetha) are ½ cup. |
| Sambar, 1 bowl | DGI 2011 serving: **1 cup = 200 ml** | FNDDS 248 g per US cup; 200 ml ≈ **210 g** | [S2] Annex 8. [S3] FNDDS 41311020. | medium (arithmetic) | S2: "Sambar 1 cup 110". S3: "1 cup = 248.0 g". | — |

## 3. Household measures

| Measure | Volume | Weight | Source(s) | Confidence | Evidence (quoted) | Disagreements / notes |
|---|---|---|---|---|---|---|
| 1 cup | **200 ml** | — | [S1] diet-chart footnotes pp.63, 65, 103. [S2] p.109 and p.87. | **high** | S1: "1 cup/Katori =200ml". S2: "Cup 200 ml". | Tea cup in Delhi homes: 170 ml (S4 Cup-1). The US measuring cup used in FNDDS and in Gupta N 2016 is ≈240 ml. |
| 1 glass | ≈**250 ml** (derived) or **200 ml** (stated) | — | [S1] Guideline 14, p.89. [S2] Annex 8, p.108. [S6]. [S7]. [S4]. | medium (sources disagree) | S1: "eight glasses (approximately two litres)", which gives ≈250 ml per glass. S2: "1 cup/glass (200 ml)". S6: "standard glass ... measures 200 ml". | Gupta A 2025: "250–300 mL/1 glass". Sharma & Chadha: Glass-1 = 306 ml (milk glass). Range across sources: 200–306 ml. |
| 1 tablespoon | **15 ml** | DGI 2024 prints "15g" | [S2] p.109. [S1] Annexure I. [S6]. | **high** | S2: "Tablespoon - 15 ml". S1: "Tablespoon 15g". | DGI 2024 states it in grams. FNDDS ghee and vegetable oil: "1 tablespoon = 14.0 g". |
| 1 teaspoon | **5 ml** | DGI 2024 prints "5g" | [S2] p.109. [S1] Annexure I. [S6]. | **high** | S2: "Teaspoon - 5 ml". S1: "Teaspoon 5g". | — |
| Oil / ghee, 1 tsp (and 1 tbsp) | 5 ml | **5 g per tsp** (DGI 2024). 14 g per tbsp (FNDDS). | [S1] Annexure II, pp.113–115. [S7] Table. [S3] FNDDS 81204000, 82101000. | **high** (tsp) | S1: "Oil/ghee 5 1 teaspoon". S7: "30 g/6 tsp". S3: "1 tablespoon = 14.0 g". | 5 g per tsp × 3 = 15 g per tbsp (NIN), against FNDDS's 14 g per tbsp. The difference is small. |
| Sugar, 1 tsp | 5 ml | **4.2 g** (FNDDS). NIN gives a generic "5g" teaspoon. | [S3] FNDDS 91101010. [S1] Annexure I. | medium (disagreement) | S3: "1 teaspoon = 4.2 g". | NIN does not give a sugar-specific teaspoon weight. Salt: DGI 2024 p.74 says "5g (1 teaspoon) of common salt". |

## 4. Pieces (as eaten)

| Food, 1 piece | Size | Reference weight (g) | Source(s) | Confidence | Evidence (quoted) | Disagreements / notes |
|---|---|---|---|---|---|---|
| Roti / chapati | 6″ / 7″ / 8″ | **27 / 40 / 52 g** as-eaten (small / medium / large) | [S3] FNDDS 51300175 | medium | S3: "1 medium chappatti or roti (7") = 40.0 g". | **Raw flour per roti varies by source:** Ghosh-Jerath 2025: "1 roti=20 g raw atta". Sharma & Chadha: median 70 g flour for a median 2 chapatis, which is about 35 g raw flour each (derived). INDB home roti: 36 g. Intake24 South Asia found its chapati/roti portions were set too high. |
| Phulka | — | Weight UNKNOWN. DGI 2011 uses "1 No." as the serving unit. Nearest proxy: FNDDS small 6″ roti, 27 g. | [S2] Annex 8. [S3]. | low | S2: "Phulka 1 No. 80" (kcal). | No source gives a phulka weight. |
| Paratha (plain) | — | **70 g** as-eaten | [S3] FNDDS 51300185 | medium (one source) | S3: "1 paratha = 70.0 g". | Sharma & Chadha: median 60 g flour for a median 2 parathas (raw flour, ≈30 g each; derived). |
| Puri | ≈4.8″ diameter | **36 g** as-eaten | [S3] FNDDS 51300180 | medium (one source) | S3: "1 puri (approx 4-4/5" dia) = 36.0 g". | DGI 2011 serving is "1 No." (80 kcal). |
| Idli | — | **38 g** as-eaten | [S3] FNDDS 55702000 | medium (one source) | S3: "1 item = 38.0 g". | No Indian source found that weighs an idli. |
| Dosa (plain) | small / medium / large | **35 / 80 / 155 g** | [S3] FNDDS 55702100. [S10]. | medium | S3: "1 medium = 80.0 g". S10: "small dosa (55 g)", "large dosa (80 g)". | The MDRF size labels sit one step lower than FNDDS (see the plates table). |
| Medu vada | — | **30 g** (FNDDS generic "Vada") | [S3] FNDDS 58175000 | medium | S3: "1 item, any size = 30.0 g". | The FNDDS item is not named "medu", so treat it with caution. |
| Samosa | small / regular-large | **25 g / 100 g** | [S3] FNDDS 58124500 | medium (one source) | S3: "1 regular/large = 100.0 g". | DGI 2011 serving is "1 No." (200 kcal). |
| Rasgulla | — | **15.7–43.4 g** per piece (range across six market brands; mean ± SD per brand) | [S8] IJDS 2017 abstract | medium | S8: "Unit weight ... varied from 15.742±0.907 g to 43.352±1.331 g". | The abstract does not say whether syrup was included. INDB's 342 g "serving" is several pieces plus syrup and is not comparable. |
| Gulab jamun | — | **24.2–44.4 g** per piece (range across market samples) | [S9] IJDS 2021 abstract | medium | S9: "24.21±0.29 to 44.40±0.45 g". | The abstract does not say whether syrup was included. Diameters were about 3.1–3.6 cm (search snippet only, not verified). |
| Ladoo (besan) | round ball | **60 g** (FNDDS generic "Ladoo") | [S3] FNDDS 91718300 | low (not besan-specific) | S3: "1 piece = 60.0 g". | DGI 2011 lists "Besan barfi 2 small pieces 400" (kcal), not ladoo. |
| Burfi | — | **45 g** per piece (21 g per cubic inch) | [S3] FNDDS 13252500 | medium (one source) | S3: "1 piece = 45.0 g". | DGI 2011 serving is "2 small pieces" of besan barfi, but no weight is given. |
| Jalebi | — | **UNKNOWN** | — | UNKNOWN | — | See the UNKNOWN list. |

---

## Sources

- **[S1]** ICMR-National Institute of Nutrition. *Dietary Guidelines for Indians*, Revised Edition 2024. Hyderabad: ICMR-NIN, 2024.
  - Pages used: Annexure I "Suggested measuring katori/cups and spoons" (printed p.111) and "General considerations for measuring food items" (p.112); Annexure II "Raw food item measures using household utensils" (pp.113–115); diet-chart footnotes (pp.63, 65, 103); Guideline 14 (p.89); salt (p.74).
  - Original URL (now 404): https://www.nin.res.in/dietaryguidelines/pdfjs/locale/DGI24thJune2024fin.pdf
  - Opened via: https://web.archive.org/web/20260311091911/https://www.nin.res.in/dietaryguidelines/pdfjs/locale/DGI24thJune2024fin.pdf
- **[S2]** National Institute of Nutrition. *Dietary Guidelines for Indians – A Manual*, 2nd edition. Hyderabad: NIN (ICMR), 2011.
  - Pages used: Annexure 2/2a/2b (pp.86–88); Annexure 8 "Approximate Calorific Value of Some Cooked Preparations" (pp.106–108); "Size of Teaspoon, Tablespoon and Cup" (p.109); Annexure 14 "Portion Sizes and Menu Plan", raw portions (p.117).
  - URL: https://nin.res.in/downloads/DietaryGuidelinesforNINwebsite.pdf
- **[S3]** U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, Survey (FNDDS) 2021–2023 foods, `food_portion.csv`, CSV release 2024-10-31.
  - URL: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip
  - FDC IDs:

    | Food | FDC ID |
    |---|---|
    | Idli | 2708346 |
    | Dosa, plain | 2708347 |
    | Dosa, with filling | 2709129 |
    | Vada | 2709130 |
    | Samosa | 2708730 |
    | Chapati/roti | 2707713 |
    | Puri | 2707714 |
    | Paratha | 2707715 |
    | Naan | 2707613 |
    | Upma | 2709128 |
    | Biryani with meat | 2706490 |
    | Biryani with chicken | 2706538 |
    | Biryani with vegetables | 2708985 |
    | Rice pilaf | 2709077 |
    | White rice, cooked | 2708408 |
    | Dal | 2707427 |
    | Sambar | 2707430 |
    | Vegetable curry | 2710067 |
    | Chicken curry | 2706437 |
    | Plain yogurt | 2705418 |
    | Firni | 2705686 |
    | Barfi | 2705700 |
    | Ladoo | 2710351 |
    | Ghee | 2710168 |
    | Vegetable oil | 2710180 |
    | Sugar | 2710258 |

  - Individual pages follow the pattern https://fdc.nal.usda.gov/food-details/<FDC ID>/portions. I did not open those pages individually; the values come from the bulk file.
- **[S4]** Sharma V, Chadha R. "Assessment of Portion Sizes of Food Items Commonly Consumed by Urban Indian Adults: A Preliminary Study." *Current Research in Nutrition and Food Science* 2020; 8(1). doi:10.12944/CRNFSJ.8.1.17.
  - Table 2 covers main meals and Table 3 covers in-between meals. n = 60 adults, Delhi.
  - The values are portion sizes per eating occasion, not "1 bowl".
  - URL: http://www.foodandnutritionjournal.org/volume8number1/assessment-of-portion-sizes-of-food-items-commonly-consumed-by-urban-indian-adults-a-preliminary-study/
- **[S5]** Gupta N, Verma S, Singh A, Tandon N, Puri S, Arora NK. "Adaptation of Locally Available Portion Sizes for Food Frequency Questionnaires in Nutritional Epidemiological Studies: How Much Difference does it Make?" *Indian J Community Med* 2016; 41(3): 228–234. doi:10.4103/0970-0218.183596.
  - Sections used: Methods; Tables 1–2.
  - Opened via: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4919938/fullTextXML
- **[S6]** Banerjee J, Chutani AM, et al. "Methodological considerations of diet assessment of the older Indian population in the longitudinal aging study in India—Harmonised Diagnostic Assessment of Dementia (LASI-DAD)." *BMC Public Health* 2025; 25: 3661. doi:10.1186/s12889-025-24970-9.
  - Section used: Fig. 2 legend.
  - Opened via: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12573831/fullTextXML
- **[S7]** Gupta A, Pramod K, Aggarwal A, et al. "Nutrition Care Model for Nutritional Assessment and Dietary Counseling of Adults Living with HIV in India." *Indian J Community Med* 2025; 50: 407. doi:10.4103/ijcm.ijcm_580_23.
  - Section used: diet-plan table.
  - Opened via: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12156091/fullTextXML
- **[S8]** Srinivasa K, Barnwal P, Singh P. "Selected Physical, Colour and Textural Characteristics of Market Rasogolla." *Indian Journal of Dairy Science* 2017; 70(2). Abstract only.
  - URL: https://epubs.icar.org.in/index.php/IJDS/article/view/61164
- **[S9]** Sukre VN, Barnwal P, Chavhan BB, Deep A, Bhagat PN. "Evaluation of selected physico-chemical, colour and textural characteristics of market Gulabjamun." *Indian Journal of Dairy Science* 2021; 74(6). Abstract only.
  - URL: https://epubs.icar.org.in/index.php/IJDS/article/view/103349
- **[S10]** Madras Diabetes Research Foundation / Dr. Mohan's Diabetes Specialities Centre. *Atlas of Indian Foods* (first published 2013). Product description page, dated 2019-08-01. I did not see the book itself.
  - URL: https://drmohans.com/atlas-of-indian-foods/
- **[S11]** Ghosh-Jerath S, Singh A, Suresh M, et al. "Development of an Indian-adapted anti-inflammatory Mediterranean diet for coronary artery disease patients." *BMC Nutrition* 2025; 11: 129. doi:10.1186/s40795-025-01102-5.
  - Section used: food-group serving table.
  - Opened via: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12228395/fullTextXML
- **[S12]** Bhagtani D, Amoutzopoulos B, et al. "The Adaptation, Implementation, and Performance Evaluation of Intake24, a Digital 24-h Dietary Recall Tool for South Asian Populations: The South Asia Biobank." *Curr Dev Nutr* 2025. doi:10.1016/j.cdnut.2025.104543.
  - Used for qualitative findings only: chapati/paratha portions were set too high, and rice is eaten in larger portions.
  - Opened via: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11847516/fullTextXML

## Entries marked UNKNOWN, and what I tried

1. **Pav bhaji, 1 plate.**
   - Tried: FNDDS bulk file (no entry), both NIN guideline editions (no entry), and Europe PMC searches for Indian portion studies.
   - Sharma & Chadha do not list it. No FSSAI table exists.
2. **Chole bhature, 1 plate.**
   - Tried: the same sources. FNDDS has no bhatura, and neither NIN edition lists it.
   - Only the chole curry component is sourced (S4).
3. **Rajma chawal, 1 plate.**
   - No source defines the combined plate.
   - Components are sourced from S4. The FNDDS "Kidney beans and white rice" entry is a US dish.
4. **Manchurian, 1 plate.**
   - Not in FNDDS, the NIN editions, or any portion study I opened.
5. **Jalebi, 1 piece.**
   - Not in FNDDS or NIN. I searched dairy and food-science literature: the IJDS khoa-jalebi papers cover rheology and sugar diffusion and give no piece weight.
   - Only recipe and calorie-app sites gave piece weights, and those are excluded.

**Partial gaps (volume known, grams unknown):**

- Poha and khichdi: DGI 2011 gives "1 cup" (200 ml), but no source gives a cooked weight.
- Phulka: no weight in any source.
- Kheer: proxy only (firni).
- Besan ladoo: proxy only (generic ladoo).

**Not checked because I could not access it:** UK MAFF/FSA *Food Portion Sizes* (1993 and 2002 editions), which may list chapati, naan, samosa, bhaji and dal.

## D. Adopted definitions (owner corrections, 2026-11-19)

These are the rules Set D v2 (`server/data/eval/sets/D.source.json`, final-review revision) encodes. None of them is
implemented yet.

### D1. Measures (not interchangeable)

| Word | Volume | Status | Source |
|---|---|---|---|
| Katori | 200 ml | cited | ICMR-NIN Dietary Guidelines 2024, Annexure I (medium katori) |
| Small katori | 155 ml or 115 ml | ambiguous: flag and ask | NIN lists both sizes |
| Bowl | 200 ml | **provisional assumption**; a logged item must say so | owner decision; sources span 105–600 ml |
| Glass | 250 ml | **provisional assumption**; a logged item must say so | owner decision; sources span 200–306 ml |
| Cup (any bare "cup") | 236.6 ml: the USDA standard cup, i.e. the food's own USDA "1 cup" portion | cited | USDA FNDDS |
| NIN serving cup | 200 ml | **named assumption**, used only by the NIN plate servings in D3; never for a bare "cup" | NIN 2011 p.109 |
| Teaspoon / tablespoon | 5 ml / 15 ml | cited | NIN 2024 |

**Cup semantics.** A word in a phrase never switches meaning:

- "1 cup dal", "2 cups tea": the USDA standard cup, 236.6 ml, through the food's own USDA cup portion (dal 240 g).
- "1 katori dal": the NIN katori, 200 ml (dal ≈ 203 g). A katori is not a cup, though NIN gives both 200 ml.
- "1 plate rice": no plate exists; the case names the assumption "NIN serving: rice 1 cup (NIN serving cup, 200 ml)"
  and the logged item must label it. This 200 ml applies only inside that named assumption.
- "1 bowl …" and "1 glass …": the provisional 200 ml bowl and 250 ml glass, labelled as assumptions.

### D2. Volume to grams

Grams come from the food's own cited density, never 1 ml = 1 g:

| Food | Cited density | Source |
|---|---|---|
| Dal | 240 g per 236.6 ml (1.014 g/ml) | USDA FNDDS 2707427 |
| Rice, cooked | 158 g per 236.6 ml (0.668 g/ml) | USDA FNDDS 2708402 |
| Yogurt (curd) | 245 g per 236.6 ml | USDA FNDDS 2705418 |
| Sambar | 248 g per 236.6 ml | USDA FNDDS 2707430 |
| Milk | 244 g per 236.6 ml | USDA FNDDS 2705384 |
| Upma | 170 g per 236.6 ml | USDA FNDDS 2709128 |

A food with no cited density (rajma curry, sweet corn soup, cooked poha, **kheer, lassi**) is flagged: the amount is
asked for, not guessed. Kheer and lassi were listed here in the first revision and are withdrawn (D7).

### D3. Plates

Revised by the owner on 2026-11-19 (increment 5), correcting the first approval.

- There is no universal plate weight, and no source defines a plate. NIN 2011 Annexure 8 (p.106, "Approximate
  Calorific Value of Some Cooked Preparations") lists a "Quantity for one serving" with its calories, not a plate
  (checked by the owner against the official NIN PDF; cup = 200 ml on p.109).
- **Plain cooked rice only:** NIN's rice serving is 1 cup of 200 ml at 170 kcal, which agrees with USDA cooked rice
  at 200 ml (about 132 g against 134 g). A plate of plain cooked white rice is logged at 200 ml through USDA density
  as a labelled Nutrikit assumption (`assumed-plate`); NIN does not call it a plate. Brown rice and rice cooked with
  fat, milk or coconut are not covered.
- **Idli and upma are asked about.** Their NIN quantities and the USDA foods we'd weigh them with describe different
  preparations (D9), so combining them would give a plausible-looking but unsupported weight.
- Every other plate (biryani, half plate biryani, poha, pav bhaji, pulao, the four UNKNOWN plates) is asked about.
  A food's own "plate" serving (recipe, INDB or AI estimate) is never used.
- An explicit piece count ("2 idli") is not a plate and is unchanged.

### D4. Sweets

- Rasgulla 15.7–43.4 g and gulab jamun 24.2–44.4 g a piece (IJDS) are **plausibility bounds only**, never defaults or
  midpoints.
- A piece count with no supported weight is flagged. Grams the user gives ("60 g rasgulla") are used as given.

### D5. Food identity

- Expected foods are exact, reviewed catalog names, anchored at both ends; a broad pattern may not hide a wrong match.
  The final-review audit (2026-11-19) rewrote every pattern that wasn't (93, listed in `set-d-v2-changes.md`), and the
  builder now checks that each alternative names a catalog food on its own.
- Reviewed equivalences: fish fry → "Fish, NS as to type, fried"; dal fry / dal tadka → "Dal"; aloo gobi → "Potato
  cauliflower (Aloo gobhi)" or "Curry, cauliflower and potato, homemade".
- Chicken tikka does not accept tandoori chicken or tikka masala; with no dry tikka in the catalog, it is suggested.
- Egg roll (Indian paratha roll vs Chinese roll) and a bare spring roll (veg or meat) are suggested.
- "100 g chicken": no variant is logged, the 100 g is kept in what is listed back, and the user is asked which
  chicken.

### D6. How a logged assumption is recognised

An amount the case marks `assumption` is correct only when the logged item labels it: its `portionMethod` starts with
`assumed` (for example `assumed-bowl`, `assumed-glass`, `assumed-nin-serving`). The method names are a proposal for
the implementation to confirm.

### D7. Kheer density audit (final review, 2026-11-19)

- **What the 240 g is.** `server/data/recipes/kheer.json` (INDB recipe ASC282, rice kheer) lists ingredients (1000 g
  whole milk, 50 g rice, 80 g sugar, 15 g almonds, 15 g raisins, 1 g cardamom), a cooked yield of 700 g, and two
  portions: "1 cup" = 240 g and "1 small bowl" = 150 g. Neither portion carries a source.
- **How it was derived.** It wasn't measured. The INDB importer gives every INDB recipe the same
  `{ label: '1 cup', grams: 240 }` portion (`server/scripts/indb.mjs:273`), and the kheer file's portions date from
  the hand-written recipe commit `8afdd15`. INDB gives a weight yield, not a volume, so no ml-to-g figure can be
  computed from the recipe.
- **Does the recipe support a conversion?** No: there is no volume basis.
- **The firni proxy** (USDA FNDDS "Firni, Indian pudding" 260 g per US cup, §C) is a measured USDA portion but for a
  different dish (ground-rice, thicker), rated low confidence by the research. It is **not adopted**.
- **Decision:** kheer volume-to-grams is **unsupported**. "1 katori kheer" expects flag until a kheer-specific source
  exists.
- **The same check applied to lassi:** `lassi-sweet.json`'s "1 glass = 250 g" and "1 cup = 240 g" are unsourced
  authoring defaults from the same commit, so "1 glass lassi" also expects flag. This follows from the owner rule
  (cited density only); it doesn't change the glass decision.

### D8. Owner decisions on bare "oil" and "raita" (2026-11-19)

The catalog has no generic food for these words, and today's pick is one arbitrary variant. The owner decided:

| Phrase | Logs today | Set D now expects |
|---|---|---|
| "1 tbsp oil" | Oil, palm (one of 76 oils) | suggest: ask which oil, keeping the 1 tbsp; palm oil is not accepted |
| "2 paratha with raita" | Bread, paratha + Cucumber raita (one of 14 raitas) | log the paratha; ask which raita (listed back, never logged or dropped) |

Both are tracked as known incorrect (P1-8) until the matching change lands.

### D9. Data-quality findings from the plate check (open, not fixed)

Neither is to be fixed by inventing a weight.

1. **Idli piece weight.** USDA FNDDS idli is 38 g a piece (128 kcal/100 g). NIN 2011 gives 2 idli at 150 kcal, which
   implies about 117 g, or 58 g a piece. Investigate food identity and preparation differences. "2 idli" still logs
   76 g meanwhile.
2. **Upma energy.** USDA FNDDS upma is 87 kcal/100 g (170 g per US cup). NIN 2011 gives 1 cup (200 ml) at 270 kcal,
   which implies about 310 g at USDA's energy density, or far more energy per gram. Investigate the recipe and the
   nutrient data.
3. **Tandoori chicken serving.** INDB "Tandoori chicken" (878592766) has one portion, "1 chicken" = 1441 g: a whole
   bird, not a serving. So "tandoori chicken" is asked about with that dish offered first rather than logged at
   1441 g (food-matching review, 2026-11-20). Needs a cited piece or serving weight.

