# baby-book-thing — "Little Chapters" prototype

Customer flow: **pick a book (hardcover / softcover) → pick a cover design → upload a baby photo → pick a style → see the baby on the cover**, shown on a 3D book mockup.

```bash
npm install
npm run dev        # http://localhost:3000
```

## How the cover is made

| Step | Who does it | Cost |
|---|---|---|
| Photo → illustration (watercolor / storybook / sketch) | **AI (Nano Banana)**: `lib/ai/stylize.ts` | paid, **once per photo + style** |
| Smart-crop to the face, mask to the slot shape, stack under frame + title | **sharp script**: `lib/compose.ts` | free |
| Live previews & thumbnails in the browser | same SVG layers: `lib/cover-svg.ts` | free |

Changing the design, title or name re-runs only the free sharp step. The AI never runs again for those changes.
"Original photo" style skips the AI entirely.

## Where things live

- `lib/catalog.ts`: formats, prices, cover templates (photo slot position/shape), styles
- `lib/cover-svg.ts`: cover art as SVG layers (background / mask / overlay), shared by browser + server
- `lib/compose.ts`: sharp compositing (1200×1500 preview, 2400×3000 = 8×10 in @ 300 dpi print)
- `lib/ai/stylize.ts`: style prompts (`STYLE_PROMPTS`, shared `FRAMING`) + placeholder filters
- `lib/ai/gemini.ts`: Nano Banana client (AI Studio key or Vertex/ADC), retries 429/5xx, customer-safe errors
- `app/api/stylize`, `app/api/compose`: POST multipart endpoints
- `components/BookMockup.tsx`: pure-CSS 3D book (hardcover = thick boards + overhang, softcover = thin + flush)

## Env (`.env.local`, see `.env.example`)

- `AI_MODE=live | placeholder`: `placeholder` = free filter fakes for UI work
- `GEMINI_IMAGE_MODEL` (default `gemini-3-pro-image`, Nano Banana Pro). `gemini-2.5-flash-image` is ~3× cheaper but, when told to keep the layout, barely changes the style
- Auth: `GEMINI_API_KEY` (AI Studio, wins if set) **or** `VERTEX_PROJECT_ID` + `VERTEX_LOCATION=global` + `VERTEX_USE_ADC=1` (local `gcloud auth application-default login`)

Measured on Pro: ~20 s per illustration, ~660 input + 1,120 output image tokens (the server log prints usage per call). Pro's shared capacity throttles often (HTTP 429); the client retries up to 5 times over ~50 s.

## Known TODOs

- Deploy auth: ADC only works locally. Use `GEMINI_API_KEY` (or a service account) on Vercel
- Rate limiting per visitor before going public (each click is a paid call)
- Cover text uses system fonts via librsvg. Before deploying to Linux/Vercel, bundle a TTF and render the text with it
- Mobile: the live preview sits below the steps. Add a compact sticky preview
- Checkout / cart is a stub
