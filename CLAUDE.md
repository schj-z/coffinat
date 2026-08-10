# Nutrimat — conventions for agents

A small, single-page **caffeine planner**. Enter your body mass, log the caffeinated drinks you had
and when, and see a graph of your estimated **blood caffeine concentration (mg/L)** across the day —
so you can plan around a daily limit and your bedtime.

## What it is (and is not)

- A **static site**: plain HTML, CSS and JavaScript plus one vendored library (ECharts). **No
  backend, no database, no build step, no framework, no bundler, no `package.json`.**
- Served in production by a **Caddy container under podman** (`compose.yaml`), but it is just static
  files — it also runs opened as `file://` or from any static host (GitHub Pages, `python3 -m
  http.server`, …).
- **Not medical advice.** Every estimate uses population-average pharmacokinetic constants;
  individual metabolism varies widely. This must stay visible in the UI.

## Hard rules

1. **Keep it static and dependency-light.** The only runtime dependency is `vendor/echarts.min.js`
   (self-hosted, **never** a CDN). Adding any other dependency, a build step, or a framework needs a
   strong reason nothing simpler covers. Simplicity and readability come first — but never at the
   cost of security.

2. **The core logic is pure and lives in `model.js`.** All pharmacokinetics, the brew-extraction
   maths, unit/time helpers and the constants live there as pure functions: **numbers in, numbers
   out — no DOM, no `localStorage`, no `Date.now()`** (the current time is passed in). This is the
   rule most worth protecting: it is what keeps the maths auditable and testable.

3. **The core logic is tested.** `model.test.js` runs with `node --test` (zero dependencies). Tests
   must fail if the maths is wrong — assert observable properties (peak location, half-life decay,
   additivity, the `ka≈ke` limit being finite, scale), not merely "it returned a number". Run them
   before claiming a change to the model is done.

4. **`app.js` is the impure shell.** State, `localStorage`, DOM rendering and the ECharts chart. It
   *consumes* `model.js` (the `NutrimatModel` global) and must not contain pharmacology.

5. **No inline script or style; nothing cross-origin.** All JS/CSS is in external self-hosted files
   so the Caddy CSP can stay strict (`script-src 'self'`, `style-src 'self'`). User-entered text
   (custom product names, etc.) reaches the DOM via `textContent`, never string-built `innerHTML`.

## The model (see the header comment in `model.js` for the equations and sources)

One-compartment oral **Bateman** model. Each dose rises from 0 at intake to a peak ~45 min later
(gradual absorption via `ka`), then decays with the elimination half-life. Constants: bioavailability
`F=1`, volume of distribution `0.6 L/kg × mass`, half-life 5 h default (adjustable), absorption
`ka=4.9/h`. The `ka≈ke` degenerate case is special-cased to its limit form. The home-brew calculator
turns grounds + water + method + time + serving into a dose in mg that feeds the same model.

All constants are population averages with sources cited in `model.js` and `README.md`. If you change
one, update the citation and the tests.

## Guardrails

`.claude/hooks/guard.mjs` (a `PreToolUse` hook wired in `.claude/settings.json`) enforces the working
agreement: no writes/deletes/redirects outside the project, no reading credential material, no
committing secrets, no force-push / global git config, and container mounts confined to the project.
It fails open (a crash never blocks the session) and only ever denies or asks.

## Layout

```
index.html        markup + the strict-CSP-friendly script tags (echarts → model → app)
styles.css        design tokens (light/dark) + layout; coffee/amber accent
model.js          PURE core logic — PK + brew + time/units + constants (UMD-lite: browser + Node)
model.test.js     node:test unit tests for model.js
app.js            state, localStorage, DOM, ECharts (consumes NutrimatModel)
vendor/           echarts.min.js (vendored 6.1.0, self-hosted)
favicon.svg       coffee-cup mark (light/dark via media query)
Containerfile     Caddy (pinned, cap stripped so no-new-privileges can exec it)
Caddyfile         static file server + gzip/zstd + strict CSP and security headers
compose.yaml      one service, loopback-bound, read-only rootfs, caps dropped
```

## Commands

```bash
node --test                        # run the model tests
python3 -m http.server 8000        # quick local preview (open http://localhost:8000)
podman compose up -d --build       # production-style: Caddy on http://localhost:8080
podman compose down                # stop (no data volume — nothing to lose)
```
