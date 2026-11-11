// Homepage: hero with the live meal → Nutrition Facts demo, input types, features, code samples.
import { Link } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Demo } from './home/Demo.tsx';
import { CodeSamples } from './home/CodeSamples.tsx';
import { BARCODE_BITS } from './home/demo.ts';
import { PAYMENTS_VISIBLE } from '../features.ts';

export function Home() {
  return (
    <main>
      {/* Hero: the product, working */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="kicker">Nutrition API</span>
            <h1>Describe a meal.<br />Get the <em>nutrition label</em>.</h1>
            <p className="lead">Nutrikit turns what people type, say, snap or scan into matched foods, real portions and up to 33 nutrients — through one API key and a tiny SDK.</p>
            <div className="cta-row">
              <Link className="btn btn-primary" to="/signup">Get a free API key <span className="arrow">→</span></Link>
              <Link className="btn btn-ghost" to="/docs">Read the docs</Link>
            </div>
            <div className="hero-note">
              <span><Icon name="check" />2,000 free tokens a month</span>
              <span><Icon name="check" />No card</span>
              <span><Icon name="check" />Key in 30 seconds</span>
            </div>
          </div>

          <Demo />
        </div>
      </section>

      {/* Inputs */}
      <section className="wrap" id="how" aria-label="Input types">
        <div className="modes">
          <div className="mode"><Icon name="text" /><b>Text</b><span>“A bowl of oatmeal and a coffee” — split, matched and sized.</span></div>
          <div className="mode"><Icon name="mic" /><b>Voice</b><span>Speech recognised on-device; filler words removed.</span></div>
          <div className="mode"><Icon name="camera" /><b>Photo</b><span>Each food on the plate, with an estimated weight.</span></div>
          <div className="mode"><Icon name="barcode" /><b>Barcode</b><span>EAN and UPC lookups across millions of products.</span></div>
          <div className="mode"><Icon name="label" /><b>Label</b><span>Nutrition Facts text or photo, per serving and per 100 g.</span></div>
        </div>
      </section>

      {/* What you can build */}
      <section className="block">
        <div className="wrap">
          <div className="section-head">
            <span className="kicker">What's inside</span>
            <h2>The boring, hard parts of food logging — <em>done</em>.</h2>
            <p className="lead">Food databases, unit conversion and portion sizes are where nutrition features get stuck. Nutrikit handles them so your app can focus on people.</p>
          </div>

          <div className="bento">
            <article className="tile span-4">
              <h3>Search that knows “banana” means a banana.</h3>
              <p>Ranking tuned for logging puts the everyday, as-eaten food first — not banana pudding or banana chips.</p>
              <div className="mini art" aria-hidden="true">
                <div className="mini-search"><Icon name="search" />banana<span className="caret"></span></div>
                <div className="mini-result top"><span>Banana, raw</span><small>122 kcal · 1 banana</small></div>
                <div className="mini-result"><span>Banana, baked</span><small>Bananas</small></div>
                <div className="mini-result"><span>Bananas, overripe, raw</span><small>Bananas</small></div>
              </div>
            </article>

            <article className="tile span-2 tomato">
              <h3>Portions in plain language.</h3>
              <p>Say it how people say it. Get grams back.</p>
              <div className="convert art" aria-hidden="true" style={{ color: 'var(--ink)' }}>
                <div className="convert-row"><b>1½ cups rice</b><span className="to">→ 237 g</span></div>
                <div className="convert-row"><b>a handful of almonds</b><span className="to">→ 28 g</span></div>
                <div className="convert-row"><b>12 oz orange juice</b><span className="to">→ 372 g</span></div>
              </div>
            </article>

            <article className="tile span-2 dark">
              <h3>Photos, plated.</h3>
              <p>Every food on the plate, weighed by eye.</p>
              <div className="plate art" aria-hidden="true">
                <div className="ring"></div>
                <i className="food salmon"></i><i className="food rice"></i><i className="food broccoli"></i>
                <span className="tag" style={{ top: 22, left: 8 }}>salmon · 150 g</span>
                <span className="tag" style={{ top: 96, right: 2 }}>rice · 158 g</span>
                <span className="tag" style={{ bottom: 14, left: 22 }}>broccoli · 78 g</span>
              </div>
            </article>

            <article className="tile span-2">
              <h3>Scan the packet.</h3>
              <p>Barcodes resolve to brand, serving size and nutrients.</p>
              <div className="art" aria-hidden="true">
                <div className="barcode">
                  {[...BARCODE_BITS].map((b, n) => <i key={n} style={{ flex: 1, opacity: b === '1' ? 1 : 0 }}></i>)}
                </div>
                <p className="mono small muted" style={{ marginTop: 8, letterSpacing: '.3em' }}>3 017624 010701</p>
              </div>
            </article>

            <article className="tile span-2">
              <h3>Plans that add up.</h3>
              <p>1–7 days for a calorie target and six diets.</p>
              <div className="plan-mini art" aria-hidden="true">
                <div><span>Breakfast</span><span>Greek yogurt, berries</span><span>480</span></div>
                <div><span>Lunch</span><span>Lentil soup, apple</span><span>640</span></div>
                <div><span>Dinner</span><span>Tofu stir-fry, rice</span><span>720</span></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Developers */}
      <section className="wrap">
        <div className="dev">
          <div>
            <span className="kicker">For developers</span>
            <h2>Five minutes from key to <em style={{ color: 'var(--butter)' }}>first meal</em>.</h2>
            <p>A REST API with an OpenAPI spec, and a dependency-free SDK for browsers and Node.</p>
            <ul>
              <li><Icon name="bolt" /><div><b>Every call has a price tag</b>Responses carry <code>X-Tokens-Charged</code>, so cost is never a surprise.</div></li>
              <li><Icon name="key" /><div><b>Safe for apps</b>Swap your secret key for a 1-hour access token and ship that instead.</div></li>
              <li><Icon name="shield" /><div><b>Open, citable data</b>USDA FoodData Central and Open Food Facts — no black box.</div></li>
            </ul>
          </div>
          <CodeSamples />
        </div>
      </section>

      {/* Figures */}
      <section className="block">
        <div className="wrap">
          <div className="figures">
            <div className="figure"><b>13,359</b><span>foods with full nutrient profiles</span></div>
            <div className="figure"><b>30,512</b><span>household portions — cups, slices, pieces</span></div>
            <div className="figure"><b>33</b><span>nutrients, each with % daily value</span></div>
            <div className="figure"><b>1</b><span>key for all of it</span></div>
          </div>
        </div>
      </section>

      <section className="wrap closing">
        <h2>Ship the nutrition feature <em>this week</em>.</h2>
        <p className="lead" style={{ margin: '0 auto 28px' }}>{PAYMENTS_VISIBLE ? 'Free plan, no card. Upgrade only when your users show up.' : 'Free plan, no card.'}</p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/signup">Create your free account <span className="arrow">→</span></Link>
          {PAYMENTS_VISIBLE ? <Link className="btn btn-ghost" to="/pricing">See pricing</Link> : null}
        </div>
      </section>
    </main>
  );
}
