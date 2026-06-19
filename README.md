# BlackHole Web

A no-backend video downloader that runs entirely in your browser. Paste a link, see the available quality options, and download the best one — just like the BlackHole app, but as a static site on GitHub Pages.

## How it works

The [BlackHole app](https://github.com/SeaTean/BlackHole) is a native Flutter app. Native apps aren't bound by browser CORS, so they can freely fetch YouTube's Innertube API and signed `googlevideo.com` stream URLs, plus JioSaavn's internal API for music. BlackHole extracts stream URLs directly from the device and hits the CDN.

A pure static website **cannot** do all of that — browsers enforce CORS, and YouTube/Instagram/TikTok send no CORS headers, so the browser physically cannot fetch those bytes without a proxy. This is a browser security wall, not something JS can bypass.

**What works no-backend (fully):**
- Direct video files (`.mp4`, `.webm`, …) that send CORS headers
- HLS `.m3u8` streams — multi-quality playlists are parsed, all variants shown, best auto-picked, segments fetched & concatenated into a downloadable file
- Any CORS-permitted media URL

**What needs the optional CORS proxy (best-effort):**
- YouTube (page scraped, `ytInitialPlayerResponse` parsed, progressive + adaptive formats extracted)
- Instagram / TikTok / other social platforms
- Any cross-origin source that blocks browser fetches

Toggle **Settings → CORS proxy** and provide a proxy URL prefix (default: `https://corsproxy.io/?url=`). Public proxies are third-party and may rate-limit or break.

## Features

- Paste any video or `.m3u8` link
- Detects source type (direct / HLS / YouTube)
- Shows every available quality with resolution, fps, bitrate, size, codec
- **Auto-picks the best quality** (highest resolution + bitrate + fps, combined > video-only)
- Live video preview (HLS via hls.js, native for direct)
- Real downloads — HLS segments are fetched and concatenated into a single file
- One-file download progress
- Dark, minimal UI — no framework, no backend, no tracking

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs to dist/
npm run typecheck
```

## Deploy

Push to `main`. The included GitHub Actions workflow builds and deploys to GitHub Pages automatically.

## Tech

- Vite + TypeScript (no framework)
- hls.js for HLS playback
- Custom m3u8 parser for segment fetching & concatenation
- Custom YouTube `ytInitialPlayerResponse` extractor

## Honest limitations

YouTube signature-protected streams (`signatureCipher`) cannot be signed client-side. For those videos, use a desktop downloader. This is a fundamental constraint of client-side-only extraction, not a bug.
