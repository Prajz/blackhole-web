import { fetchBlob, triggerBlobDownload, sanitizeFilename } from './fetcher'
import { extFromContainer } from './detect'
import type { CobaltConfig, Quality } from './types'

export interface CobaltResponse {
  status: 'tunnel' | 'redirect' | 'local-processing' | 'picker' | 'error'
  url?: string
  filename?: string
  picker?: { type: 'photo' | 'video' | 'gif'; url: string; thumb?: string }[]
  audio?: string
  audioFilename?: string
  tunnel?: string[]
  output?: { type: string; filename: string }
  error?: { code: string; context?: Record<string, unknown> }
}

const QUALITY_PRESETS = ['max', '1080', '720', '480', '360'] as const
export type QualityPreset = (typeof QUALITY_PRESETS)[number]

export function qualityPresetLabel(q: QualityPreset): string {
  return q === 'max' ? 'Max' : `${q}p`
}

export function cobaltEnabled(cfg: CobaltConfig): boolean {
  return !!cfg.url && cfg.url.trim().length > 0
}

function normalizeInstanceUrl(url: string): string {
  let u = url.trim()
  if (!u) return ''
  if (!/^https?:\/\//.test(u)) u = 'https://' + u
  if (u.endsWith('/')) u = u.slice(0, -1)
  return u
}

async function cobaltPost(
  instanceUrl: string,
  body: Record<string, unknown>,
  cfg: CobaltConfig,
): Promise<CobaltResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (cfg.apiKey) headers['Authorization'] = `Api-Key ${cfg.apiKey}`
  const res = await fetch(`${instanceUrl}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as CobaltResponse
  return data
}

async function downloadFromUrl(
  url: string,
  filename: string,
  onProgress?: (pct: number, label: string) => void,
): Promise<void> {
  onProgress?.(0, 'fetching')
  // cobalt tunnels are served from the instance domain and allow CORS.
  // redirects point to the source CDN; those may or may not allow CORS.
  try {
    const blob = await fetchBlob(url, { enabled: false, url: '' })
    onProgress?.(100, 'done')
    triggerBlobDownload(blob, filename)
  } catch {
    // Fallback: direct anchor navigation (works for redirects, opens tunnel in browser)
    onProgress?.(50, 'opening directly')
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}

function extFromFilename(filename: string): string {
  const m = filename.match(/\.([a-z0-9]+)$/i)
  return m ? m[1] : 'mp4'
}

function extFromMime(mime: string): string {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('mp3')) return 'mp3'
  if (mime.includes('opus')) return 'opus'
  if (mime.includes('m4a')) return 'm4a'
  return 'mp4'
}

export interface CobaltAnalyzeResult {
  qualities: Quality[]
  title?: string
  warning?: string
  isPicker?: boolean
}

export async function analyzeWithCobalt(
  videoUrl: string,
  cfg: CobaltConfig,
  proxy: { enabled: boolean; url: string },
): Promise<CobaltAnalyzeResult> {
  void proxy
  const instance = normalizeInstanceUrl(cfg.url)
  if (!instance) {
    return {
      qualities: [],
      warning:
        'No cobalt instance configured. Open Settings and paste your self-hosted cobalt URL to download from TikTok, Instagram, and other social platforms.',
    }
  }

  // Primary request: best quality
  let resp: CobaltResponse
  try {
    resp = await cobaltPost(instance, {
      url: videoUrl,
      videoQuality: 'max',
      downloadMode: 'auto',
    }, cfg)
  } catch {
    return {
      qualities: [],
      warning: `Could not reach your cobalt instance at ${instance}. Make sure it's running and the URL is correct.`,
    }
  }

  if (resp.status === 'error') {
    return {
      qualities: [],
      warning: cobaltErrorMessage(resp.error?.code, resp.error?.context),
    }
  }

  if (resp.status === 'picker' && resp.picker) {
    return buildPickerResult(resp, instance, cfg, videoUrl)
  }

  if (resp.status === 'tunnel' || resp.status === 'redirect') {
    return buildSingleResult(resp, instance, cfg, videoUrl)
  }

  if (resp.status === 'local-processing') {
    return buildLocalProcessingResult(resp, instance, cfg, videoUrl)
  }

  return {
    qualities: [],
    warning: `Unexpected cobalt response: "${resp.status}".`,
  }
}

function buildSingleResult(
  resp: CobaltResponse,
  instance: string,
  cfg: CobaltConfig,
  videoUrl: string,
): CobaltAnalyzeResult {
  const baseName = sanitizeFilename(resp.filename?.replace(/\.[^.]+$/, '') || 'video')
  const ext = resp.filename ? extFromFilename(resp.filename) : 'mp4'

  const qualities: Quality[] = []

  // BEST — the max-quality result we already have
  qualities.push({
    id: 'cobalt-max',
    label: 'Max quality',
    source: 'social',
    kind: 'combined',
    container: ext,
    url: resp.url!,
    notes: 'Best available · via cobalt',
    download: (op) => downloadFromUrl(resp.url!, `${baseName}.${ext}`, op),
  })

  // Preset quality cards — re-request cobalt on download click
  const presets: QualityPreset[] = ['1080', '720', '480', '360']
  for (const q of presets) {
    qualities.push({
      id: `cobalt-${q}`,
      label: qualityPresetLabel(q),
      height: Number(q),
      resolution: `${q}p`,
      source: 'social',
      kind: 'combined',
      container: ext,
      url: '',
      notes: 'Click to fetch at this quality · via cobalt',
      download: async (op) => {
        op?.(0, `requesting ${qualityPresetLabel(q)}…`)
        const r = await cobaltPost(instance, {
          url: videoUrl,
          videoQuality: q,
          downloadMode: 'auto',
        }, cfg)
        if (r.status === 'error') {
          throw new Error(cobaltErrorMessage(r.error?.code, r.error?.context))
        }
        if ((r.status === 'tunnel' || r.status === 'redirect') && r.url) {
          const fn = r.filename || `${baseName}_${q}.${ext}`
          await downloadFromUrl(r.url, fn, op)
        } else {
          throw new Error(`cobalt returned ${r.status} for ${qualityPresetLabel(q)}`)
        }
      },
    })
  }

  return { qualities, title: baseName.replace(/_/g, ' ') }
}

function buildPickerResult(
  resp: CobaltResponse,
  instance: string,
  _cfg: CobaltConfig,
  _videoUrl: string,
): CobaltAnalyzeResult {
  void instance
  const qualities: Quality[] = []
  resp.picker!.forEach((item, i) => {
    const ext = item.type === 'photo' ? extFromMime('image/jpeg') : 'mp4'
    qualities.push({
      id: `picker-${i}`,
      label: item.type === 'photo' ? `Photo ${i + 1}` : item.type === 'gif' ? `GIF ${i + 1}` : `Video ${i + 1}`,
      source: 'social',
      kind: item.type === 'photo' ? 'photo' : 'video',
      container: ext,
      url: item.url,
      thumb: item.thumb,
      notes: item.type,
      download: (op) => downloadFromUrl(item.url, `media_${i + 1}.${ext}`, op),
    })
  })

  // Background audio if present (TikTok slideshows)
  if (resp.audio) {
    qualities.push({
      id: 'picker-audio',
      label: 'Background audio',
      source: 'social',
      kind: 'audio',
      container: 'mp3',
      url: resp.audio,
      notes: 'Slideshow audio',
      download: (op) => downloadFromUrl(resp.audio!, resp.audioFilename || 'audio.mp3', op),
    })
  }

  return { qualities, isPicker: true, title: `Slideshow · ${qualities.length} items` }
}

function buildLocalProcessingResult(
  resp: CobaltResponse,
  _instance: string,
  _cfg: CobaltConfig,
  _videoUrl: string,
): CobaltAnalyzeResult {
  // local-processing: cobalt returns tunnel[] URLs to fetch + output metadata.
  // For v1, offer the first tunnel as a downloadable combined file.
  const tunnels = resp.tunnel ?? []
  if (!tunnels.length) {
    return { qualities: [], warning: 'cobalt returned local-processing with no tunnels.' }
  }
  const out = resp.output
  const filename = out?.filename || 'video.mp4'
  const ext = out?.type ? extFromMime(out.type) : extFromFilename(filename)

  const qualities: Quality[] = [{
    id: 'cobalt-local',
    label: 'Max quality',
    source: 'social',
    kind: 'combined',
    container: ext,
    url: tunnels[0],
    notes: 'via cobalt · local-processing',
    download: (op) => downloadFromUrl(tunnels[0], filename, op),
  }]

  return { qualities, title: filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ') }
}

function cobaltErrorMessage(code?: string, ctx?: Record<string, unknown>): string {
  const limit = (ctx as { limit?: number })?.limit
  const service = (ctx as { service?: string })?.service
  const svc = service ? `[${service}] ` : ''
  const messages: Record<string, string> = {
    'error.api.auth.jwt.missing': 'This cobalt instance requires authentication (JWT).',
    'error.api.auth.key.missing': 'This cobalt instance requires an API key. Add it in Settings.',
    'error.api.auth.key.invalid': 'The API key is invalid.',
    'error.api.rate_exceeded': 'Rate limit exceeded on your cobalt instance. Wait a moment and try again.',
    'error.api.capacity': 'The cobalt instance is at capacity. Try again shortly.',
    'error.api.no_response': `${svc}The source didn't respond. The video may be private or removed.`,
    'error.api.fetch.empty': `${svc}Got an empty response from the source. The link may be invalid.`,
    'error.api.fetch.rate': `${svc}The source rate-limited cobalt. Try again in a minute.`,
    'error.api.fetch.critical': `${svc}The source blocked the request.`,
    'error.api.content.too_long': `${svc}Video exceeds the max duration${limit ? ` (${limit}s)` : ''}.`,
    'error.api.content.video.unavailable': `${svc}Video is unavailable, private, or age-restricted.`,
    'error.api.link.invalid': 'The link is invalid or unsupported.',
    'error.api.link.unsupported': `${svc}This platform isn't supported by cobalt.`,
    'error.api.tunnel.not_found': 'The tunnel URL expired. Re-analyze and try again.',
    'error.api.generic': 'cobalt encountered an error processing this link.',
  }
  return messages[code ?? ''] ?? `${svc}${code ?? 'Unknown error'}`
}
