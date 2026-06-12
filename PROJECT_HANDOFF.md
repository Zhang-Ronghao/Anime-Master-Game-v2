# Project Handoff

Current architecture:

- Frontend: React UI built by Vite and deployed to Cloudflare Pages from `pages-dist`
- Backend: Cloudflare Worker RPC and WebSocket endpoints
- Realtime: Durable Object topics, with room actions sent over WebSocket first
- Persistence: Cloudflare D1

Key files:

- `src/lib/cloudflareRooms.ts`: frontend room/question/game access layer.
- `src/lib/cloudflareClient.ts`: HTTP RPC, WebSocket action ack, fallback, and topic subscriptions.
- `src/main.tsx`, `src/App.tsx`, `src/lib/router.ts`: static Pages entry and browser router for the existing page UI.
- `worker/index.ts`: Worker routes, Durable Object WebSocket handling, broadcasts, and action ack.
- `GET /api/cloudinary-images`: Worker-hosted Cloudinary listing endpoint; no Next API route remains.
- `worker/gameService.ts`: migrated game state transition logic running inside the Worker.
- `worker/d1QueryCompat.ts`: D1 query compatibility layer for the migrated service logic.
- `d1/migrations/0001_initial.sql`: D1 schema.
- `wrangler.toml`: Worker, Durable Object, and D1 binding config.

Verification:

```bash
npm run lint
npm run worker:typecheck
npm run build
npx wrangler deploy --dry-run
```

Deployment checklist:

1. `npx wrangler d1 create anime_master_game`
2. Put the generated `database_id` into `wrangler.toml`
3. `npm run d1:migrate:remote`
4. `npm run worker:deploy`
5. Set `NEXT_PUBLIC_API_BASE_URL=<Worker URL>` in Cloudflare Pages
6. Deploy the frontend build output directory `pages-dist`
