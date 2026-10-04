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
custom domain `portal.nginxui.com`.

1. `wrangler d1 create portal` and put the id into `wrangler.jsonc`.
2. `wrangler d1 migrations apply portal --remote`
3. Set the secrets:
   `wrangler secret put GITHUB_CLIENT_SECRET` and
   `wrangler secret put SESSION_KEY` (`openssl rand -base64 32`).
4. `bun run deploy`

## License

[AGPL-3.0](LICENSE)
