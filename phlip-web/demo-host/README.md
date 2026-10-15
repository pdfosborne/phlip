# Phlip local demo host

Cloudflare Worker that serves [`../public`](../public) at **https://demo.phlipapp.com/**.

Cloudflare does not allow Workers with static assets on a path like `phlipapp.com/demo*`. The demo therefore uses its own hostname (`demo.phlipapp.com/*`). Obsidian Publish keeps `phlipapp.com` itself.

## Deploy

GitHub Action [`.github/workflows/publish-demo.yml`](../../.github/workflows/publish-demo.yml) deploys on push to `main` when `phlip-web/public/**` or this folder changes.

Required GitHub Actions secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — API token with **Account / Workers Scripts / Edit**, **Zone / Workers Routes / Edit**, and **Zone / DNS / Edit** on `phlipapp.com` (DNS is needed so Wrangler can create the `demo` Custom Domain)
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard sidebar

Create the token at https://dash.cloudflare.com/profile/api-tokens (template **Edit Cloudflare Workers**, then add **Zone / DNS / Edit**). After secrets exist, push to `main` or re-run **Publish demo**. The first successful deploy creates the Worker and attaches `https://demo.phlipapp.com/`.

Local preview:

```bash
python3 -m http.server 8765 --directory phlip-web/public
```

Then open `http://127.0.0.1:8765/?demo=1`.
