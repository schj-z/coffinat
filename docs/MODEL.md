# Coffinat — The Model

*How Coffinat estimates blood‑caffeine concentration over a day, the formulas it uses, and how the
pieces fit together.*

> **Not medical advice.** Every number here is a **population average** from the pharmacology and
> coffee‑chemistry literature. Individual caffeine metabolism varies widely (genetics, liver enzyme
> `CYP1A2` activity, smoking, pregnancy, oral contraceptives, medication). Treat the output as a
> rough planning aid, never a clinical figure.

All of the maths described below lives in one pure, dependency‑free, unit‑tested module,
[`model.js`](../model.js) (tested by [`model.test.js`](../model.test.js), run with `node --test`).
The rest of the app only feeds it numbers and draws the result.

---

## 1. Scope

Coffinat answers one question: *given the caffeinated things you drank and when, roughly what is the
concentration of caffeine in your blood at each moment of the day?* From that single curve it derives
everything else — the level "now", the projected peak, the level at bedtime, and an effect band.

The estimate is built from four independent pieces:

1. **Pharmacokinetics** — how a single dose rises and falls in the blood (§2).
2. **Superposition and carry‑over** — combining many doses, including yesterday's (§3).
3. **Home‑brew extraction** — turning grounds + water + method into a dose in mg (§4).
4. **Effect bands + tolerance** — mapping a concentration to a felt effect (§5).

Section 6 shows how they interact.

---

## 2. Single‑dose pharmacokinetics

Caffeine taken by mouth is described well by a **one‑compartment model with first‑order absorption**
— the standard "oral" pharmacokinetic model. Two compartments are tracked: the **gut** (drug waiting
to be absorbed) and the **central** compartment (drug in the blood/body water).

### 2.1 The compartmental picture

```
        ka                 ke
  gut  ───────▶  central  ───────▶  eliminated
 (A_g)           (A_c)
```

Let

- `A_g(t)` = amount of caffeine still in the gut (mg),
- `A_c(t)` = amount in the central compartment (mg),
- `F` = fraction of the dose that reaches the blood (bioavailability),
- `D` = dose taken (mg),
- `ka` = first‑order **absorption** rate constant (per hour),
- `ke` = first‑order **elimination** rate constant (per hour).

The system is two linear ODEs:

```
dA_g/dt = −ka · A_g                     A_g(0) = F · D
dA_c/dt =  ka · A_g − ke · A_c          A_c(0) = 0
```

### 2.2 Closed‑form solution (the Bateman function)

The gut empties exponentially:

```
A_g(t) = F · D · e^(−ka·t)
```

Substituting into the central equation and solving the resulting first‑order linear ODE (integrating
factor `e^(ke·t)`) with `A_c(0) = 0` gives the **Bateman function**:

```
A_c(t) = (F · D · ka) / (ka − ke) · ( e^(−ke·t) − e^(−ka·t) )
```

Concentration is amount divided by the **volume of distribution** `Vd` (the apparent volume the drug
spreads into). With `τ = t − t₀` the time since the dose was taken (and `C = 0` for `τ < 0`):

```
              F · D · ka
C(τ)  =  ───────────────────── · ( e^(−ke·τ) − e^(−ka·τ) )        [mg/L]
            Vd · (ka − ke)
```

This is exactly `doseConcentrationMgL(...)` in `model.js`. The two exponentials are the whole story:

- `−e^(−ka·τ)` is the **rise** — at `τ = 0` it cancels the other term so `C(0) = 0`, then it decays
  fast (large `ka`), letting the curve climb. **Absorption is gradual; the level never jumps.**
- `e^(−ke·τ)` is the **fall** — the slow decay that dominates once absorption is essentially done.

### 2.3 The degenerate case `ka = ke`

If `ka` and `ke` are equal the closed form divides by zero. The true value is the limit, obtained
with L'Hôpital's rule (or by re‑solving the ODE with a repeated root):

```
C(τ)  =  (F · D · ke / Vd) · τ · e^(−ke·τ)        (when ka ≈ ke)
```

`model.js` switches to this branch when `|ka − ke| < 1e‑6`, so the function is finite and continuous
everywhere. (With the default constants `ka ≠ ke`, but the guard keeps the maths robust for any
half‑life a user dials in.)

### 2.4 Time to peak

The peak is where `dC/dτ = 0`:

```
d/dτ ( e^(−ke·τ) − e^(−ka·τ) ) = 0
⇒  ka · e^(−ka·τ) = ke · e^(−ke·τ)
⇒  τ_max = ln(ka / ke) / (ka − ke)
```

This is `tMaxHours(...)`. With the defaults below, `τ_max ≈ 0.75 h ≈ 45 min`. In the degenerate
`ka = ke` case the limit form `τ·e^(−ke·τ)` peaks at **`τ_max = 1/ke`** (a finite time, not undefined),
and `tMaxHours` returns exactly that.

### 2.5 Constants

| Symbol | Meaning | Value in Coffinat | Notes / source |
|---|---|---|---|
| `F` | Oral bioavailability | **1.0** | Caffeine is ~99–100 % absorbed, ~99 % within 45 min, negligible first‑pass. StatPearls NBK519490; Alsabri 2018. |
| `Vd` | Volume of distribution | **0.6 L/kg × body mass** | Representative adult (~0.5–0.8, often 0.6–0.7 L/kg); 0.6 sits low so it does not understate concentration. This is why body mass is required; it sets the mg/L scale. |
| `t½` | Elimination half‑life | **5 h** default, user‑set 2–10 h | Healthy‑adult range ≈2–8 h; the dominant driver of the fall. Shortened by smoking; lengthened by liver disease and in pregnancy (third trimester can reach ~10–15 h, beyond the slider). |
| `ke` | Elimination rate constant | `ln 2 / t½` (≈ 0.139 /h at 5 h) | Derived from `t½`. |
| `ka` | Absorption rate constant | **4.9 /h** (abs. half‑life ≈ 8.5 min) | Chosen so `τ_max ≈ 45 min` at the default half‑life, matching the observed caffeine `t_max` of 30–60 min. It stays in‑range (≈39–50 min) across the whole 3–8 h half‑life span. |

**A note on `ka`.** Some sources quote an absorption constant around `0.33 min⁻¹ ≈ 19.8 h⁻¹`. That
value would put the peak at ~15 min, which **contradicts** the observed `t_max` of 30–60 min reported
in the same literature, so Coffinat instead pins `ka` to the observed peak time. Absorption is a
property of the gut, so `ka` is held fixed while the user varies `t½` (elimination).

### 2.6 Scale sanity check

For `D = 100 mg`, a 70 kg adult (`Vd = 42 L`), `t½ = 5 h`:

```
τ_max = ln(4.9 / 0.1386) / (4.9 − 0.1386) ≈ 0.749 h  (≈ 45 min)
C_max ≈ 2.1 mg/L
```

Reported `C_max` for 100 mg is ~1.5–2 µg/mL (= mg/L), so the model is the right order of magnitude.
The unit test `C_max scale sanity` asserts the peak lands in 1.8–2.4 mg/L.

---

## 3. Multiple doses and day‑to‑day carry‑over

### 3.1 Superposition

The model is linear, so several doses simply **add**. The total concentration at time `t` is the sum
of each dose's Bateman contribution:

```
C_total(t) = Σ_i  C_i(t − t₀,i)        (each term 0 before its own intake)
```

This is `concentrationAtMgL(...)` / `concentrationSeriesMgL(...)`. A unit test checks additivity
directly (two doses = the sum of each alone).

### 3.2 The daily timeline and carry‑over

A day is drawn **midnight → midnight**. Every dose is placed on a timeline anchored at the selected
day's `00:00`, measured in minutes:

```
absMin(dose) = clock_minutes(dose)  +  dayOffset · 1440
```

where `dayOffset` is `0` for the selected day, `−1` for the day before, and so on. A dose taken at
`22:00 yesterday` therefore sits at `1320 − 1440 = −120` — a **negative** minute — and its residual
caffeine correctly bleeds into this morning's curve. `util.dayDoses(state, date, CARRY_DAYS)` gathers
the selected day plus the previous **`CARRY_DAYS = 2`** days.

Why two days is enough: after 24 h a dose has been through ≈24/5 ≈ 4.8 half‑lives (≈3.5 % left) at the
default half‑life; even at a 10 h half‑life, two days back is ≈2.4 half‑lives from the morning and
contributes little. A unit test confirms a dose at a negative minute still contributes, but less than
a fresh one.

*Boundary note.* Because the window ends at `24:00`, a drink after ~23:00 has its peak just past
midnight; that continuation is shown on the **next** day (via the same carry‑over), and bedtimes are
assumed to be before midnight.

### 3.3 Sampling and the chart

The curve is evaluated on a fixed grid from `0` to `1440` minutes at **1‑minute** resolution
(`chart.XS`, 1441 points). One minute is fine enough that the line reads as smooth; a light spline
(`smooth: 0.3`) removes the last visible faceting without hiding the real kinks at each intake.

- The **actual** series uses the logged doses (+ carry‑over).
- The **forecast** series additionally includes the "plan a drink" dose, when that toggle is on.
- The **projected peak** is the maximum of a series and the minute at which it occurs; Coffinat
  reports an *actual* peak (from what's logged) and, with the forecast on, a *predicted* peak.

---

## 4. Home‑brew extraction

The home‑brew calculator turns a real recipe into a dose in mg, which then feeds the **same** PK model
as any preset drink. It is a deliberately simple two‑factor model: *how much caffeine is in the
grounds* × *how much of it you extract*, spread over the beverage you actually drink.

### 4.1 Caffeine available in the grounds

Roasted coffee carries a fixed caffeine pool per gram, depending on the species:

```
pool(mg/g):   Arabica ≈ 13     Robusta ≈ 24     Blend ≈ 16
```

(Arabica is ~1.2–1.5 % caffeine by weight, Robusta ~2.2–2.7 %. "Blend" ≈ a typical 70/30 Arabica/
Robusta mix, e.g. many supermarket espresso blends.)

### 4.2 Extraction efficiency

Coffinat models the fraction extracted as a saturating exponential in contact time `t` (minutes). The
**rate `k` is per method** — this is a modelling choice, not a measured constant, but it matters: a
single universal rate would make a 12‑hour cold steep indistinguishable from a 2‑minute one.

```
efficiency(method, t) = E_max(method) · ( 1 − e^(−k(method) · t) )
```

```
k (/min):  French press 1.5   Pour‑over 1.5   Drip 1.5
           Espresso 5.0       Moka 2.0        Cold brew 0.006
E_max:     French press 0.95  Pour‑over 0.85  Drip 0.85
           Espresso 0.80      Moka 0.85       Cold brew 0.85
```

Hot immersion/drip are front‑loaded (`k = 1.5` → ≈95 % of `E_max` by ~2 min); espresso is faster still
under pressure; **cold brew is far slower**, so its long steep genuinely changes the yield. `E_max` is
the method's practical ceiling — immersion (French press) sits highest; espresso is a very short,
high‑pressure contact so its ceiling is a little lower. All of these are **representative values, not
laboratory measurements** (see §4.4).

### 4.3 From grounds to a dose

```
extracted(mg)   = grounds(g) · pool(mg/g) · efficiency
beverage(mL)    = water(mL) − retention(method) · grounds(g)   retention = 2 mL/g for filter/immersion,
                                                               0 for espresso (enter the cup yield)
concentration   = extracted / beverage                        [mg/mL]
dose(mg)        = concentration · min(serving, beverage)
```

`min(serving, beverage)` enforces a physical limit: you cannot drink more liquid than the brew
produced. `beverage` is floored at 1 mL to avoid division by zero for nonsensical inputs. **Espresso
uses `retention = 0`**: you enter the cup yield (e.g. 36 mL for a double), not the boiler water — the
filter‑retention rule would otherwise drive an 18 g / 36 mL shot to a nonsensical ~1 mL. Because the
whole estimate is heuristic, `brewCaffeine(...)` also returns `doseMgLow`/`doseMgHigh`, a rough
**±35 %** band (`BREW_UNCERTAINTY_FRAC`) that the UI shows instead of a single false‑precise figure.

### 4.4 Constants and sources

| Quantity | Value | Source |
|---|---|---|
| Arabica pool | 13 mg/g (1.2–1.5 % by wt) | Simon & Bearns; general roaster data (practical, not analytical) |
| Robusta pool | 24 mg/g (2.2–2.7 % by wt) | as above |
| Extraction ceiling `E_max` | 0.80–0.95 by method | representative; Dabov (method vs caffeine); Equipoise (French press) |
| Extraction rate `k` | 0.006–5 /min, per method | modelling assumption (fast hot, slow cold), **not** measured |
| Grounds retention | 2 mL/g (0 for espresso) | standard filter rule of thumb; espresso uses cup yield |
| Estimate band | ±35 % | heuristic, to signal the real spread |

These are **representative modelling values, not laboratory measurements** — and the two coffee sources
are practical brewing references, not analytical studies. Hot brewing assumes near‑optimal water
(~93–96 °C); temperature is not a separate input, to avoid false precision, and cold brew is handled by
its much slower `k` instead.

### 4.5 Worked example

18 g Arabica, 250 mL water, 4 min in a French press, drinking a 200 mL mug:

```
efficiency = 0.95 · (1 − e^(−1.5·4)) = 0.95 · 0.9975 ≈ 0.948
extracted  = 18 · 13 · 0.948 ≈ 222 mg
beverage   = 250 − 2·18 = 214 mL
conc       = 222 / 214 ≈ 1.04 mg/mL
dose       = 1.04 · 200 ≈ 208 mg
```

A strong French‑press mug at ~150–210 mg is in the right range. The result is always shown so you can
sanity‑check and overwrite it. (The unit test pins this example to 180–225 mg.)

---

## 5. Effect bands and tolerance

### 5.1 The ladder

The concentration is mapped to a labelled band ("traffic light"). Only the **high end is anchored to
the toxicology literature**: **toxicity** (CNS/cardiac stimulation, arrhythmia, seizures) from
~15 mg/L, and ~80–100 mg/L potentially lethal. The lower bands (Settled → Overstimulated) are
**illustrative subjective‑effect bands**, not clinical concentration thresholds — subjective effects
map poorly onto blood levels. (Earlier drafts cited a "therapeutic ~4–8 mg/L" range; that terminology
belongs to caffeine‑citrate dosing in neonates, a different context, and has been removed.)

| Band (upper bound, mg/L) | Label | Typical correlate |
|---|---|---|
| < 1 | Settled | Little noticeable stimulation |
| < 4 | Alert | A pleasant lift — alertness, focus, mood |
| < 8 | Energised | Strong stimulation; faster heartbeat; sleep suffers near bedtime |
| < 15 | Overstimulated | Anxiety, tremor, palpitations, stomach upset likely |
| < 40 | Excessive | Toxicity range — racing/irregular heartbeat, nausea |
| ≥ 40 | Hazardous | Severe toxicity risk; ~80 mg/L can be lethal |

This is `EFFECT_LEVELS` / `effectLevel(...)`. These are **population associations and highly
tolerance‑dependent** — a habitual drinker feels far less at the same concentration.

### 5.2 Tolerance scaling

Tolerance is subjective — it changes how strongly a concentration is *felt*, not the blood level
itself. So it does **not** touch the pharmacokinetics; it only softens the *sub‑toxic* ladder bands:

```
band = effectLevel( concentration / factor )     only while concentration < TOXIC_THRESHOLD_MGL (15)
band = effectLevel( concentration )              at or above 15 mg/L — tolerance is IGNORED
```

The factors are **heuristic, not measured** — real tolerance is effect‑specific (you may habituate to
the cardiovascular response yet still lose sleep) and time‑dependent, so treat them as a coarse
"feels‑like" dial:

| Tolerance | factor |
|---|---|
| None (rarely any caffeine) | 1.0 |
| Light (a cup now and then) | 1.3 |
| Moderate (a few a day) | 1.7 |
| Strong (heavy daily habit) | 2.3 |

**Safety guard:** tolerance must never soften a toxicity classification — a potentially lethal blood
level is lethal regardless of habit. So at or above `TOXIC_THRESHOLD_MGL` (15 mg/L) the raw
concentration governs and the factor is ignored. Without this, a strong‑tolerance user at 80 mg/L (a
potentially lethal level) would be scaled to `80 / 2.3 ≈ 35 mg/L` and mislabelled two bands too low.

Example: 8 mg/L reads as *Overstimulated* at no tolerance, but `8 / 2.3 ≈ 3.5 mg/L` → *Alert* for a
strong‑tolerance user — whereas 20 mg/L stays *Excessive* for everyone. Unit tests cover the boundary
mapping, the tolerance shift, and the toxicity guard.

### 5.3 Intake guidelines (separate from the ladder)

Independently of blood concentration, Coffinat shows a running **daily total in mg** against the
EFSA guidance: habitual intake up to **400 mg/day** is not a safety concern for healthy adults, and
single doses up to **200 mg** raise no concern. These are `DAILY_LIMIT_MG` and
`SINGLE_DOSE_CAUTION_MG`.

---

## 6. Uncertainty envelope and model validity

### 6.1 Why a band

A single line looks more precise than a population-average model can justify. So the chart shades a
**plausible range** around the estimate. It is a **deterministic scenario band, not a probability
distribution or a confidence interval** — an honest "roughly this wide", not "95 % of people".

### 6.2 How it is built

`concentrationBandSeriesMgL(doses, profile, xs)` returns `{ center, low, high }`. `center` is the
ordinary best estimate. `high` and `low` are the **pointwise max / min over a small set of parameter
scenarios**, evaluated at every time point:

- **Volume of distribution** `Vd`: 0.5–0.7 L/kg (centre 0.6). A pure scale factor — low `Vd` raises
  the whole curve.
- **Elimination half-life**: ±30 % around the user's selected value. This is what makes the band
  **widen over the day** — two plausible half-lives diverge as caffeine is cleared, so late-day
  estimates are visibly less certain than the morning's.
- **Absorption `ka`**: 3.4–6.4 /h. Mostly shifts the height/time of the early peak.
- **Dose content** (`dose.frac`): each drink's caffeine content uncertainty — heuristic ± fractions of
  **0.10** (typed mg), **0.20** (average preset) or **0.35** (home brew, reusing the brew band). This
  is why a home-brewed coffee produces a wider band than a known caffeine tablet.

These are exactly the three tiers to keep separate:

| Tier | Parameters | Basis |
|---|---|---|
| Literature spread | `Vd`, `ka` ranges | population ranges from the PK sources (§2.5) |
| Conservative modelling | ±30 % half-life | a deliberate assumption, not a measured spread |
| Heuristic | dose `frac` (incl. brew) | documented estimates, not measurements |

Taking min/max **at each time point** (rather than one fixed "low person" and one "high person") lets
the edges be formed by different scenarios at different times — a fast-absorption scenario near the
peak, a long-half-life scenario in the tail. By construction the band always contains `center`: the
centre scenario is in both the high and low sets, and content-high ≥ centre ≥ content-low. It is
computed from a handful of full-curve scenarios — deterministic, no Monte-Carlo simulation.

### 6.3 Model-validity boundary (toxic range)

The whole model assumes **linear, first-order elimination at a constant half-life**. That is a good
approximation at ordinary exposures, but at high concentrations caffeine metabolism can **saturate and
become nonlinear**, and the elimination half-life can lengthen substantially. So the constant-half-life
curve becomes unreliable — and specifically **optimistic** — in the toxic range.

`pkForecastReliable(mgL)` returns `false` at or above `TOXIC_THRESHOLD_MGL` (15 mg/L). When the day's
peak crosses it, the shell (`app.js`):

- shows a prominent model-boundary **warning**;
- **stops presenting precise recovery / bedtime numbers** ("back below X by HH:MM"), which depend on
  the very decay law that no longer holds.

Coffinat deliberately does **not** build an overdose/toxicokinetic model — a clear statement of the
boundary is more honest than false precision. Tolerance never enters here either: the toxicity
classification always uses the raw estimated concentration (§5.2).

---

## 7. How the pieces interact

```
  presets ─┐
           ├─▶ a "dose" = { mg, time }   ┐
  brew ────┘   (mg from §4)               │
                                          │  place on the day's timeline,
  logged drinks (this day) ───────────────┤  add previous days' residual (§3.2)
  previous days' drinks  ─────────────────┘
                                          │
                                          ▼
                 doses = [ { mg, absMin }, … ]
                                          │
                    Bateman superposition (§2, §3.1)
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                            ▼                           ▼
      C(now), C(bedtime)          C(τ) sampled 1‑min           max over the day
       (summary tiles,             (the chart line,             (projected peak →
        sleep‑goal flag)            actual + forecast)          effect band + label)
                                                                        │
                                                          ÷ tolerance factor (§5.2)
                                                                        ▼
                                                              effect band (§5.1)
```

In words:

1. A **dose** in mg comes either from a preset or from the brew calculator (§4). It carries a time.
2. All doses for the day — this day's logged drinks **plus** the residual from the previous two days
   (§3.2) — are placed on a midnight‑anchored minute timeline. A hidden entry is dropped here, so
   toggling "hide" changes the curve without deleting anything. A "plan a drink" dose is added on top
   only for the forecast line.
3. The pure PK model (§2) is summed over those doses (§3.1) to give the concentration at any instant.
4. That single concentration function drives everything: the **summary** reads it at "now" and at
   "bedtime"; the **chart** samples it across the day; the **projected peak** is its maximum; and the
   **effect ladder** classifies the relevant values after dividing by the tolerance factor (§5.2).

Because the PK model is pure and centralised, every readout in the UI is guaranteed to be consistent
with the curve you see.

---

## 8. Assumptions and limitations

- **Population averages.** One set of constants for everyone; real `Vd`, `t½` and sensitivity vary
  two‑ to three‑fold between people. The plausible-range band (§6) makes this spread visible but is a
  scenario range, not a probability.
- **One compartment, linear kinetics.** Caffeine elimination is *approximately* first‑order at normal
  intakes; at very high (toxic) doses real kinetics can saturate and the half-life can lengthen
  substantially. The model therefore becomes unreliable — and optimistic — in the toxic range, so the
  app marks it invalid there and withholds recovery-time predictions (§6.3) rather than guessing.
- **Total plasma concentration.** The output is total caffeine in mg/L; protein binding (~10–30 %) is
  not separated out.
- **Fixed absorption.** `ka` does not vary with food, formulation, or drink volume, which do affect
  real absorption speed somewhat.
- **Extraction is a two‑factor approximation.** Grind size, agitation, water chemistry and exact
  temperature are folded into the per‑method `E_max`; the mg field is editable precisely because of
  this.
- **Tolerance is a felt‑effect knob**, not a metabolic one — it does not change the concentration
  curve, only the label.

---

## 9. Symbols

| Symbol | Meaning | Unit |
|---|---|---|
| `D` | Dose of caffeine | mg |
| `F` | Bioavailability | — |
| `Vd` | Volume of distribution | L |
| `ka` | Absorption rate constant | 1/h |
| `ke` | Elimination rate constant | 1/h |
| `t½` | Elimination half‑life | h |
| `τ` | Time since a dose | h |
| `C(τ)` | Plasma concentration | mg/L (= µg/mL) |
| `E_max` | Extraction ceiling of a method | — |
| `k` | Extraction rate constant | 1/min |

---

## 10. References

- **Caffeine** — StatPearls, NCBI Bookshelf (NBK519490). <https://www.ncbi.nlm.nih.gov/books/NBK519490/>
- **Caffeine Toxicity** — StatPearls, NCBI Bookshelf (NBK532910). <https://www.ncbi.nlm.nih.gov/books/NBK532910/>
- **Pharmacology of Caffeine** — NCBI Bookshelf (NBK223808). <https://www.ncbi.nlm.nih.gov/books/NBK223808/>
- Alsabri et al., *Kinetic and Dynamic Description of Caffeine*, J. Caffeine & Adenosine Research, 2018.
  <https://www.liebertpub.com/doi/abs/10.1089/caff.2017.0011>
- **EFSA** — Scientific Opinion on the safety of caffeine (400 mg/day, 200 mg single dose).
  <https://www.efsa.europa.eu/sites/default/files/event/documentset/150305-p09.pdf>
- Caffeine by bean and brew method — Simon & Bearns.
  <https://simonandbearns.coffee/en/blogs/kaffeeblog/coffee-caffeine-content-arabica-vs-robusta-and-by-brewing-method>
- How brewing methods affect caffeine — Dabov. <https://dabov.us/blog/how-brewing-methods-affect-caffeine-content-in-coffee>
- Caffeine in French‑press coffee — Equipoise. <https://equipoisecoffee.com/amount-of-caffeine-in-french-press-coffee/>

*The formulas and constants above mirror [`model.js`](../model.js); if the code changes, update this
document and the tests together.*
