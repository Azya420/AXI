# axi-preview-generator

Backend service for AXI. Takes a customer's uploaded photo and calls the
OpenAI image API to produce a preview render styled like AXI's resin
miniature figurines. Exists as a separate service (not part of the static
site) because calling OpenAI directly from the browser would expose the API
key publicly.

## Endpoints

- `GET /health` - health check, also reports whether `OPENAI_API_KEY` is set.
- `POST /api/preview` - multipart form, field `photo` (JPG/PNG/WEBP, max 8MB).
  Returns `{ "image": "data:image/png;base64,..." }` on success.

## Local development

```bash
cd server
cp .env.example .env   # fill in OPENAI_API_KEY
npm install
npm run dev
```

Then:

```bash
curl -F "photo=@/path/to/photo.jpg" http://localhost:3000/api/preview
```

## Deploying on Render

This repo includes a `render.yaml` Blueprint at the repo root.

1. In the Render dashboard: **New > Blueprint**, connect this GitHub repo
   (`Azya420/AXI`), branch `main` (or whichever branch you deploy from).
   Render will detect `render.yaml` and create the `axi-preview-generator`
   web service with its root directory set to `server/`.
2. Once created, open the service's **Environment** tab and set
   `OPENAI_API_KEY` (marked `sync: false` in the blueprint, so Render will
   prompt for it rather than storing a default).
3. Confirm `ALLOWED_ORIGINS` matches the real site origin(s) that will call
   this API (defaults to `https://axi3d.pl,https://www.axi3d.pl`).
4. Deploy. Render will run `npm install` then `npm start`, and poll
   `/health` to confirm the service is up.

If you'd rather set the service up manually instead of via the Blueprint:
Root Directory = `server`, Build Command = `npm install`,
Start Command = `npm start`, Health Check Path = `/health`.

## Prompt

The style prompt lives in `src/prompt.js` (`PREVIEW_STYLE_PROMPT`) and is
meant to be iterated on - it is a first draft, not tuned yet. Compare
generations against `lewmodelpog.png` in the repo root, which is a reference
photo of AXI's actual "model poglądowy" (preview model) style: unpainted grey
resin, studio-lit, on a round textured base.

## Cost controls

- **`IMAGE_QUALITY`** (default `low`) - by far the biggest lever. gpt-image-1
  pricing scales steeply with quality; `low` is roughly an order of magnitude
  cheaper than `high`. Keep it on `low`/`medium` while iterating on the
  prompt, only raise it once the style is finalized.
- **`IMAGE_SIZE`** (default `1024x1024`) - square is the cheapest option.
- **`PREVIEW_RATE_LIMIT`** (default 15) - max `/api/preview` calls per IP per
  hour, since each call costs money regardless of quality setting.
- Also set a hard spending limit in your OpenAI account (platform.openai.com
  → Settings → Billing → Limits) as a hard backstop independent of this
  service's own controls.

## Not yet wired into the site

The public site (`index.html`) does not call this service yet. This is
backend-only groundwork - frontend integration (upload UI in the hero
section) comes after the prompt/style has been validated with real API
calls.
