# AdsFriendly

AdsFriendly is a Chrome extension focused on friendly ad protection: pop-under prevention, safer navigation decisions, lightweight in-page ad cleanup, and early video-ad detection.

## Features

- Pop-under and suspicious new-tab protection.
- User intent tracking for safer navigation decisions.
- In-page ad cleanup with learned rules.
- Manual picker for marking ads and training local patterns.
- Video ad heuristics with stream manifest inspection.
- Content-neutral player sessions and bounded playback timelines.
- Optional Media Helper downloads for supported Direct, HLS, DASH, YouTube,
  Facebook, and validated custom-player output.
- Modular source layout under `src/`, bundled with esbuild.

## Development

Install dependencies and build the runtime bundles:

```powershell
pnpm install
pnpm build
```

The Chrome extension manifest loads the generated root files:

- `background.js`
- `content.js`
- `picker.js`
- `video_surgeon.js`
- `injected_spy.js`

Source modules live in `src/`. Architecture notes are in `docs/ARCHITECTURE.md`.
