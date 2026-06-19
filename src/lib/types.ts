export type SourceKind = 'direct' | 'hls' | 'youtube' | 'unknown'

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
  kind: 'video' | 'audio' | 'combined'
  source: SourceKind
  notes?: string
  download: (onProgress?: (pct: number, label: string) => void) => Promise<void>
}

export interface AnalyzeResult {
  source: SourceKind
  title?: string
  qualities: Quality[]
  previewUrl?: string
  isHls?: boolean
  needsProxy?: boolean
  warning?: string
}

export interface ProxyConfig {
  enabled: boolean
  url: string
}
