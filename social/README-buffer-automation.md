# Daily Buffer automation for RichXPay

This setup generates and queues 5 posts per day:

- 3 posts on X
- 2 posts on LinkedIn
- Topics rotate across:
  - cross-border payments
  - ad spend
  - AI subscriptions

## Daily publishing times

- 09:18 Asia/Shanghai
- 11:36 Asia/Shanghai
- 14:08 Asia/Shanghai
- 17:28 Asia/Shanghai
- 20:36 Asia/Shanghai

## Workflow

1. Fetch recent official signals from:
   - Google Pay RSS
   - Google Ads & Commerce RSS
   - OpenAI News RSS
2. Generate 5 posts with Gemini
3. Resolve connected X and LinkedIn channels from Buffer automatically
4. Queue all 5 posts in Buffer
5. Save daily generation artifacts back to the repo

## Required GitHub Secrets

- `GEMINI_API_KEY`
- `BUFFER_API_KEY`

## Optional GitHub Secrets

- `GEMINI_MODEL`
- `GEMINI_API_ENDPOINT`
- `BUFFER_GRAPHQL_ENDPOINT`

## Main files

- `.github/workflows/daily-buffer-automation.yml`
- `scripts/fetch-topic-signals.mjs`
- `scripts/generate-daily-buffer-posts.mjs`
- `scripts/queue-daily-buffer-posts.mjs`
- `scripts/list-buffer-profiles.mjs`
- `social/automation-config.json`
- `social/gemini-prompt.md`
- `social/buffer-automation-state.json`

## SEO/GEO automation

The static site also has a separate quality and discovery pipeline:

- `seo/site-facts.json` is the reviewed source of truth for brand, product, audience, and safety claims.
- `scripts/generate-seo-assets.mjs` generates `sitemap.xml` and the AI-readable `llms.txt` manifest.
- `scripts/seo-audit.mjs` checks every landing page for core SEO metadata, JSON-LD validity, sitemap coverage, and GEO manifest coverage.
- `.github/workflows/seo-geo.yml` runs the audit on relevant pull requests and pushes, then runs Lighthouse CI.
- `.github/workflows/generate-seo-assets.yml` refreshes derived assets weekly or on demand and commits only generated changes.
- `.github/workflows/weekly-seo-content-brief.yml` creates a reviewable weekly content brief from current topic signals; it does not publish claims automatically.

Content claims about fees, limits, availability, merchant acceptance, compliance, and payment rails should be reviewed in `seo/site-facts.json` before publishing. The workflow intentionally does not auto-publish AI-generated financial claims.
