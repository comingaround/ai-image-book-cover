# AI image book cover

A personalised storybook cover builder. Customers pick a hardcover or softcover book and a cover design, upload a photo, choose an illustration style, and see the result on an interactive 3D book mockup.

Built with Next.js (App Router), React, Tailwind CSS, [sharp](https://sharp.pixelplumbing.com/) and Google's Gemini image model (Nano Banana).

```bash
npm install
cp .env.example .env.local   # then fill in one auth option
npm run dev                  # http://localhost:3000
```

## How a cover is made

| Step | Done by | Cost |
|---|---|---|
| Photo → watercolor / storybook / pencil-sketch illustration | Gemini image model, `lib/ai/stylize.ts` | paid, once per photo + style |
| Crop toward the face, cut to the frame shape, add background, frame and title | sharp, `lib/compose.ts` | free |
| Instant previews and template thumbnails | the same SVG layers in the browser, `lib/cover-svg.ts` | free |

The AI only restyles the photo. Placing it on the cover is plain image processing, so changing the design, title or name never calls the AI again. Generated illustrations are also saved in the browser (IndexedDB), so the same photo and style are never generated twice. "Original photo" skips the AI entirely.

## Project layout

- `lib/catalog.ts`: book formats, cover templates (photo slot, colours, text positions) and styles
- `lib/cover-svg.ts`: cover artwork as SVG layers, with text drawn as glyph outlines from bundled fonts so it renders identically on any server
- `lib/compose.ts`: sharp compositing at preview (1200×1500) or print size (2400×3000, 8×10 in at 300 dpi)
- `lib/ai/stylize.ts`: style prompts and free placeholder filters
- `lib/ai/gemini.ts`: Gemini client with three auth options and retries while capacity is busy
- `lib/art-cache.ts`: browser-side cache of generated illustrations
- `lib/rate-limit.ts`: per-visitor limit on paid AI calls
- `app/api/stylize`, `app/api/compose`: the two POST endpoints
- `components/Builder.tsx`: the step-by-step UI; `components/BookMockup.tsx`: the CSS 3D book

## Configuration

See `.env.example`.

- `AI_MODE`: `live` calls Gemini; `placeholder` uses free filter imitations for UI work
- `GEMINI_IMAGE_MODEL`: defaults to `gemini-3-pro-image`. The cheaper `gemini-2.5-flash-image` barely changes the style when asked to keep the layout
- Auth, first configured wins:
  - `GEMINI_API_KEY` (Google AI Studio)
  - Vertex AI keyless sign-in on Vercel: `VERTEX_PROJECT_ID` + `VERTEX_WORKLOAD_AUDIENCE` + `VERTEX_SERVICE_ACCOUNT_EMAIL`
  - Vertex AI locally: `VERTEX_PROJECT_ID` + `VERTEX_USE_ADC=1` (uses `gcloud auth application-default login`)

## Not included

Checkout is a placeholder, and the rate limit is in-memory per server instance (a shared store such as Redis would be needed for a real quota).
