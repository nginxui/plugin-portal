# Nginx UI Developer Center

The portal at `portal.nginxui.com` where authors submit and manage their
catalog listings and maintainers review them. The catalog itself stays in
[`nginxui/plugins`](https://github.com/nginxui/plugins); the portal keeps
workflow state only.

- `web/`: the interface (Vue 3, antdv-next, UnoCSS, vue-router, Pinia)
- `worker/`: the API under `/api` (Hono on Cloudflare Workers)
- `migrations/`: the D1 schema
- `test/`: Worker tests, run inside workerd

## Development

```bash
bun install
cp .dev.vars.example .dev.vars   # fill in the values
bun run db:migrate:local
bun run dev
```

Sign in uses the GitHub App NGINX UI Plugin Portal, whose callback URLs are
`https://portal.nginxui.com/api/auth/callback` and
`http://localhost:5173/api/auth/callback`. Put its client secret in
`.dev.vars` for local work. Its logo is `assets/github-app.png` with the
badge background color `#ffffff`.

```bash
bun run test
bun run typecheck
bun run lint
bun run gettext:extract   # refresh web/src/language after changing strings
```

## Deployment

One Worker serves both the interface (static assets) and the API, on the
custom domain `portal.nginxui.com`; `portal-staging.nginxui.com` runs the
same code against the test catalog `nginxui/plugins-staging` (the `staging`
environment of `wrangler.jsonc`).

CI (`.github/workflows/ci.yml`) lints, type checks, tests and builds every
change. A push to main then applies the D1 migrations and deploys staging;
production deploys only when the workflow is run by hand with target
`production`. Each GitHub environment, `staging` and `production`, needs
`CLOUDFLARE_API_TOKEN` with Workers, D1 and R2 edit on the account.

By hand:

```bash
bun run db:migrate:staging && bun run deploy:staging
bun run db:migrate && bun run deploy
```

Worker secrets, set with `wrangler secret put <NAME>` (`--env staging` for
staging), are listed at the end of `wrangler.jsonc`: the Portal App client
secret, `SESSION_KEY` (`openssl rand -base64 32`) and the Deploy App key are
required; the bot account, AI key and mail service are optional, and the
maintainer Settings page can set the bot and the mail service too.

The marketplace previews draw the components Nginx UI uses, from
[`@nginxui/plugin-market-ui`](https://github.com/nginxui/plugin-market-ui).

## License

[AGPL-3.0](LICENSE)
