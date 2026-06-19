export interface ProbeResult {
  width?: number
  height?: number
  duration?: number
  seekable?: boolean
}

export function probeVideo(url: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const cleanup = () => {
      v.removeAttribute('src')
      v.load()
    }
    const done = (r: ProbeResult) => {
      cleanup()
      resolve(r)
    }
    v.onloadedmetadata = () => {
      done({
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
        seekable: v.seekable && v.seekable.length > 0,
      })
    }
    v.onerror = () => done({})
    // Metadata may load even cross-origin for media elements.
    v.src = url
    // Safety timeout
    setTimeout(() => done({}), 6000)
  })
}
