// The deployed backend: static assets for everything except /api/scores, which
// reads and writes the persistent leaderboard in D1. The client treats this API
// as optional — plain `vite dev` has no /api routes and the game falls back to
// its in-memory board — so this worker only exists in `wrangler dev` and prod.

// Binding names come from wrangler.jsonc (the D1 one was auto-added by
// `wrangler d1 create`, hence the snake_case).
interface Env {
  starvoid_leaderboard: D1Database
  ASSETS: Fetcher
}

const TOP_N = 10
const MAX_NAME = 12
/** Sanity cap (seconds) — no legitimate run survives a full day. */
const MAX_TIME = 86400

/** Mirror of the client-side name cleanup, so a raw POST can't bypass it. */
function sanitizeName(raw: unknown): string {
  const n = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''
  return n ? n.toUpperCase() : 'PILOT'
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/scores') {
      if (request.method === 'GET') {
        const { results } = await env.starvoid_leaderboard.prepare(
          'SELECT name, time FROM scores ORDER BY time DESC, created_at ASC LIMIT ?',
        )
          .bind(TOP_N)
          .all()
        return json(results)
      }
      if (request.method === 'POST') {
        let body: { name?: unknown; time?: unknown }
        try {
          body = await request.json()
        } catch {
          return json({ error: 'invalid JSON' }, 400)
        }
        const time = Number(body.time)
        if (!Number.isFinite(time) || time <= 0 || time > MAX_TIME) {
          return json({ error: 'invalid time' }, 400)
        }
        await env.starvoid_leaderboard.prepare('INSERT INTO scores (name, time) VALUES (?, ?)')
          .bind(sanitizeName(body.name), time)
          .run()
        return json({ ok: true }, 201)
      }
      return json({ error: 'method not allowed' }, 405)
    }
    return env.ASSETS.fetch(request)
  },
}
