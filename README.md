# IQ2SAVE

**Your Links. Your Media.**

A local media archiving tool. Paste a link, pick a format, keep the file. The
server runs on your own device, there is no account, nothing is uploaded, and
no third party sees the URLs you paste.

> **Use it only for media you own, media you created, or media you have explicit
> permission to download.** IQ2SAVE does not bypass DRM, logins, paywalls or
> anti-bot protection, and it will not be modified to do so.

---

## What it actually does

| Capability | How | Real? |
| --- | --- | --- |
| Direct file links (`.mp4`, `.mp3`, images, anything) | streamed over HTTP(S) with an SSRF-screened fetcher | yes |
| HLS (`.m3u8`) and DASH (`.mpd`) playlists | remuxed into one file with `ffmpeg` | yes |
| Extract audio as MP3 | `ffmpeg` re-encode after download | yes |
| Metadata + format list for supported sites | `yt-dlp -J` | yes |
| Progress bar | parsed from `yt-dlp --progress-template`, `ffmpeg -progress`, or HTTP byte counters | yes — and it shows an *indeterminate* bar rather than a fake percentage when the source reports no total size |

Everything above is wired to a real subprocess or a real socket. Nothing in this
project returns canned data.

### What it deliberately does not do

This started as a spec for a public, ad-monetised downloader site. Those parts
were dropped on purpose because they cannot be delivered honestly:

- **No ads / AdSense.** Ad networks do not approve media-downloader sites.
- **No public hosting config.** Large platforms block datacenter IPs, so a
  VPS-hosted build would fail for the exact links people want most. Running on
  your own device is the only version that actually works.
- **No legal/DMCA/contact/SEO scaffolding.** Those exist to serve strangers;
  this serves one person on one device.
- **No accounts, analytics, Postgres or Redis.** SQLite is built into Node.

---

## Requirements

- **Node.js ≥ 22.5.0** — needs `node:sqlite` and `process.loadEnvFile()`.
  Developed and tested on Node 26.4.0, Android/arm64.
- **yt-dlp** — metadata and site extraction.
- **ffmpeg** (with `ffprobe`) — merging, remuxing, MP3 extraction, and reading
  the true stream layout of a file.

Only one npm dependency: `express`.

---

## Setup on Termux (Android)

```bash
pkg update && pkg upgrade
pkg install -y nodejs ffmpeg yt-dlp git

git clone <this-repo> ~/clipmate   # or just copy the folder over
cd ~/clipmate
npm install
cp .env.example .env
```

### Let downloads land somewhere you can open them

By default IQ2SAVE saves into `~/clipmate/downloads`, which lives inside
Termux's private app storage — your gallery and file manager cannot see it.
To fix that, grant storage access:

```bash
termux-setup-storage
```

**This one is on you:** Android shows a permission dialog and you have to tap
**Allow**. It cannot be scripted. Once granted, `~/storage/downloads` exists and
IQ2SAVE automatically switches to `~/storage/downloads/ClipMate`, which is
visible to every other app on the phone.

### Check everything before you start

```bash
npm run doctor
```

```
  [ok  ] node 26.4.0        android/arm64
  [ok  ] node:sqlite        built-in, no native build needed
  [ok  ] downloads dir      /.../clipmate/downloads
  [ok  ] yt-dlp             2026.08.19
  [ok  ] ffmpeg             ffmpeg version 8.1.2
  [ok  ] mp3 extraction     available
  [ok  ] video+audio merge  available
```

`FAIL` lines are hard blockers; `warn` lines are optional improvements. The
command exits non-zero if anything required is missing.

### Run

```bash
npm start          # http://127.0.0.1:3000
npm run dev        # same, restarts on file changes
npm test           # 52 tests, mostly URL/SSRF hardening
```

Then open **http://127.0.0.1:3000** in the phone's browser. Keep the Termux
session alive — `termux-wake-lock` stops Android from freezing it mid-download.

---

## Using it

1. Paste a link and press **Analyze**. IQ2SAVE inspects the URL locally and
   lists the formats that genuinely exist, with real byte sizes where the source
   provides them and `size unknown` where it does not.
2. Pick a format and press **Download**. Progress updates come from the engine's
   own output.
3. The file lands in your downloads folder. **Library** lists every job with its
   status, size and error message if it failed.

### On links that will not work

Some links legitimately fail, and IQ2SAVE tells you which kind:

- content behind a login, private, or age-restricted
- content the platform serves only to browsers it trusts ("bot check")
- region-locked content
- files above `MAX_FILE_BYTES`

These are refusals, not bugs. Working around them would mean bypassing access
controls, which this project does not do.

---

## Configuration

Every setting lives in `.env` and every one is optional — see `.env.example` for
the annotated list. The ones worth knowing:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `HOST` | `127.0.0.1` | |
| `ALLOW_REMOTE` | `false` | **Required** to bind anything but loopback. Without it a non-loopback `HOST` is ignored and logged. |
| `DOWNLOAD_DIR` | auto | Prefers `~/storage/downloads/ClipMate`, else `./downloads`. |
| `MAX_CONCURRENT_JOBS` | `2` | Phones have limited CPU; 2 is a sane ceiling. |
| `MAX_FILE_BYTES` | `2 GiB` | `0` disables the check. |
| `RATE_LIMIT_MAX` | `240` | Per minute, per IP, on `/api` only. Must stay above ~100: a running download is polled every 900 ms. `/analyze` and `/download` have their own stricter limits. |

### A note on `ALLOW_REMOTE`

IQ2SAVE spawns subprocesses on your behalf. Exposing it to a network means
exposing that. It binds to loopback only unless you explicitly opt in, and it
warns loudly in the log when you do. Do not put it on an untrusted network.

---

## How it is put together

```
server/
  config/       env loading, Termux-aware paths, loopback enforcement
  db/           node:sqlite schema + repositories
  engines/      ytdlp.js, ffmpeg.js, httpStream.js — the only places a
                subprocess or socket is opened
  providers/    per-site adapters behind one interface + a registry
  services/     analyze, jobQueue, capabilities, cleanup
  middleware/   security headers/CSP, CORS, rate limit, error funnel
  routes/api.js the whole HTTP surface
public/         multi-page UI: shared CSS/JS, EN/HI locales
test/           node:test
```

### Design decisions that matter

**Progress is never invented.** A job carries `determinate: false` whenever the
engine cannot supply a real total, and the UI renders a sweeping bar with the
note "total size unknown" instead of a made-up percentage.

**The client never names an engine argument.** `POST /api/download` accepts a
format `id` only. The server re-analyses the URL and re-derives the actual
format selector, so a crafted request cannot smuggle flags into `yt-dlp`. All
subprocesses use `spawn` with `shell: false`, array arguments and a `--`
separator.

**Outbound URLs are screened, then pinned.** Every hostname is resolved, every
returned address is checked against private/loopback/link-local/multicast
ranges, and the connection is then pinned to the exact IP that passed via
`options.lookup`. That closes the DNS-rebinding window where a second lookup
returns `169.254.169.254`. Redirects are followed manually and re-validated at
each hop.

**ffprobe is the source of truth for direct files.** `yt-dlp`'s generic
extractor reports `vcodec: null` and `audio_ext: "none"` for plain MP4s that
demonstrably do have audio. MP3 extraction is only offered when ffprobe finds a
real audio stream.

**Errors are curated at one exit point.** Only `AppError` instances reach the
client; anything else is logged in full and returned as a generic message, so
stack traces, filesystem paths and engine internals never leave the process.

---

## API

All responses are `{ "success": true, "data": … }` or
`{ "success": false, "error": { "code", "message" } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/system` | engine versions, limits, paths, stats |
| `GET` | `/api/services` | provider registry |
| `POST` | `/api/analyze` | `{ url }` → media + real format list |
| `POST` | `/api/download` | `{ url, formatId }` → `202` + job |
| `GET` | `/api/job/:id` | poll status/progress |
| `GET` | `/api/job/:id/logs` | per-job processing log |
| `DELETE` | `/api/job/:id` | cancel if running, else delete the row |
| `GET` | `/api/jobs` | history, `?limit &offset &status` |
| `GET` | `/api/file/:id` | download a finished file |
| `GET` | `/healthz` | liveness |

---

## Troubleshooting

**"Required tool … is not installed"** — `pkg install yt-dlp ffmpeg`, then
restart. Version info is cached at boot.

**Downloads are invisible in my file manager** — you have not run
`termux-setup-storage`, or you did not tap Allow. Run `npm run doctor`; the
`shared storage` line tells you which.

**A site that worked last month stopped working** — extractors break when sites
change. `pkg upgrade yt-dlp` fixes most of it. This is normal and permanent; no
downloader is immune.

**Download dies when I switch apps** — Android froze the Termux process. Run
`termux-wake-lock` before starting, and keep the notification pinned.

**`EXDEV` in the log** — expected and handled. Moving a file from Termux app
storage to shared storage crosses filesystems, so IQ2SAVE falls back from
`rename` to copy-then-delete.

---

## License

MIT. See `LICENSE`.

The license covers this code. It does not grant you any right to the media you
point it at — that is between you and whoever owns the content.
