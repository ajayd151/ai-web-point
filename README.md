# Ai Web Point — Lead Finder + AI Website Mockups

Find local businesses (by industry + location) filtered by website / phone / email /
ratings, then generate a **real AI website-mockup image** for any of them — ready to
embed in a cold email, with a shareable "view online" page that has a brand-coloured
**Request a demo** button.

- **Finder**: runs in the browser (currently demo data; Google Places plugs in later).
- **Generator**: a Vercel serverless function that calls **OpenAI gpt-image-1** for the
  photographic hero, composites the real business name / phone / services / CTA crisply
  on top (so text is always correct), flattens to **one PNG**, and stores it publicly
  (Vercel Blob). Returns an image URL + a view-page URL.

## Live deploy (Vercel)

1. Push this repo to GitHub.
2. Go to **vercel.com → Add New → Project**, sign in with GitHub, import the repo.
3. In the project, open **Storage → Create → Blob** (this auto-adds `BLOB_READ_WRITE_TOKEN`).
4. Open **Settings → Environment Variables** and add:
   - `OPENAI_API_KEY` = your key from platform.openai.com
   - `DEMO_URL` (optional) = where the "Request a demo" button links (your booking page or `mailto:`)
   - `OPENAI_IMAGE_QUALITY` (optional) = `low` | `medium` | `high` (default `medium`)
5. **Deploy**. You'll get a URL like `your-app.vercel.app`.

## How it's used

1. Search an industry + location, apply filters.
2. Click **Generate website mockup** on a business → add any extra notes → **Proceed**.
3. ~15–25s later you get the PNG, a **copyable image URL** (drop into an email as an
   image), a **view-page link**, and a **Download PNG** button.

## Cost

gpt-image-1 ≈ 4–8p per image (your OpenAI account). Vercel free tier covers hosting.

## Project layout

```
api/generate.js     Vercel function: OpenAI image → composite branding → Blob → URLs
public/             Frontend (index.html, styles.css, data.js, app.js)
fonts/              Montserrat weights bundled for server-side text rendering
vercel.json         Function config (memory, timeout, bundles fonts/)
```

## Brand

Colours `#4375ED` + `#C485B1`, agency name "Ai Web Point". Logo currently drawn in code;
drop a real logo PNG in and wire it into `api/generate.js` to swap it.

## Roadmap

- Real business data via Google Places (replace `public/data.js` `generateBusinesses`).
- Email-address enrichment (best-effort scraping).
- Saved campaigns / CSV export of leads.
