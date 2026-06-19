import Hls from 'hls.js'
import { analyze } from './lib/analyze'
import { rank, pickBest, formatBytes, formatDuration } from './lib/best'
import { isCorsError } from './lib/fetcher'
import type { AnalyzeResult, CobaltConfig, ProxyConfig, Quality } from './lib/types'
import './style.css'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

const form = $<HTMLFormElement>('analyze-form')
const urlInput = $<HTMLInputElement>('url-input')
const analyzeBtn = $<HTMLButtonElement>('analyze-btn')
const statusEl = $('status')
const previewEl = $('preview')
const qualitiesEl = $('qualities')
const useProxy = $<HTMLInputElement>('use-proxy')
const proxyUrl = $<HTMLInputElement>('proxy-url')
const cobaltUrl = $<HTMLInputElement>('cobalt-url')
const cobaltKey = $<HTMLInputElement>('cobalt-key')

let currentHls: Hls | null = null
let activeDownload: { quality: Quality; btn: HTMLButtonElement } | null = null

function proxyConfig(): ProxyConfig {
  return { enabled: useProxy.checked, url: proxyUrl.value.trim() }
}

function cobaltConfig(): CobaltConfig {
  return { url: cobaltUrl.value.trim(), apiKey: cobaltKey.value.trim() || undefined }
}

function saveSettings() {
  try {
    localStorage.setItem('bh-settings', JSON.stringify({
      useProxy: useProxy.checked,
      proxyUrl: proxyUrl.value,
      cobaltUrl: cobaltUrl.value,
      cobaltKey: cobaltKey.value,
    }))
  } catch { /* ignore */ }
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('bh-settings') || '{}')
    if (s.useProxy) useProxy.checked = true
    if (s.proxyUrl) proxyUrl.value = s.proxyUrl
    if (s.cobaltUrl) cobaltUrl.value = s.cobaltUrl
    if (s.cobaltKey) cobaltKey.value = s.cobaltKey
  } catch { /* ignore */ }
}

loadSettings()
;[useProxy, proxyUrl, cobaltUrl, cobaltKey].forEach((el) =>
  el.addEventListener('change', saveSettings),
)

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = urlInput.value.trim()
  if (!url) return
  await runAnalyze(url)
})

document.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
  b.addEventListener('click', () => {
    urlInput.value = b.dataset.url || ''
    runAnalyze(b.dataset.url || '')
  })
})

async function runAnalyze(url: string) {
  resetUI()
  analyzeBtn.disabled = true
  showStatus('Analyzing…', 'info')
  try {
    const result = await analyze(url, proxyConfig(), cobaltConfig(), (pct, label) => {
      // progress is for downloads, not analysis
    })
    renderResult(result)
  } catch (e) {
    showStatus(humanError(e, proxyConfig()), 'error')
  } finally {
    analyzeBtn.disabled = false
  }
}

function renderResult(r: AnalyzeResult) {
  if (r.warning && !r.qualities.length) {
    const kind: 'proxy' | 'error' | 'cobalt' = r.needsCobalt ? 'cobalt' : r.needsProxy ? 'proxy' : 'error'
    showStatus(r.warning, kind)
    return
  }
  if (r.warning) {
    showStatus(r.warning, 'info')
  } else {
    statusEl.hidden = true
  }

  if (r.previewUrl) attachPreview(r.previewUrl, r.isHls)

  const ranked = rank(r.qualities)
  const best = pickBest(ranked)
  renderQualities(ranked, best, r.title)
}

function renderQualities(qualities: Quality[], best: Quality | undefined, title?: string) {
  qualitiesEl.innerHTML = ''
  qualitiesEl.hidden = false

  if (title) {
    const h = document.createElement('div')
    h.className = 'result-title'
    h.textContent = title
    qualitiesEl.appendChild(h)
  }

  const summary = document.createElement('div')
  summary.className = 'summary'
  summary.innerHTML = `<span>${qualities.length} quality option${qualities.length === 1 ? '' : 's'}</span>${
    best ? `<span class="best-tag">Auto-picked: <strong>${best.label}</strong></span>` : ''
  }`
  qualitiesEl.appendChild(summary)

  if (best) {
    qualitiesEl.appendChild(makeCard(best, true))
  }
  for (const q of qualities) {
    if (q.id === best?.id) continue
    qualitiesEl.appendChild(makeCard(q, false))
  }
}

function makeCard(q: Quality, isBest: boolean): HTMLElement {
  const card = document.createElement('div')
  card.className = 'card' + (isBest ? ' best' : '')

  const left = document.createElement('div')
  left.className = 'card-main'
  const thumb = q.thumb ? `<img class="card-thumb" src="${escapeHtml(q.thumb)}" alt="" loading="lazy" />` : ''
  left.innerHTML = `
    <div class="card-label">
      ${thumb}
      ${isBest ? '<span class="badge">BEST</span>' : ''}
      <span class="ql">${escapeHtml(q.label)}</span>
    </div>
    <div class="card-meta">
      ${q.resolution ? `<span>${q.resolution}</span>` : ''}
      ${q.fps ? `<span>${q.fps}fps</span>` : ''}
      ${q.bitrate ? `<span>${Math.round(q.bitrate / 1000)} kbps</span>` : ''}
      ${q.size ? `<span>${formatBytes(q.size)}</span>` : ''}
      <span class="kind kind-${q.kind}">${q.kind}</span>
    </div>
    ${q.notes ? `<div class="card-notes">${escapeHtml(q.notes)}</div>` : ''}
  `

  const btn = document.createElement('button')
  btn.className = 'btn' + (isBest ? ' primary' : '')
  btn.textContent = 'Download'
  btn.addEventListener('click', () => startDownload(q, btn))

  card.appendChild(left)
  card.appendChild(btn)
  return card
}

async function startDownload(q: Quality, btn: HTMLButtonElement) {
  if (activeDownload) {
    showStatus('A download is already running. Wait for it to finish.', 'error')
    return
  }
  const original = btn.textContent
  activeDownload = { quality: q, btn }
  btn.disabled = true
  showStatus(`Downloading ${q.label}…`, 'info')
  try {
    await q.download((pct, label) => {
      btn.textContent = `${pct}%`
      showStatus(`Downloading ${q.label} — ${label} (${pct}%)`, 'info')
    })
    showStatus(`Downloaded ${q.label}. Check your downloads.`, 'ok')
  } catch (e) {
    showStatus(humanError(e, proxyConfig()), 'error')
  } finally {
    btn.disabled = false
    btn.textContent = original
    activeDownload = null
  }
}

function attachPreview(url: string, isHls?: boolean) {
  previewEl.innerHTML = ''
  previewEl.hidden = false
  const video = document.createElement('video')
  video.controls = true
  video.playsInline = true
  video.className = 'preview-video'

  if (isHls && Hls.isSupported()) {
    if (currentHls) currentHls.destroy()
    const hls = new Hls({ enableWorker: true })
    currentHls = hls
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        const note = document.createElement('div')
        note.className = 'preview-note'
        note.textContent = 'Preview unavailable (source blocked cross-origin playback). Download still may work via proxy.'
        previewEl.appendChild(note)
      }
    })
  } else {
    video.src = url
  }
  previewEl.appendChild(video)
}

function resetUI() {
  statusEl.hidden = true
  statusEl.className = 'status'
  statusEl.textContent = ''
  qualitiesEl.hidden = true
  qualitiesEl.innerHTML = ''
  previewEl.hidden = true
  previewEl.innerHTML = ''
  if (currentHls) {
    currentHls.destroy()
    currentHls = null
  }
  activeDownload = null
}

function showStatus(msg: string, kind: 'info' | 'ok' | 'error' | 'proxy' | 'cobalt') {
  statusEl.hidden = false
  statusEl.className = `status ${kind}`
  statusEl.textContent = msg
}

function humanError(e: unknown, proxy: ProxyConfig): string {
  if (isCorsError(e)) {
    return proxy.enabled
      ? 'Request failed. The proxy may have blocked it or the resource is unavailable.'
      : 'Browser blocked this cross-origin request (CORS). Enable the CORS proxy in Settings and try again.'
  }
  return (e as Error)?.message || String(e)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  )
}

// expose formatDuration/formatBytes for potential debugging
void formatDuration
