import { detectSource, guessContainer, extFromContainer } from './detect'
import { fetchText, fetchBlob, triggerBlobDownload, sanitizeFilename, isCorsError } from './fetcher'
import { parseM3u8, hlsVariantToQuality, downloadHlsVariant } from './m3u8'
import { probeVideo } from './probe'
import { analyzeYouTube } from './youtube'
import { analyzeWithCobalt, cobaltEnabled } from './cobalt'
import type { AnalyzeResult, CobaltConfig, ProxyConfig, Quality } from './types'

export async function analyze(
  url: string,
  proxy: ProxyConfig,
  cobalt: CobaltConfig,
  onProgress: (pct: number, label: string) => void,
): Promise<AnalyzeResult> {
  const source = detectSource(url)
  const cleanUrl = url.trim()

  if (source === 'social') {
    if (!cobaltEnabled(cobalt)) {
      return {
        source: 'social',
        qualities: [],
        needsCobalt: true,
        warning:
          'TikTok, Instagram, X, and other social platforms require a backend to bypass bot detection. Open Settings → "Cobalt backend" and paste your self-hosted cobalt instance URL. See the link there for one-click deploy.',
      }
    }
    const result = await analyzeWithCobalt(cleanUrl, cobalt, proxy)
    return {
      source: 'social',
      title: result.title,
      qualities: result.qualities,
      previewUrl: cleanUrl,
      warning: result.warning,
      needsCobalt: !result.qualities.length,
    }
  }

  if (source === 'youtube') {
    // If cobalt is configured, prefer it for YouTube too (more reliable).
    if (cobaltEnabled(cobalt)) {
      const result = await analyzeWithCobalt(cleanUrl, cobalt, proxy)
      if (result.qualities.length) {
        return {
          source: 'social',
          title: result.title,
          qualities: result.qualities,
          previewUrl: cleanUrl,
          warning: result.warning,
        }
      }
      // cobalt failed — fall through to client-side extraction
    }
    const yt = await analyzeYouTube(cleanUrl, proxy, onProgress)
    return {
      source: 'youtube',
      title: yt.title,
      qualities: yt.qualities,
      previewUrl: cleanUrl,
      needsProxy: yt.needsProxy,
      warning: yt.warning,
    }
  }

  if (source === 'hls' || source === 'unknown') {
    // Try HLS first (covers .m3u8 and adaptive unknowns).
    try {
      const text = await fetchText(cleanUrl, proxy)
      if (text.includes('#EXTM3U')) {
        return await buildHlsResult(text, cleanUrl, proxy, onProgress)
      }
      if (source === 'hls') {
        return {
          source: 'hls',
          qualities: [],
          warning: 'The URL did not return a valid HLS playlist.',
        }
      }
    } catch (e) {
      if (source === 'hls') {
        return {
          source: 'hls',
          qualities: [],
          warning: fetchErrorMessage(e, proxy),
        }
      }
      // fall through to direct for unknown
    }
  }

  // Direct video file
  return await buildDirectResult(cleanUrl, proxy, onProgress)
}

async function buildHlsResult(
  text: string,
  baseUrl: string,
  proxy: ProxyConfig,
  onProgress: (pct: number, label: string) => void,
): Promise<AnalyzeResult> {
  const m = parseM3u8(text, baseUrl)
  const filenameBase = deriveName(baseUrl)

  if (m.isMaster && m.variants.length) {
    const qualities = m.variants.map((v) =>
      hlsVariantToQuality(v, proxy, filenameBase, onProgress),
    )
    return {
      source: 'hls',
      isHls: true,
      previewUrl: baseUrl,
      qualities,
    }
  }

  // Media playlist (single quality) -> one downloadable item.
  const single: Quality = {
    id: baseUrl,
    label: 'HLS stream',
    source: 'hls',
    kind: 'combined',
    container: m.initUrl ? 'mp4' : 'ts',
    url: baseUrl,
    notes: `HLS · ${m.segmentUrls.length} segments`,
    download: (op) => downloadHlsVariant(baseUrl, proxy, filenameBase, op ?? onProgress),
  }
  return {
    source: 'hls',
    isHls: true,
    previewUrl: baseUrl,
    qualities: [single],
  }
}

async function buildDirectResult(
  url: string,
  proxy: ProxyConfig,
  onProgress: (pct: number, label: string) => void,
): Promise<AnalyzeResult> {
  const container = guessContainer(url)
  const probe = await probeVideo(url)
  const filenameBase = deriveName(url)

  let size: number | undefined
  try {
    const res = await fetch(applyProxyHead(url, proxy), { method: 'GET', credentials: 'omit' })
    if (res.ok) {
      size = res.headers.get('Content-Length') ? Number(res.headers.get('Content-Length')) : undefined
    }
    res.body?.cancel()
  } catch {
    /* size optional */
  }

  const q: Quality = {
    id: url,
    label: probe.height ? `${probe.height}p` : 'source',
    width: probe.width,
    height: probe.height,
    resolution: probe.width && probe.height ? `${probe.width}x${probe.height}` : undefined,
    container,
    mime: container === 'webm' ? 'video/webm' : 'video/mp4',
    size,
    url,
    kind: 'combined',
    source: 'direct',
    notes: 'Direct video file',
    download: async (op) => {
      const prog = op ?? onProgress
      prog(0, 'fetching')
      try {
        const blob = await fetchBlob(url, proxy)
        prog(100, 'done')
        triggerBlobDownload(blob, `${sanitizeFilename(filenameBase)}.${extFromContainer(container)}`)
      } catch (e) {
        throw new Error(fetchErrorMessage(e, proxy))
      }
    },
  }

  return {
    source: 'direct',
    previewUrl: url,
    qualities: [q],
    warning:
      probe.height || size
        ? undefined
        : 'Could not probe metadata. If this is a cross-origin file that blocks CORS, enable the proxy toggle.',
  }
}

function applyProxyHead(url: string, proxy: ProxyConfig): string {
  return proxy.enabled && proxy.url ? proxy.url + encodeURIComponent(url) : url
}

function deriveName(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    return last.replace(/\.[a-z0-9]+$/i, '') || 'video'
  } catch {
    return 'video'
  }
}

function fetchErrorMessage(e: unknown, proxy: ProxyConfig): string {
  if (isCorsError(e)) {
    return proxy.enabled
      ? 'Request failed. The proxy may have blocked it, or the resource is unavailable.'
      : 'Browser blocked this cross-origin request (CORS). Enable "Route fetches through a CORS proxy" in Settings and try again.'
  }
  return (e as Error).message || 'Request failed.'
}
