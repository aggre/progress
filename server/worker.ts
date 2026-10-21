import { authenticate } from './auth';
import { validateEvent, type ScheduleEvent } from '../src/lib/events';
type RuntimeEnv = Omit<Env, 'LOCAL_DEV'> & { LOCAL_DEV?: string; ASSETS: Fetcher };
interface Row { id:string; title:string; emoji:string; color:string; start_at:string; target_at:string; repeat_unit:ScheduleEvent['repeatUnit']; repeat_every:number; time_zone:string; created_at:string; updated_at:string }
const mapRow = (r: Row): ScheduleEvent => ({ id:r.id,title:r.title,emoji:r.emoji,color:r.color,startAt:r.start_at,targetAt:r.target_at,repeatUnit:r.repeat_unit,repeatEvery:r.repeat_every,timeZone:r.time_zone,createdAt:r.created_at,updatedAt:r.updated_at });
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } }); }
async function body(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('Expected JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('An event is required.');
  let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 8192) { await reader.cancel(); throw new Error('The event is too large.'); } chunks.push(part.value); }
  const data = new Uint8Array(bytes); let offset = 0; for (const c of chunks) { data.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder().decode(data)); } catch { throw new Error('Invalid JSON.'); }
}
export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    const local = env.LOCAL_DEV === 'true' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    const owner = local ? env.ALLOWED_EMAIL : await authenticate(request, env);
    if (!owner) return json({ error: 'Please sign in with your authorized email.' }, 401);
    try {
      let response: Response;
      if (url.pathname.startsWith('/api/')) response = await api(request, env, owner, url);
      else response = await env.ASSETS.fetch(request);
      const secure = new Response(response.body, response);
      secure.headers.set('Cache-Control','private, no-store');
      secure.headers.set('X-Content-Type-Options','nosniff');
      secure.headers.set('Referrer-Policy','same-origin');
      secure.headers.set('X-Frame-Options','DENY');
      secure.headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${__CSP_SCRIPT_HASHES__}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
      return secure;
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, type: error instanceof Error ? error.name : 'UnknownError' }));
      return json({ error:'Something went wrong. Please try again.' }, 500);
    }
  }
} satisfies ExportedHandler<RuntimeEnv>;
async function api(request: Request, env: RuntimeEnv, owner: string, url: URL): Promise<Response> {
  if (url.pathname === '/api/me' && request.method === 'GET') return json({ email: owner });
  const match = url.pathname.match(/^\/api\/events(?:\/([a-f0-9-]{36}))?$/);
  if (!match) return json({error:'Not found.'},404);
  const id = match[1];
  if (request.method === 'GET' && !id) {
    const { results } = await env.DB.prepare('SELECT * FROM events WHERE owner = ? ORDER BY created_at, id LIMIT 501').bind(owner).all<Row>();
    return json({ events: results.map(mapRow) });
  }
  if (!['POST','PUT','DELETE'].includes(request.method) || (request.method === 'POST' ? !!id : !id)) return json({error:'Method not allowed.'},405);
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({error:'Request origin not allowed.'},403);
  if (request.method === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM events WHERE id = ? AND owner = ?').bind(id,owner).run();
    return r.meta.changes ? json({ok:true}) : json({error:'This event no longer exists.'},404);
  }
  let input;
  try { input = validateEvent(await body(request)); } catch(error) { return json({error:error instanceof Error ? error.message : 'Invalid event.'},400); }
  const stamp = new Date().toISOString();
  const eventId = id || crypto.randomUUID();
  const values = [input.title,input.emoji,input.color,input.startAt,input.targetAt,input.repeatUnit,input.repeatEvery,input.timeZone];
  if (id) {
    const r = await env.DB.prepare('UPDATE events SET title=?,emoji=?,color=?,start_at=?,target_at=?,repeat_unit=?,repeat_every=?,time_zone=?,updated_at=? WHERE id=? AND owner=?').bind(...values,stamp,id,owner).run();
    if (!r.meta.changes) return json({error:'This event no longer exists.'},404);
  } else {
    // The cap is enforced in the same SQL statement as the insert.
    const r = await env.DB.prepare('INSERT INTO events (id,owner,title,emoji,color,start_at,target_at,repeat_unit,repeat_every,time_zone,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM events WHERE owner=?) < 500').bind(eventId,owner,...values,stamp,stamp,owner).run();
    if (!r.meta.changes) return json({error:'You have reached the limit of 500 events.'},409);
  }
  const row = await env.DB.prepare('SELECT * FROM events WHERE id=? AND owner=?').bind(eventId,owner).first<Row>();
  return json({event:row ? mapRow(row) : null},id ? 200 : 201);
}
