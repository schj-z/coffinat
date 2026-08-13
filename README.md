# Coffinat

A small, single-page **caffeine planner**. Enter your body mass, log what you drank and when, and see
a graph of your estimated **blood caffeine concentration through the day** — so you can plan around a
daily limit and get it low enough by bedtime to sleep.

The name is a nod to the Coffinatic drink dispenser from *The Hitchhiker's Guide to the Galaxy* —
except this one tries to get your coffee timing right.

> **Not medical advice.** Coffinat is an educational estimate built on population-average
> pharmacokinetics. Individual caffeine metabolism varies widely (genetics, smoking, pregnancy,
> medication). Do not use it for medical or dosing decisions.

- **Static site.** Plain HTML/CSS plus native ES modules and one vendored chart library
  ([ECharts](https://echarts.apache.org/)). No backend, no database, no build step, no framework.
- **Your data stays yours.** Everything you enter is computed in your browser and saved to
  `localStorage`, per day. The app transmits none of it and adds no cookies, analytics or tracking —
  beyond fetching its own files. (Loading any site, including this one, still contacts its host, which
  sees normal request metadata like your IP and user-agent; that's outside the app's control.)
- **Serve it anywhere.** Any static webserver works — the included Caddy container, `python3 -m
  http.server`, or GitHub Pages. (It uses ES modules, so it needs an HTTP origin — opening the bare
  `index.html` file over `file://` won't work; use one of the above.)

## What it does

**Pick a day.** A calendar lets you log and review any day; days with entries are dotted. Your log
is saved per day, so you can plan tomorrow or look back at yesterday. Body mass, half-life, the
forecast and the sleep goal are shared across days.

**Log your caffeine.** Pick a drink (espresso, filter coffee, tea, energy drink, cola, …) or enter a
custom amount, set the time, and adjust the milligrams if you like. The chart updates live. The
**half-life** is a slider (2–10 h). Each drink has an **eye toggle** to hide it from the calculation
without deleting it — handy for "what if I'd skipped that one".

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

**A caffeine-level "traffic light".** A ladder (Settled → Alert → Energised → Overstimulated →
Excessive → Hazardous) marks where you are **now**, your **estimated peak** from the drinks you've
logged (amber, matching the chart's estimate line) and — with the forecast on — your **predicted
peak** with the planned drink (teal, matching the forecast line),
with the symptoms that typically correlate to each band. A **tolerance** setting (none / light /
moderate / strong) softens how strongly a level is felt — it shifts the ladder only, never the blood
concentration. These are population averages and depend heavily on tolerance; regular users feel far
less.

**Yesterday carries over.** Each day's curve includes the residual caffeine from the previous days,
so a late-evening coffee still shows in the next morning's level.

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

(The app uses native ES modules, so it must be served over HTTP — opening the file directly via
`file://` will not load the scripts.)

**Container (Caddy + podman):**

```bash
podman compose up -d --build     # start on http://localhost:8080
podman compose down              # stop
```

`docker compose …` works identically. The container is loopback-bound, runs with a read-only root
filesystem, dropped Linux capabilities and no privilege escalation; put a TLS reverse proxy in front
if you expose it. `HOST_PORT=8090 podman compose up -d` changes the published port.

## Deploy to GitHub Pages or GitLab Pages

There is **nothing to build** — the whole site is the static files at the repo root (`index.html`,
`styles.css`, `model.js`, `favicon.svg`, `js/`, `vendor/`). Every path in the app is **relative**, so
it works unchanged when served from a project subpath such as `…/coffinat/`. You do **not** need the
container, `Caddyfile`, `Containerfile`, `compose.yaml`, `package.json` or `model.test.js` on the
host; they are ignored by Pages and can stay in the repo.

> One caveat: Pages serves plain files and cannot send the strict `Content-Security-Policy` and
> security headers that the Caddy container does. The app still works fine — there are no secrets and
> nothing cross-origin — you just don't get those response headers. (GitLab Pages can restore them via
> a `_headers` file if you want; GitHub Pages cannot set headers.)

### GitHub Pages

The repo already contains an empty **`.nojekyll`** file, which tells GitHub to publish the files
as‑is (no Jekyll build). Then, in the repository:

1. Push to GitHub (default branch `main`).
2. **Settings → Pages**.
3. Under **Build and deployment**, set **Source = "Deploy from a branch"**, **Branch = `main`**,
   **Folder = `/ (root)`**, and **Save**.
4. Wait for the green check; your site is at `https://<user>.github.io/<repo>/`.

Every push to `main` redeploys automatically. This branch source needs no CI at all.

**Automate with GitHub Actions instead** — if you'd rather have CI run the model tests *before*
publishing, switch **Settings → Pages → Source** to **"GitHub Actions"** and add
**`.github/workflows/deploy.yml`**:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch: # allow manual runs

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node --test # the model unit tests must pass before we deploy

  deploy:
    needs: test # don't publish a broken model
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: Assemble the static site
        run: |
          mkdir -p _site
          cp -r index.html styles.css model.js favicon.svg js vendor _site/
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deployment
        uses: actions/deploy-pages@v4
```

With the Actions source you don't even need `.nojekyll` (the artifact is served verbatim). Only the
assembled `_site/` is published, so the container files and tests never end up on the web.

### GitLab Pages

GitLab publishes whatever a CI job puts in a `public/` directory, so its deploy *is* CI. This
**`.gitlab-ci.yml`** runs the model tests first, then publishes only the static files:

```yaml
stages: [test, deploy]

test:
  stage: test
  image: node:20-alpine
  script:
    - node --test # model unit tests

pages:
  stage: deploy
  image: alpine:latest
  script:
    - mkdir -p public
    - cp -r index.html styles.css model.js favicon.svg js vendor public/
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH # publish only from the default branch
```

`test` runs on every pipeline (including merge requests); `pages` publishes only from the default
branch, and — being in a later stage — only after the tests pass. Push it and your site appears at
`https://<namespace>.gitlab.io/<project>/` (see **Deploy → Pages** for the exact URL). To also send
the security headers, add a `public/_headers` file in the `pages` job — GitLab Pages honours it.

### Any other static host

Copy those same files (`index.html`, `styles.css`, `model.js`, `favicon.svg`, `js/`, `vendor/`) to
any web server. It must be served over HTTP(S) — the app uses native ES modules, so opening the bare
`index.html` over `file://` will not load the scripts.

## The model

Each drink is modelled with a one-compartment oral **Bateman** pharmacokinetic model — the exact
solution of first-order absorption into the bloodstream and first-order elimination:

```
C(τ) = F·D·ka / (Vd·(ka − ke)) · ( e^(−ke·τ) − e^(−ka·τ) )
```

using a first-order absorption rate chosen to give a **typical peak around 30–60 minutes** after a
drink, so your level rises gradually (it does not jump) and then falls with your elimination half-life. Concentration is in mg/L of blood, using a volume of
distribution scaled by your body mass.

| Parameter | Value | Notes |
|---|---|---|
| Bioavailability `F` | 1.0 | Caffeine is ~99–100% orally absorbed |
| Volume of distribution | 0.6 L/kg × mass | Representative adult (~0.5–0.8, often 0.6–0.7) |
| Elimination half-life | 5 h (adjustable) | Healthy-adult range ~2–8 h (pregnancy can reach 10–15 h) |
| Absorption `ka` | 4.9 /h | Calibrated so the peak lands ~30–60 min after intake |

The home-brew calculator estimates extracted caffeine as `grounds × pool × efficiency`, where the
pool is ~13 mg/g for Arabica and ~24 mg/g for Robusta and the per-method efficiency is immersion
≈0.95, drip/pour-over ≈0.85, espresso ≈0.80. Extraction speed is **per method** — front-loaded for hot
immersion/drip, faster for espresso, and much slower for cold brew (so its long steep actually
matters); espresso uses the cup yield directly rather than filter-style water retention. These are
**representative values, not laboratory measurements**, and the extraction-over-time curve is a
deliberate modelling assumption, so the calculator shows a rough **±band** rather than a single precise
figure. Real yields vary widely with grind, dose, agitation, temperature, pressure and contact time.

**Plausible-range band.** The chart draws a shaded envelope around the solid estimate — and around a
planned-drink forecast too. It is a deterministic **scenario band, not a confidence interval**: the
model is re-run across **every low/high combination** of volume of distribution, elimination half-life
and absorption timing (`pkScenarioParams`, the centre plus all 2³ corners), each combined with the
drink's caffeine-content uncertainty, and the chart shades between the pointwise lowest and highest
curves — so every scenario the model considers lies inside the band. Because half-life differences
compound over time, the band widens later in the day; because a home brew's content is less certain
than a typed-in milligram figure, brewed drinks widen it more. The Vd bounds (0.5–0.7 L/kg) are
**representative modelling bounds**, not the full literature range (~0.5–0.8); the ±30% half-life span
is likewise a deliberately conservative modelling assumption. (`concentrationBandSeriesMgL` in
`model.js`.)

**Toxic-range boundary.** The model assumes linear, constant-half-life elimination. That holds at
ordinary exposures but **breaks down in the toxic range (≈15 mg/L and up)**, where caffeine clearance
can become nonlinear and much slower. There the app stops trusting the forecast (for both the logged
and planned trajectories): if the **centre** estimate crosses the threshold it shows a strong warning
and withholds precise recovery/bedtime times; if only the **upper plausible bound** crosses, it shows a
gentler caution that some scenarios reach the invalid range. The classification always uses raw
concentration — tolerance never weakens it — and Coffinat deliberately does not model overdose kinetics.

Constants are population averages from published pharmacology and coffee-chemistry sources:

- Caffeine PK — [StatPearls, NIH (NBK519490)](https://www.ncbi.nlm.nih.gov/books/NBK519490/);
  [Alsabri et al., *J. Caffeine Res.* 2018](https://www.liebertpub.com/doi/abs/10.1089/caff.2017.0011);
  [EFSA caffeine assessment](https://www.efsa.europa.eu/sites/default/files/event/documentset/150305-p09.pdf).
- Brewing (practical references, **not** analytical studies) — [Arabica vs Robusta & by method](https://simonandbearns.coffee/en/blogs/kaffeeblog/coffee-caffeine-content-arabica-vs-robusta-and-by-brewing-method);
  [how brew methods affect caffeine](https://dabov.us/blog/how-brewing-methods-affect-caffeine-content-in-coffee).
  The extraction constants are representative modelling values, not measured from these pages.
- Caffeine & sleep timing — [Drake et al., *J. Clin. Sleep Med.* 2013](https://doi.org/10.5664/jcsm.3170):
  a **400 mg** dose still measurably disrupted sleep taken 6 h before bed.
- Toxicity bands — [Caffeine Toxicity, StatPearls (NBK532910)](https://www.ncbi.nlm.nih.gov/books/NBK532910/):
  toxicity from ≈15 mg/L, ≈80–100 mg/L potentially lethal. The lower "effect" bands (Settled →
  Overstimulated) are **illustrative** — subjective effects map poorly onto blood levels — not from
  this source.

The maths lives in `model.js` (with the equations and sources in its header) and is unit-tested:

```bash
node --test
```

## Layout

```
index.html   styles.css   model.js   model.test.js   favicon.svg   package.json
js/          util, presets, storage, chart, brew, calendar, log, controls, app  (one ES module each)
vendor/      echarts.min.js
Containerfile   Caddyfile   compose.yaml
```

`model.js` is the pure, tested core (PK + brew maths); everything in `js/` is the UI shell that
imports it. See `CLAUDE.md` for the conventions.

## License

[MIT](LICENSE). Provided **as is, without warranty of any kind**. You use it, and any estimates it
produces, at your own risk. Not medical advice.
