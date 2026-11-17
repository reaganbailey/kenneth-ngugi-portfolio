# Deploying to Cloudflare Workers

## One-time setup

1. Install the adapter and Wrangler (this also regenerates `package-lock.json`):
   ```bash
   npm install -D @opennextjs/cloudflare@latest wrangler@latest
   ```
2. Log in and create the ISR cache bucket:
   ```bash
   npx wrangler login
   npx wrangler r2 bucket create kenneth-portfolio-cache
   ```
3. Put the Google values in `.env.local` (needed for the build, which reads the Sheet), then deploy once:
   ```bash
   npm run deploy
   ```
4. Add the same values as runtime secrets on the Worker:
   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
   npx wrangler secret put GOOGLE_PRIVATE_KEY
   npx wrangler secret put GOOGLE_SHEET_ID
   ```
5. In GitHub → Settings → Secrets → Actions, add:
   `CLOUDFLARE_API_TOKEN` (Workers Edit + R2 Edit permissions), `CLOUDFLARE_ACCOUNT_ID`,
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`.
6. Commit the regenerated `package-lock.json`. Pushes to `main` now deploy.

## Local

- `npm run dev` – normal Next dev server (put the Google vars in `.env.local`).
- `npm run preview` – builds and runs in the real Workers runtime (put vars in `.dev.vars`).

## Custom domain (ngugi.co.ke)

Add the domain to Cloudflare, uncomment `routes` in `wrangler.jsonc`, redeploy, then
remove the domain from Vercel.

## Rollback

Vercel keeps working untouched until you switch DNS. Switch DNS back to roll back.
