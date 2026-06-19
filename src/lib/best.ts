import type { Quality } from './types'

export function qualityScore(q: Quality): number {
  const h = q.height ?? 0
  const w = q.width ?? 0
  const br = q.bitrate ?? 0
  const fps = q.fps ?? 0
  const kindBonus = q.kind === 'combined' ? 1e9 : q.kind === 'video' ? 1e8 : 0
  return kindBonus + h * 10000 + w + br / 1e6 + fps
}

export function pickBest(qualities: Quality[]): Quality | undefined {
  if (!qualities.length) return undefined
  return [...qualities].sort((a, b) => qualityScore(b) - qualityScore(a))[0]
}

export function rank(qualities: Quality[]): Quality[] {
  return [...qualities].sort((a, b) => qualityScore(b) - qualityScore(a))
}

export function formatBytes(n?: number): string {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDuration(s?: number): string {
  if (!s || !isFinite(s)) return '—'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
