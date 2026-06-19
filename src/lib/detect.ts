import type { SourceKind } from './types'

export function detectSource(url: string): SourceKind {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return 'unknown'
  }
  const host = u.hostname.replace(/^www\./, '')
  if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') return 'youtube'
  const path = u.pathname.toLowerCase()
  if (path.endsWith('.m3u8') || path.includes('.m3u8')) return 'hls'
  if (path.endsWith('.mpd')) return 'hls' // DASH handled loosely as adaptive
  if (/\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi)$/.test(path)) return 'direct'
  return 'unknown'
}

export function guessContainer(url: string, mime?: string): string {
  const path = url.split('?')[0].toLowerCase()
  if (mime) {
    if (mime.includes('mp4')) return 'mp4'
    if (mime.includes('webm')) return 'webm'
    if (mime.includes('mp2t')) return 'ts'
    if (mime.includes('ogg')) return 'ogg'
  }
  if (path.endsWith('.m3u8')) return 'ts'
  if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'mp4'
  if (path.endsWith('.webm')) return 'webm'
  if (path.endsWith('.ts')) return 'ts'
  return 'mp4'
}

export function extFromContainer(c?: string): string {
  switch (c) {
    case 'webm':
      return 'webm'
    case 'ts':
      return 'ts'
    case 'ogg':
      return 'ogg'
    case 'mov':
      return 'mov'
    default:
      return 'mp4'
  }
}
