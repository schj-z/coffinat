# Nutrimat

A small, single-page **caffeine planner**. Enter your body mass, log what you drank and when, and see
a graph of your estimated **blood caffeine concentration through the day** — so you can plan around a
daily limit and get it low enough by bedtime to sleep.

The name is a nod to the Nutrimatic drink dispenser from *The Hitchhiker's Guide to the Galaxy* —
except this one tries to get your coffee timing right.

> **Not medical advice.** Nutrimat is an educational estimate built on population-average
> pharmacokinetics. Individual caffeine metabolism varies widely (genetics, smoking, pregnancy,
> medication). Do not use it for medical or dosing decisions.

- **Static site.** Plain HTML/CSS/JS plus one vendored chart library ([ECharts](https://echarts.apache.org/)).
  No backend, no database, no build step, no framework.
- **Your data stays yours.** Everything is computed in your browser and saved to `localStorage`.
  There are no network requests and no tracking.
- **Runs anywhere.** Open `index.html` directly, serve it with any static webserver, host it on
  GitHub Pages, or run the included Caddy container.

## What it does

**Log your caffeine.** Pick a drink (espresso, filter coffee, tea, energy drink, cola, …) or enter a
custom amount, set the time, and adjust the milligrams if you like. The chart updates live.

**Home-brew calculator.** Choose **Home-brew…** on any drink to estimate the caffeine in coffee you
brewed yourself, from the grounds, water, method and time:

| Input | Example |
|---|---|
| Method | French press / pour-over / drip / espresso / moka / cold brew |
| Ground coffee | 18 g |
| Water | 250 ml |
| Brew time | 4 min |
| Beans | Arabica / Robusta / blend |
| You drink | 200 ml |

It works out how much caffeine was extracted and the dose in your serving, then feeds it into the
same model as any other drink.

**Three ways to plan:**

1. **Daily limit.** Your running total is shown against the EFSA guideline of **400 mg/day** (and a
   note about **200 mg** per single dose), turning red when you go over.
2. **Forecast a drink.** Enter a drink you are *thinking* about and toggle it onto the chart as a
   dashed line, to see how it would change the rest of your day.
3. **Sleep goal.** Set "be below *X* mg/L by *bedtime*". The chart draws your limit and bedtime, and
   flags you if the forecast would leave too much caffeine in your blood when you want to sleep.

## Run it

**Quick preview** (any static server works):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or just double-click `index.html` — it works over `file://` too.

**Container (Caddy + podman):**

```bash
podman compose up -d --build     # start on http://localhost:8080
podman compose down              # stop
```

`docker compose …` works identically. The container is loopback-bound, runs with a read-only root
filesystem, dropped Linux capabilities and no privilege escalation; put a TLS reverse proxy in front
if you expose it. `HOST_PORT=8090 podman compose up -d` changes the published port.

**GitHub Pages / any static host:** copy `index.html`, `styles.css`, `app.js`, `model.js`,
`favicon.svg` and `vendor/` to the host. There is nothing to build.

## The model

Each drink is modelled with a one-compartment oral **Bateman** pharmacokinetic model — the exact
solution of first-order absorption into the bloodstream and first-order elimination:

```
C(τ) = F·D·ka / (Vd·(ka − ke)) · ( e^(−ke·τ) − e^(−ka·τ) )
```

so your level **rises gradually** over roughly the first 45 minutes after a drink (it does not jump)
and then falls with your elimination half-life. Concentration is in mg/L of blood, using a volume of
distribution scaled by your body mass.

| Parameter | Value | Notes |
|---|---|---|
| Bioavailability `F` | 1.0 | Caffeine is ~99–100% orally absorbed |
| Volume of distribution | 0.6 L/kg × mass | Adult average (range 0.5–0.75) |
| Elimination half-life | 5 h (adjustable) | Healthy-adult range ~2–8 h |
| Absorption `ka` | 4.9 /h | Peak ~45 min after intake |

The home-brew calculator estimates extracted caffeine as `grounds × pool × efficiency`, where the
pool is ~13 mg/g for Arabica and ~24 mg/g for Robusta, and extraction is ~95% complete within ~2
minutes (per method: immersion ≈0.95, drip/pour-over ≈0.85, espresso ≈0.80).

Constants are population averages from published pharmacology and coffee-chemistry sources:

- Caffeine PK — [StatPearls, NIH (NBK519490)](https://www.ncbi.nlm.nih.gov/books/NBK519490/);
  [Alsabri et al., *J. Caffeine Res.* 2018](https://www.liebertpub.com/doi/abs/10.1089/caff.2017.0011);
  [EFSA caffeine assessment](https://www.efsa.europa.eu/sites/default/files/event/documentset/150305-p09.pdf).
- Brewing — [Arabica vs Robusta & by method](https://simonandbearns.coffee/en/blogs/kaffeeblog/coffee-caffeine-content-arabica-vs-robusta-and-by-brewing-method);
  [how brew methods affect caffeine](https://dabov.us/blog/how-brewing-methods-affect-caffeine-content-in-coffee).

The maths lives in `model.js` (with the equations and sources in its header) and is unit-tested:

```bash
node --test
```

## Layout

```
index.html   styles.css   app.js   model.js   model.test.js   favicon.svg
vendor/echarts.min.js
Containerfile   Caddyfile   compose.yaml
```

## License

Provided **as is, without warranty of any kind**. You use it, and any estimates it produces, at your
own risk. Not medical advice.
