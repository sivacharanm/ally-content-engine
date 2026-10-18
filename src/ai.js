// ===================== AI COMPONENT (D7) =====================
// The only part of the page that talks to a model.
// Preview: prompts are built in the page and sent through the viewer's Claude account (sample).
// Hosted (D67): the page sends the step name and the data to /api/ally; the server builds the prompt.

const AI = (() => {
  const HOSTED = typeof ALLY_HOSTED !== 'undefined' && ALLY_HOSTED;
  const MODEL = 'claude-opus-5-5';
  const MODEL_LABEL = 'Claude Opus 5.5';
  let samplePromise = null, ctrl = null;
  function getSample() {
    if (!samplePromise) samplePromise = (window.claude && window.claude.use) ? window.claude.use('sample') : Promise.resolve(null);
    return samplePromise;
  }
  async function available() { return HOSTED ? true : !!(await getSample()); }

  // Only the fields the prompts use are sent
  const L = l => ({ sku_id: l.sku_id, brand: l.brand, category: l.category, title: l.title, bullets: l.bullets || [], description: l.description });
  const tag = (data, used) => { if (data && typeof data === 'object') Object.defineProperty(data, '_model', { value: used, enumerable: false }); return data; };

  async function run(step, args) {
    if (HOSTED) {
      ctrl = new AbortController();
      let r;
      try { r = await fetch('/api/ally', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step, args }), signal: ctrl.signal }); }
      catch (e) { throw { code: e && e.name === 'AbortError' ? 'aborted' : 'network' }; }
      let j = null; try { j = await r.json(); } catch (e) {}
      if (!r.ok || !j) throw { code: (j && j.code) || (r.status === 429 ? 'rate_limited' : 'error') };
      return tag(j.data, j.model || 'unknown');
    }
    const sample = await getSample();
    if (!sample) throw { code: 'unavailable' };
    const res = await sample(PROMPTS[step](...args), { model: MODEL, modelTier: 'complex' });
    const data = PROMPTS.parseJson(res.text);
    return tag(data, res.modelApplied === MODEL ? MODEL_LABEL : 'fallback: ' + (res.modelTierApplied || 'unknown') + ' tier (' + MODEL_LABEL + ' unavailable)');
  }

  return {
    available, MODEL_LABEL,
    abort: () => { if (ctrl) ctrl.abort(); },
    judge: (listings, clientId) => run('judge', [listings.map(L), clientId]),
    factGaps: (client, pool) => run('factGaps', [L(client), pool.map(L)]),
    rewrite: (client, ctx) => run('rewrite', [L(client), { otherBrands: ctx.otherBrands || [], issues: ctx.issues || [], contradictions: (ctx.contradictions || []).map(c => ({ quote_a: c.quote_a, quote_b: c.quote_b })), gaps: (ctx.gaps || []).map(g => ({ attribute: g.attribute })), feedback: ctx.feedback || [] }]),
    traceFacts: (client, rw) => run('traceFacts', [L(client), { title: rw.title, bullets: rw.bullets || [], description: rw.description }])
  };
})();
// =================== END AI COMPONENT ===================
