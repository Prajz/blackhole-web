import { fetchText, triggerBlobDownload, fetchBlob, sanitizeFilename, isCorsError } from './fetcher'
import { extFromContainer } from './detect'
import type { ProxyConfig, Quality } from './types'

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (/(^|\.)youtube\.com$/.test(host)) {
      if (u.searchParams.get('v')) return u.searchParams.get('v')
      const m = u.pathname.match(/(shorts|embed|live)\/([\w-]{6,})/)
      if (m) return m[2]
    }
  } catch {
    /* ignore */
  }
  return null
}

function matchBrace(s: string, start: number): string {
  let depth = 0
  let inStr = false
  let esc = false
  let quote = ''
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) inStr = false
    } else {
      if (c === '"' || c === "'") {
        inStr = true
        quote = c
      } else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return s.slice(start, i + 1)
      }
    }
  }
  return s.slice(start, start + 1)
}

interface YtFormat {
  itag: number
  mimeType?: string
  bitrate?: number
  width?: number
  height?: number
  fps?: number
  qualityLabel?: string
  quality?: string
  contentLength?: string
  url?: string
  approxDurationMs?: string
  hasVideo?: boolean
  hasAudio?: boolean
}

export interface YtResult {
  qualities: Quality[]
  title?: string
  needsProxy: boolean
  warning?: string
}

export async function analyzeYouTube(
  url: string,
  proxy: ProxyConfig,
  onProgress: (pct: number, label: string) => void,
): Promise<YtResult> {
  const id = extractYouTubeId(url)
  if (!id) return { qualities: [], needsProxy: true, warning: 'Could not parse a YouTube video ID.' }

  // YouTube pages never send CORS headers -> proxy is mandatory.
  if (!proxy.enabled) {
    return {
      qualities: [],
      needsProxy: true,
      warning:
        'YouTube blocks cross-origin browser requests. Enable "Route fetches through a CORS proxy" in Settings to attempt extraction. Results are best-effort and may fail.',
    }
  }

  const watchUrl = `https://www.youtube.com/watch?v=${id}`
  let html: string
  try {
    html = await fetchText(watchUrl, proxy, true)
  } catch (e) {
    return {
      qualities: [],
      needsProxy: true,
      warning: `Could not fetch the YouTube page via proxy. ${isCorsError(e) ? 'The proxy blocked or rate-limited the request.' : (e as Error).message}`,
    }
  }

  const playerResponse = extractPlayerResponse(html)
  if (!playerResponse) {
    return {
      qualities: [],
      needsProxy: true,
      warning: 'Could not extract player data from the page. YouTube may have changed its markup.',
    }
  }

  const title: string | undefined =
    playerResponse?.videoDetails?.title ?? playerResponse?.microformat?.playerMicroformatRenderer?.title
  const sd = playerResponse?.streamingData
  const formats: YtFormat[] = [
    ...((sd?.formats as YtFormat[]) ?? []),
    ...((sd?.adaptiveFormats as YtFormat[]) ?? []),
  ].filter((f) => f && f.url)

  if (!formats.length) {
    return {
      qualities: [],
      needsProxy: true,
      title,
      warning:
        'Streams are signature-protected (signatureCipher). Client-side signing is not supported — use a desktop downloader for this video.',
    }
  }

  const base = sanitizeFilename(title || `youtube_${id}`)
  const qualities: Quality[] = formats.map((f) => {
    const mime = f.mimeType ?? ''
    const hasVideo = mime.includes('video') || !!f.width
    const hasAudio = mime.includes('audio') || mime.includes('mp4a') || mime.includes('opus')
    const kind: Quality['kind'] = hasVideo && hasAudio ? 'combined' : hasVideo ? 'video' : 'audio'
    const label =
      f.qualityLabel ||
      (f.height ? `${f.height}p` : kind === 'audio' ? 'audio' : `${f.itag}`) +
        (kind === 'video' ? ' (video only)' : kind === 'audio' ? ' (audio only)' : '')
    const size = f.contentLength ? Number(f.contentLength) : undefined
    return {
      id: `${f.itag}`,
      label,
      width: f.width,
      height: f.height,
      fps: f.fps,
      bitrate: f.bitrate,
      codec: mime.split(';')[0],
      mime,
      container: extFromContainer(undefined) === 'mp4' ? (mime.includes('webm') ? 'webm' : 'mp4') : 'mp4',
      size,
      url: f.url!,
      kind,
      source: 'youtube',
      notes: kind === 'combined' ? 'YouTube · progressive' : 'YouTube · adaptive (mux with audio for full file)',
      download: (op) => downloadYtStream(f.url!, proxy, base, f, op ?? onProgress),
    }
  })

  return { qualities, title, needsProxy: true }
}

async function downloadYtStream(
  url: string,
  proxy: ProxyConfig,
  base: string,
  f: YtFormat,
  onProgress: (pct: number, label: string) => void,
): Promise<void> {
  onProgress?.(0, 'fetching stream')
  const blob = await fetchBlob(url, proxy, true)
  onProgress?.(100, 'done')
  const mime = f.mimeType ?? 'video/mp4'
  const container = mime.includes('webm') ? 'webm' : mime.includes('mp4a') || mime.includes('opus') ? 'm4a' : 'mp4'
  triggerBlobDownload(blob, `${base}.${container}`)
}

function extractPlayerResponse(html: string): any | null {
  const markers = [
    /ytInitialPlayerResponse\s*=\s*/,
    /"ytInitialPlayerResponse"\s*:\s*/,
  ]
  for (const re of markers) {
    const m = html.match(re)
    if (m && m.index !== undefined) {
      const start = html.indexOf('{', m.index)
      if (start !== -1) {
        const json = matchBrace(html, start)
        try {
          return JSON.parse(json)
        } catch {
          continue
        }
      }
    }
  }
  return null
}
