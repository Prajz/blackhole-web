export type SourceKind = 'direct' | 'hls' | 'youtube' | 'social' | 'unknown'

export interface Quality {
  id: string
  label: string
  resolution?: string
  width?: number
  height?: number
  fps?: number
  bitrate?: number
  codec?: string
  mime?: string
  container?: string
  size?: number
  url: string
  kind: 'video' | 'audio' | 'combined' | 'photo'
  source: SourceKind
  notes?: string
  thumb?: string
  download: (onProgress?: (pct: number, label: string) => void) => Promise<void>
}

export interface AnalyzeResult {
  source: SourceKind
  title?: string
  qualities: Quality[]
  previewUrl?: string
  isHls?: boolean
  needsProxy?: boolean
  needsCobalt?: boolean
  warning?: string
}

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export interface CobaltConfig {
  url: string
  apiKey?: string
}
