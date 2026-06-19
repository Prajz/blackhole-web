import type { ProxyConfig } from './types'

export function applyProxy(url: string, proxy: ProxyConfig, force = false): string {
  if ((proxy.enabled || force) && proxy.url) {
    return proxy.url + encodeURIComponent(url)
  }
  return url
}

export async function fetchText(url: string, proxy: ProxyConfig, force = false): Promise<string> {
  const res = await fetch(applyProxy(url, proxy, force), { credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

export async function fetchBlob(url: string, proxy: ProxyConfig, force = false): Promise<Blob> {
  const res = await fetch(applyProxy(url, proxy, force), { credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching segment`)
  return res.blob()
}

export async function fetchRange(
  url: string,
  length: number,
  offset: number,
  proxy: ProxyConfig,
  force = false,
): Promise<Blob> {
  const headers: Record<string, string> = {
    Range: `bytes=${offset}-${offset + length - 1}`,
  }
  const res = await fetch(applyProxy(url, proxy, force), { headers, credentials: 'omit' })
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} on range fetch`)
  return res.blob()
}

export function isCorsError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('cors') ||
    msg.includes('blocked')
  )
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const obj = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = obj
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(obj), 20000)
}

export function sanitizeFilename(name: string): string {
  return (name || 'video').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'video'
}
