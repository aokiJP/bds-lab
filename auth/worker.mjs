// auth/worker.mjs: the sign-in service as a Cloudflare Worker (wrangler.toml). Its env is the Worker's own: GITHUB_CLIENT_ID
// and PANEL_ORIGINS as vars, GITHUB_CLIENT_SECRET and STATE_SECRET as secrets (README.md).
import { handler } from './handler.mjs';

export default { fetch: (req, env) => handler(env)(req) };
