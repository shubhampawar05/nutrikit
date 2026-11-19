// Homepage: live demo hero, input types, the wider feature set, data sources, developer tools, production features, call to action.
import { useEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon.tsx';
import { Demo } from './home/Demo.tsx';
import { CodeSamples } from './home/CodeSamples.tsx';
import { PAYMENTS_VISIBLE } from '../features.ts';

const INPUTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'text', title: 'Text', text: 'Split, matched and sized from a sentence.' },
  { icon: 'mic', title: 'Voice', text: 'Speech recognised on-device.' },
  { icon: 'camera', title: 'Photo', text: 'Every food on the plate, weighed.' },
  { icon: 'barcode', title: 'Barcode', text: 'EAN and UPC across millions of products.' },
  { icon: 'label', title: 'Label', text: 'Nutrition Facts, per serving and 100 g.' },
];

/** Adds .in to each .reveal element the first time it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const els = [...(root.current?.querySelectorAll<HTMLElement>('.reveal') ?? [])];
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return root;
}

const SOURCES: [string, string, string][] = [
  ['USDA FoodData Central', 'Foundation, SR Legacy and survey foods', 'Public domain'],
  ['Indian Nutrient Databank', 'About 1,000 Indian dishes — dals, sabzis, rotis', 'Anuvaad INDB'],
  ['UK CoFID 2021', '511 dishes USDA lacks, many South Asian', 'Open Government Licence'],
  ['Open Food Facts', 'Packaged products by barcode and name', 'ODbL'],
];

const PLATFORM: { icon: IconName; title: string; text: string }[] = [
  { icon: 'code', title: 'Free test keys', text: 'Same responses, fixed AI results and a separate allowance, so CI runs cost nothing.' },
  { icon: 'key', title: 'Access tokens', text: 'Swap your secret key for a one-hour token and ship that in browser and mobile apps.' },
  { icon: 'chart', title: 'Usage you can see', text: 'Each response states its token cost; the dashboard breaks usage down by day and endpoint.' },
  { icon: 'shield', title: 'Teams and roles', text: 'Keys and usage belong to a team. Invite owners, admins and developers.' },
];

export function Home() {
  const root = useReveal();
  return (
    <main ref={root}>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <h1>Describe a meal.<br />Get the <em>nutrition label</em>.</h1>
            <p className="lead">Turn what people type, say, snap or scan into matched foods, real portions and 33 nutrients — with one API key.</p>
            <div className="cta-row">
              <Link className="btn btn-primary" to="/signup">Get a free API key <span className="arrow">→</span></Link>
              <Link className="btn btn-ghost" to="/playground">Open the playground</Link>
            </div>
            <p className="hero-note"><Icon name="check" />2,000 free tokens a month · no card</p>
          </div>
          <Demo />
        </div>
      </section>

      <section className="wrap section" id="how" aria-labelledby="how-title">
        <div className="section-head reveal">
          <h2 id="how-title">Every way people log food.</h2>
          <p className="lead">One endpoint per input. Ranking, unit conversion and portion sizes are handled for you.</p>
        </div>
        <ul className="inputs reveal" style={{ '--d': '80ms' } as CSSProperties}>
          {INPUTS.map((i) => (
            <li key={i.title}><Icon name={i.icon} /><b>{i.title}</b><span>{i.text}</span></li>
          ))}
        </ul>
      </section>

      <section className="wrap section" aria-labelledby="more-title">
        <div className="section-head reveal">
          <h2 id="more-title">More than a food log.</h2>
          <p className="lead">The pieces a nutrition feature grows into, on the same key.</p>
        </div>
        <div className="features">
          <article className="feature reveal">
            <Icon name="search" />
            <h3>Search and portions</h3>
            <p>The everyday, as-eaten food ranks first. Ask for any amount — grams, cups, slices — and get every nutrient for it.</p>
            <div className="mock" aria-hidden="true">
              <div className="mock-q"><Icon name="search" />banana</div>
              <div className="mock-row hi"><span>Banana, raw</span><small>1 medium · 118 g</small></div>
              <div className="mock-row"><span>Banana, baked</span><small>100 g</small></div>
              <div className="mock-row"><span>Banana chips</span><small>1 oz · 28 g</small></div>
            </div>
          </article>
          <article className="feature reveal" style={{ '--d': '80ms' } as CSSProperties}>
            <Icon name="calendar" />
            <h3>Meal plans</h3>
            <p>One to seven days for a calorie target, six diets and foods to avoid. The same seed always returns the same plan.</p>
            <div className="mock" aria-hidden="true">
              <div className="mock-row"><small>Breakfast</small><span>Greek yogurt, oats, berries</span><b>420</b></div>
              <div className="mock-row"><small>Lunch</small><span>Rajma, rice, salad</span><b>610</b></div>
              <div className="mock-row"><small>Dinner</small><span>Tofu stir-fry, noodles</span><b>690</b></div>
              <div className="mock-foot"><span>Vegetarian · day 1</span><span>1,720 / 1,800 kcal</span></div>
            </div>
          </article>
          <article className="feature reveal" style={{ '--d': '160ms' } as CSSProperties}>
            <Icon name="leaf" />
            <h3>Nutrition advisor</h3>
            <p>Short, practical answers that use what the person logged today. Medical questions are declined and pointed to a professional.</p>
            <div className="mock" aria-hidden="true">
              <div className="mock-bubble you">High-protein vegetarian breakfast?</div>
              <div className="mock-bubble">A Greek yogurt bowl with oats and seeds, or paneer bhurji on toast — both land around 25 g of protein.</div>
            </div>
          </article>
        </div>
      </section>

      <section className="wrap section" aria-labelledby="data-title">
        <div className="data-grid">
          <div className="reveal">
            <h2 id="data-title">Food from more of the world.</h2>
            <p className="lead">Open, citable sources — including the Indian and British dishes most US databases miss. Every result says where it came from.</p>
            <dl className="stats">
              <div><dt>Foods with full profiles</dt><dd>13,359</dd></div>
              <div><dt>Household portions</dt><dd>30,512</dd></div>
              <div><dt>Nutrients with % DV</dt><dd>33</dd></div>
            </dl>
          </div>
          <ul className="sources reveal" style={{ '--d': '100ms' } as CSSProperties}>
            {SOURCES.map(([name, what, licence]) => (
              <li key={name}><div><b>{name}</b><span>{what}</span></div><small>{licence}</small></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="wrap section">
        <div className="dev reveal">
          <div>
            <h2>Five minutes from key to first meal.</h2>
            <p>A REST API with an OpenAPI 3.1 spec, and a dependency-free SDK for browsers and Node.</p>
            <ul>
              <li><Icon name="mic" /><span>On-device voice and barcode capture in the SDK.</span></li>
              <li><Icon name="bolt" /><span>An MCP server, so Claude and other agents can log meals.</span></li>
              <li><Icon name="code" /><span>OpenAPI spec for clients in any language.</span></li>
            </ul>
            <Link className="text-link" to="/docs">Read the docs <span className="arrow">→</span></Link>
          </div>
          <CodeSamples />
        </div>
      </section>

      <section className="wrap section" aria-labelledby="platform-title">
        <div className="section-head reveal">
          <h2 id="platform-title">Ready for production.</h2>
        </div>
        <ul className="platform reveal">
          {PLATFORM.map((f) => (
            <li key={f.title}><Icon name={f.icon} /><b>{f.title}</b><span>{f.text}</span></li>
          ))}
        </ul>
      </section>

      <section className="wrap closing reveal">
        <h2>Ship the nutrition feature <em>this week</em>.</h2>
        <p className="lead">{PAYMENTS_VISIBLE ? 'Free plan, no card. Upgrade only when your users show up.' : 'Free plan, no card.'}</p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/signup">Create your free account <span className="arrow">→</span></Link>
          {PAYMENTS_VISIBLE ? <Link className="btn btn-ghost" to="/pricing">See pricing</Link> : null}
        </div>
      </section>
    </main>
  );
}
