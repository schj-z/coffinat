/* Nutrimat — drink presets (average caffeine in mg; editable per entry). Sources in README. */

export const PRESETS = [
  { id: 'filter', label: 'Filter coffee (240 ml)', mg: 95 },
  { id: 'espresso', label: 'Espresso', mg: 63 },
  { id: 'double_espresso', label: 'Double espresso', mg: 125 },
  { id: 'instant', label: 'Instant coffee', mg: 60 },
  { id: 'latte', label: 'Cappuccino / Latte', mg: 75 },
  { id: 'black_tea', label: 'Black tea', mg: 47 },
  { id: 'green_tea', label: 'Green tea', mg: 28 },
  { id: 'energy', label: 'Energy drink (250 ml)', mg: 80 },
  { id: 'energy_shot', label: 'Energy shot', mg: 200 },
  { id: 'cola', label: 'Cola (330 ml)', mg: 34 },
  { id: 'dark_choc', label: 'Dark chocolate (50 g)', mg: 24 },
]
export const HOMEBREW = 'homebrew'
export const CUSTOM = 'custom'

export function byId(id) {
  return PRESETS.find((p) => p.id === id) || null
}

/** A <select> of presets + Home-brew + Custom. `selected` is a preset id, or hasBrew forces Home-brew. */
export function makeSelect(selected, hasBrew) {
  const sel = document.createElement('select')
  for (const p of PRESETS) {
    const o = document.createElement('option')
    o.value = p.id
    o.textContent = p.label
    sel.appendChild(o)
  }
  const brew = document.createElement('option')
  brew.value = HOMEBREW
  brew.textContent = 'Home-brew…'
  sel.appendChild(brew)
  const custom = document.createElement('option')
  custom.value = CUSTOM
  custom.textContent = 'Custom (mg)'
  sel.appendChild(custom)
  sel.value = hasBrew ? HOMEBREW : selected
  return sel
}
