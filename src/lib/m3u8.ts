import { fetchBlob, fetchRange, fetchText, triggerBlobDownload, sanitizeFilename } from './fetcher'
import type { ProxyConfig, Quality } from './types'
import { extFromContainer } from './detect'

export interface M3u8Variant {
  bandwidth: number
  resolution?: string
  width?: number
  height?: number
  frameRate?: number
  codecs?: string
  url: string
}

export interface M3u8Media {
  isMaster: boolean
  variants: M3u8Variant[]
  segmentUrls: string[]
  initUrl?: string
  durations: number[]
  byteranges: { url: string; length: number; offset: number }[]
  targetDuration?: number
}

function resolve(base: string, rel: string): string {
  try {
    return new URL(rel, base).href
  } catch {
    return rel
  }
}

function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  // split on commas not inside quotes
  const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq === -1) continue
    const key = p.slice(0, eq).trim()
    let val = p.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    attrs[key] = val
  }
  return attrs
}

export function parseM3u8(text: string, baseUrl: string): M3u8Media {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))
  const variants: M3u8Variant[] = []
  const segmentUrls: string[] = []
  const durations: number[] = []
  const byteranges: { url: string; length: number; offset: number }[] = []
  let initUrl: string | undefined
  let pendingByterange: { length: number; offset: number | undefined } | undefined
  let prevOffset = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length))
      const uri = lines[i + 1]?.trim()
      if (uri && !uri.startsWith('#')) {
        const res = a.RESOLUTION
        const [w, h] = res ? res.split('x').map(Number) : [undefined, undefined]
        variants.push({
          bandwidth: Number(a.BANDWIDTH) || 0,
          resolution: res,
          width: w,
          height: h,
          frameRate: a['FRAME-RATE'] ? Number(a['FRAME-RATE']) : undefined,
          codecs: a.CODECS,
          url: resolve(baseUrl, uri),
        })
      }
      i++
      continue
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(line.slice('#EXT-X-MAP:'.length))
      if (a.URI) initUrl = resolve(baseUrl, a.URI)
      if (a.BYTERANGE) {
        // map byterange handled simply: fetch full init via range
      }
      continue
    }

    if (line.startsWith('#EXTINF:')) {
      const dur = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0
      // next non-comment line is the segment uri
      const uri = lines[i + 1]?.trim()
      if (uri && !uri.startsWith('#')) {
        const abs = resolve(baseUrl, uri)
        segmentUrls.push(abs)
        durations.push(dur)
        if (pendingByterange) {
          const br = pendingByterange
          const off = br.offset ?? prevOffset
          byteranges.push({ url: abs, length: br.length, offset: off })
          prevOffset = off + br.length
          pendingByterange = undefined
        }
      }
      i++
      continue
    }

    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const spec = line.slice('#EXT-X-BYTERANGE:'.length)
      const [len, off] = spec.split('@')
      pendingByterange = { length: Number(len), offset: off ? Number(off) : undefined }
    }
  }

  return {
    isMaster,
    variants,
    segmentUrls,
    initUrl,
    durations,
    byteranges,
  }
}

export async function downloadHlsVariant(
  mediaPlaylistUrl: string,
  proxy: ProxyConfig,
  filenameBase: string,
  onProgress?: (pct: number, label: string) => void,
): Promise<void> {
  const text = await fetchText(mediaPlaylistUrl, proxy)
  const m = parseM3u8(text, mediaPlaylistUrl)

  // If we accidentally got a master, pick best variant and recurse.
  if (m.isMaster && m.variants.length) {
    const best = [...m.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0]
    return downloadHlsVariant(best.url, proxy, filenameBase, onProgress)
  }

  const parts: Blob[] = []
  const total = m.segmentUrls.length + (m.initUrl ? 1 : 0)
  let done = 0

  if (m.initUrl) {
    parts.push(await fetchBlob(m.initUrl, proxy))
    done++
    onProgress?.(Math.round((done / total) * 100), 'init segment')
  }

  const rangeMap = new Map(m.byteranges.map((b) => [b.url, b]))

  for (const seg of m.segmentUrls) {
    const r = rangeMap.get(seg)
    if (r) {
      parts.push(await fetchRange(seg, r.length, r.offset, proxy))
    } else {
      parts.push(await fetchBlob(seg, proxy))
    }
    done++
    onProgress?.(Math.round((done / total) * 100), `segment ${done}/${total}`)
  }

  const mime = m.initUrl ? 'video/mp4' : 'video/mp2t'
  const container = m.initUrl ? 'mp4' : 'ts'
  const blob = new Blob(parts, { type: mime })
  triggerBlobDownload(blob, `${sanitizeFilename(filenameBase)}.${extFromContainer(container)}`)
}

export function hlsVariantToQuality(
  v: M3u8Variant,
  proxy: ProxyConfig,
  filenameBase: string,
  onProgress: (pct: number, label: string) => void,
): Quality {
  const label = v.height ? `${v.height}p` : v.bandwidth ? `${Math.round(v.bandwidth / 1000)}k` : 'stream'
  return {
    id: v.url,
    label,
    resolution: v.resolution,
    width: v.width,
    height: v.height,
    fps: v.frameRate,
    bitrate: v.bandwidth,
    codec: v.codecs,
    source: 'hls',
    kind: 'combined',
    container: 'ts',
    url: v.url,
    notes: 'HLS · segments fetched & concatenated',
    download: (op) => downloadHlsVariant(v.url, proxy, filenameBase, op ?? onProgress),
  }
}
