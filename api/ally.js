// Ally server function (D67). Holds the Anthropic API key and builds every prompt itself.
// The page sends only { step, args }: the step name and the product data. It can never send a prompt.
const PROMPTS = require('../lib/prompts.js');

const MODEL = 'claude-opus-5-5';
const MODEL_LABEL = 'Claude Opus 5.5';
const STEPS = new Set(['judge', 'factGaps', 'rewrite', 'traceFacts']);
const MAX_BODY = 200 * 1024;          // bytes of JSON per call
const MAX_TOKENS = 8000;              // longest reply we expect (the rewrite)

// Simple request limit. It is per running copy of the function, so it is a speed bump, not a guarantee;
// the spending limit on the Anthropic account is the real backstop (see README).
const WINDOW_MS = 10 * 60 * 1000, PER_IP = 40, PER_INSTANCE = 300;
const hits = new Map(); let all = [];
function limited(ip) {
  const now = Date.now();
  all = all.filter(t => now - t < WINDOW_MS);
  const mine = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (mine.length >= PER_IP || all.length >= PER_INSTANCE) return true;
  mine.push(now); all.push(now); hits.set(ip, mine);
  return false;
}

// Shape and size checks: only product data of the expected shape gets through
const str = (v, n) => typeof v === 'string' && v.length <= n;
const listing = l => l && typeof l === 'object' && str(l.sku_id, 100) && str(l.brand || '', 200) && str(l.category || '', 200) && str(l.title || '', 1000) &&
  Array.isArray(l.bullets) && l.bullets.length <= 5 && l.bullets.every(b => str(b, 1500)) && str(l.description || '', 6000);
const strList = (a, n, len) => Array.isArray(a) && a.length <= n && a.every(x => str(x, len));
function valid(step, args) {
  if (!Array.isArray(args)) return false;
  if (step === 'judge') return args.length === 2 && Array.isArray(args[0]) && args[0].length >= 1 && args[0].length <= 11 && args[0].every(listing) && str(args[1], 100);
  if (step === 'factGaps') return args.length === 2 && listing(args[0]) && Array.isArray(args[1]) && args[1].length <= 10 && args[1].every(listing);
  if (step === 'rewrite') {
    const c = args[1];
    return args.length === 2 && listing(args[0]) && c && typeof c === 'object' && strList(c.otherBrands, 30, 200) && strList(c.issues, 80, 1500) &&
      Array.isArray(c.contradictions) && c.contradictions.length <= 10 && c.contradictions.every(x => x && str(x.quote_a, 1000) && str(x.quote_b, 1000)) &&
      Array.isArray(c.gaps) && c.gaps.length <= 30 && c.gaps.every(g => g && str(g.attribute, 200)) && strList(c.feedback || [], 60, 2000);
  }
  if (step === 'traceFacts') { const r = args[1]; return args.length === 2 && listing(args[0]) && r && str(r.title || '', 1000) && strList(r.bullets || [], 5, 1500) && str(r.description || '', 6000); }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'method' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ code: 'unavailable' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ code: 'rate_limited' });

  let body = req.body;
  if (typeof body === 'string') { if (body.length > MAX_BODY) return res.status(413).json({ code: 'too_large' }); try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ code: 'bad_request' }); } }
  if (!body || JSON.stringify(body).length > MAX_BODY) return res.status(413).json({ code: 'too_large' });
  const { step, args } = body;
  if (!STEPS.has(step) || !valid(step, args)) return res.status(400).json({ code: 'bad_request' });

  const prompt = PROMPTS[step](...args);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] })
    });
  } catch (e) { return res.status(502).json({ code: 'network' }); }
  if (r.status === 429) return res.status(429).json({ code: 'rate_limited' });
  if (!r.ok) { console.error('Anthropic error', r.status, await r.text().catch(() => '')); return res.status(502).json({ code: 'upstream' }); }
  const msg = await r.json();
  const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = PROMPTS.parseJson(text); } catch (e) { return res.status(502).json({ code: 'invalid_json' }); }
  return res.status(200).json({ data, model: msg.model === MODEL ? MODEL_LABEL : (msg.model || 'unknown') });
};
