/* Coffinat — data management: export the drink log to CSV, import it back, and delete everything.
   Pure CSV/state logic lives in storage.js; this module only wires the buttons, the file picker and
   the browser download (all client-side — nothing is uploaded). */
import * as storage from './storage.js'
import * as util from './util.js'

let api = null
let els = null

function setStatus(msg, kind) {
  els.status.textContent = msg || ''
  els.status.dataset.kind = kind || ''
  els.status.hidden = !msg
}

function drinkCount(state) {
  let n = 0
  for (const key of Object.keys(state.days || {})) {
    const day = state.days[key]
    if (day && Array.isArray(day.log)) n += day.log.length
  }
  return n
}

/** Hand a CSV file to the user: the native share sheet on touch devices (reliable on iOS, where a
    download link often just opens the file inline), otherwise a normal download link. */
function saveCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  if (coarse && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'text/csv' })
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Coffinat data' }).catch(() => {})
        return
      }
    } catch (err) {
      /* fall through to the download link */
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function onExport() {
  const n = drinkCount(api.state)
  if (n === 0) {
    setStatus('No drinks logged yet — nothing to export.', 'warn')
    return
  }
  const name = 'coffinat-' + util.todayKey() + '.csv'
  saveCsv(name, storage.exportCsv(api.state))
  setStatus('Exported ' + n + ' drink' + (n === 1 ? '' : 's') + ' to ' + name + '.', 'ok')
}

function onImportFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const mode = els.replace.checked ? 'replace' : 'merge'
    try {
      const res = storage.importCsv(api.state, String(reader.result), { mode: mode, uid: util.uid })
      if (res.added === 0 && res.errors.length) {
        setStatus("Couldn't import: " + res.errors[0], 'warn')
      } else {
        api.commit()
        api.refreshInputs()
        let msg = (mode === 'replace' ? 'Replaced your log with ' : 'Added ') + res.added + ' drink' + (res.added === 1 ? '' : 's') + ' across ' + res.dates + ' day' + (res.dates === 1 ? '' : 's') + '.'
        if (res.skipped) msg += ' Skipped ' + res.skipped + ' unreadable row' + (res.skipped === 1 ? '' : 's') + '.'
        setStatus(msg, res.skipped ? 'warn' : 'ok')
      }
    } catch (err) {
      setStatus("Couldn't read that file as Coffinat CSV.", 'warn')
    }
    els.file.value = '' // let the same file be picked again
  }
  reader.onerror = () => setStatus("Couldn't read the file.", 'warn')
  reader.readAsText(file)
}

function onClear() {
  const n = drinkCount(api.state)
  const msg =
    'Delete ALL Coffinat data on this device — every logged drink' +
    (n ? ' (' + n + ')' : '') +
    ', plus your body profile, forecast and sleep goal? This cannot be undone.'
  if (!window.confirm(msg)) return
  storage.clearAll(api.state)
  api.commit()
  api.refreshInputs()
  setStatus('All data deleted. Starting fresh.', 'ok')
}

export function init(theApi) {
  api = theApi
  els = {
    export: document.getElementById('data-export'),
    import: document.getElementById('data-import'),
    file: document.getElementById('data-import-file'),
    replace: document.getElementById('data-import-replace'),
    clear: document.getElementById('data-clear'),
    status: document.getElementById('data-status'),
  }
  els.export.addEventListener('click', onExport)
  els.import.addEventListener('click', () => els.file.click())
  els.file.addEventListener('change', onImportFile)
  els.clear.addEventListener('click', onClear)
}
