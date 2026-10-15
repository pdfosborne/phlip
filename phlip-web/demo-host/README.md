# Phlip local demo host

Cloudflare Worker that serves [`../public`](../public) at **https://demo.phlipapp.com/**.

Cloudflare does not allow Workers with static assets on a path like `phlipapp.com/demo*`. The demo therefore uses its own hostname (`demo.phlipapp.com/*`). Obsidian Publish keeps `phlipapp.com` itself.

## Deploy

GitHub Action [`.github/workflows/publish-demo.yml`](../../.github/workflows/publish-demo.yml) deploys on push to `main` when `phlip-web/public/**` or this folder changes.

Required GitHub Actions secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — an account API token limited to this deploy:
  - **Workers Editor** for all Workers (legacy name: Workers Scripts Edit). **Admin** is only needed to create a Worker that does not exist yet.
  - **Zone → Workers Routes → Edit** and **Zone → DNS → Edit**, both limited to the `phlipapp.com` zone.
  - Do not grant Containers, R2, KV, Pages, Agents, Builds, Observability, or Tail.
- `CLOUDFLARE_ACCOUNT_ID` — the account ID from the Cloudflare dashboard sidebar (the hex string in `dash.cloudflare.com/<account-id>/`).

Create the token from the account’s API tokens page, not a user-profile token. After secrets exist, push to `main` or re-run **Publish demo**. The Worker `phlip-demo` serves `https://demo.phlipapp.com/`.

Local preview:

```bash
python3 -m http.server 8765 --directory phlip-web/public
```

Then open `http://127.0.0.1:8765/?demo=1`.
