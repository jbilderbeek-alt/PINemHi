// Cloudflare Worker for the PINemHi webapp. It does two things:
//   1. ?page=home.php                      -> live copy of a PINemHi page (home, weekly, 5 min, PIN)
//   2. ?game=..&user=..&top=10&multi=yes   -> the hi-scores of one player on one machine (Top 5)
// It only talks to pinemhi.com and only answers requests from your own site.

const SITE = 'https://www.pinemhi.com/';
const RESULT_URL = 'https://pinemhi.com/hiscores_result.php';
const ALLOWED_ORIGIN = 'https://jbilderbeek-alt.github.io';   // <- your GitHub Pages site (no path)
const PAGES = ['home.php', 'week_challenge.php', 'week_challenge_5min.php', 'week_challenge_golf.php'];

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Vary': 'Origin',
};
const UA = 'Mozilla/5.0 (compatible; PINemHi-App)';

function reply(text, status) {
  return new Response(text, { status, headers: CORS });
}

// Fetch from pinemhi.com, keep the bytes and the character set as they are, cache for a short time
async function cached(request, ctx, key, ttl, makeUpstream) {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.invalid/' + encodeURIComponent(key));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await makeUpstream();
  if (!upstream.ok) return reply('upstream error', 502);

  const response = new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl}`,
      ...CORS,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return reply('method not allowed', 405);

    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) return reply('forbidden', 403);

    const p = new URL(request.url).searchParams;

    // 1. A page of the site (cached for 60 seconds)
    const page = p.get('page');
    if (page) {
      if (!PAGES.includes(page)) return reply('bad request', 400);
      return cached(request, ctx, 'page|' + page, 60, () =>
        fetch(SITE + page, { headers: { 'User-Agent': UA } }));
    }

    // 2. Hi-scores of one player on one machine (cached for 5 minutes)
    const game = p.get('game') || '';
    const user = p.get('user') || '';
    const top = p.get('top') || '10';
    const multi = p.get('multi') === 'yes' ? 'yes' : 'no';
    if (!game || game.length > 120 || !user || user.length > 80 || !['10', '25', '100'].includes(top)) {
      return reply('bad request', 400);
    }
    return cached(request, ctx, ['scores', top, game, user, multi].join('|'), 300, () =>
      fetch(RESULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams({ top, game, user, multi }),
      }));
  },
};
