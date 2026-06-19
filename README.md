# BlackHole Web

A no-backend video downloader that runs entirely in your browser. Paste a link, see the available quality options, and download the best one — just like the BlackHole app, but as a static site on GitHub Pages.

## How it works

The [BlackHole app](https://github.com/SeaTean/BlackHole) is a native Flutter app. Native apps aren't bound by browser CORS, so they can freely fetch YouTube's Innertube API and signed `googlevideo.com` stream URLs, plus JioSaavn's internal API for music. BlackHole extracts stream URLs directly from the device and hits the CDN.

A pure static website **cannot** do all of that — browsers enforce CORS, and YouTube/Instagram/TikTok send no CORS headers, so the browser physically cannot fetch those bytes without a proxy. This is a browser security wall, not something JS can bypass.

## What works without a backend (fully):
- Direct video files (`.mp4`, `.webm`, …) that send CORS headers
- HLS `.m3u8` streams — multi-quality playlists are parsed, all variants shown, best auto-picked, segments fetched & concatenated into a downloadable file
- Any CORS-permitted media URL

## What needs cobalt (self-hosted, free):
- TikTok, Instagram, X/Twitter, Facebook, Reddit, Pinterest, Snapchat, Vimeo, SoundCloud, and more
- YouTube (cobalt is more reliable than client-side extraction)

## Legacy: CORS proxy toggle
- Only affects direct/HLS/YouTube client-side extraction
- Best-effort for YouTube via `ytInitialPlayerResponse` parsing
- Does nothing for social platforms (those always use cobalt)

## Features

- Paste any video, `.m3u8`, TikTok, Instagram, X, YouTube, or Facebook link
- Detects source type (direct / HLS / YouTube / social via cobalt)
- Shows every available quality with resolution, fps, bitrate, size, codec
- **Auto-picks the best quality** (highest resolution + bitrate + fps, combined > video-only)
- Live video preview (HLS via hls.js, native for direct)
- Real downloads — HLS segments are fetched and concatenated into a single file
- Slideshow support (TikTok/IG photo carousels show each item with thumbnails)
- Settings persist in localStorage
- Dark, minimal UI — no framework, no tracking

## TikTok, Instagram, X, Facebook, Reddit support (cobalt backend)

Social platforms use bot detection (TLS fingerprinting, JS challenges, signed expiring CDN URLs) that a browser **cannot** bypass — even through a CORS proxy. This is a fundamental browser security limitation.

To support these platforms, the app integrates with **[cobalt](https://github.com/imputnet/cobalt)**, an open-source extraction server that handles TikTok, Instagram, X, Facebook, Reddit, Pinterest, Snapchat, Vimeo, SoundCloud, and 1000+ sites.

### One-time setup (free, ~2 minutes)

1. **Deploy your own cobalt instance** — one click, no code:
   - Go to **https://railway.com/deploy/cobalt-media-downloader**
   - Click Deploy, sign in with GitHub/Railway
   - Leave the defaults (only `API_URL` is required — Railway sets it automatically)
   - Wait ~1 min for deploy. You'll get a URL like `https://cobalt-production-xxxx.up.railway.app`
   - Railway free tier: $5/mo credit, more than enough for personal use

   Alternatives: Docker on a VPS ([docs](https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md)), Fly.io, Render.

2. **Add the URL to the app**:
   - Open the app → **Settings → "Cobalt backend"**
   - Paste your instance URL (e.g. `https://cobalt-production-xxxx.up.railway.app`)
   - Settings are saved automatically. Done.

3. **Paste any TikTok/IG/X link** → quality options appear → download the best one.

### Instagram notes

Public reels work out of the box. For private/login-required content, add a `cookies.json` to your cobalt instance ([instructions](https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md)).

### Optional: protect your instance

If your cobalt URL is public, anyone can use it. To prevent abuse, configure an API key in your cobalt instance env vars, then paste the key in the app's Settings → "API key".

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
