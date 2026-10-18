// ===================== APP: runs the pipeline and draws the page =====================
const $ = s => document.querySelector(s);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Four milestones shown to the brand manager; the ten pipeline steps are unchanged underneath.
// Analysis = steps 3 to 7, Recommendation generation = step 8, Validations = step 9. Finishing fills all three.
const MILESTONES = ['Analysis', 'Recommendation generation', 'Validations'];

let CATALOG = null, CATALOG_NAME = '', CATALOG_RETAILER = '', TEST_NOTES = new Map(), BRAND_MASK = [];
// Competitor brands are never shown to the brand manager: each gets a fixed label (Brand 1, Brand 2, ...).
function buildBrandMask() {
  const seen = new Map();
  [...CATALOG.skus.values()].filter(r => !r.skippedReason && !r.is_client && r.brand).forEach(r => { const k = r.brand.toLowerCase(); if (!seen.has(k)) seen.set(k, r.brand); });
  BRAND_MASK = [...seen.values()].map((b, i) => ({ brand: b, label: 'Brand ' + (i + 1), rx: new RegExp('(?<![A-Za-z0-9])' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi') }))
    .sort((a, b) => b.brand.length - a.brand.length);
}
function maskText(t, keep) {
  let out = t;
  for (const m of BRAND_MASK) { if (keep && m.brand.toLowerCase() === keep.toLowerCase()) continue; out = out.replace(m.rx, m.label); }
  return out;
}
function maskDom(root, keep) {
  if (!BRAND_MASK.length || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(n => { const v = maskText(n.nodeValue, keep); if (v !== n.nodeValue) n.nodeValue = v; });
}
// ---------- File library (D62 to D66): preloaded files plus uploads kept in this browser ----------
const LIMITS = { bytes: 1024 * 1024, rows: 500 };   // A20
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
let UPLOADS = LS.get('ally.uploads') || [];
let ACTIVE = LS.get('ally.active') || 'pre-0';
function library() {
  return [...CATALOGS.map((c, i) => ({ id: 'pre-' + i, label: c.label, file: c.file, retailer: i === 0 ? 'Amazon' : 'test' + i, csv: c.csv, preloaded: true })), ...UPLOADS];
}
function activeEntry() { const lib = library(); return lib.find(x => x.id === ACTIVE) || lib[0]; }
function setActive(id) { ACTIVE = id; LS.set('ally.active', id); useCatalog(); }

function useCatalog() {
  const c = activeEntry();
  ACTIVE = c.id;
  CATALOG = loadCatalog(c.csv); CATALOG_NAME = c.file; CATALOG_RETAILER = c.retailer; TEST_NOTES = new Map();   // steps 1 and 2: once per file
  BRAND_MASK = []; if (!CATALOG.blocked) buildBrandMask();
  try {
    const rows = parseCSV(c.csv); const hd = (rows[0] || []).map(x => x.trim().toLowerCase());
    const ti = hd.indexOf('test_note'), si = hd.indexOf('sku_id');
    if (ti >= 0) rows.slice(1).forEach((r, n) => TEST_NOTES.set(r[si] ? r[si].trim().toUpperCase() : 'ROW ' + (n + 2), r[ti] || ''));
  } catch (e) {}
  runId++; AI.abort(); S = null; $('#err').textContent = ''; $('#go').disabled = false;
  const first = CATALOG.blocked ? null : [...CATALOG.skus.values()].find(r => !r.skippedReason && r.is_client);
  $('#sku').value = first ? first.sku_id : '';
  drawCatalog(); drawProgress(); drawResults(); drawAdmin();
}
let S = null; // state of the current run
let runId = 0;

// ---------- Progress: milestone bar plus one status line ----------
function setStatus(ms, line, state) {
  if (!S) return;
  S.ms = ms; S.line = line; S.msState = state || 'running';
  drawProgress();
}
function drawProgress() {
  const el = $('#progress');
  el.hidden = !S;
  if (!S) return;
  el.innerHTML = '<ol class="pbar" aria-label="Progress">' + MILESTONES.map((name, i) => {
    let st = 'waiting';
    if (i < S.ms || (i === S.ms && S.msState === 'done')) st = 'done';
    else if (i === S.ms) st = S.msState === 'failed' ? 'failed' : 'active';
    return '<li class="ms ms-' + st + '"><span class="track"></span><span class="ms-name">' + h(name) + '</span></li>';
  }).join('') + '</ol>' +
    '<div class="status-row"><p class="status-line st-' + h(S.msState) + '" role="status">' + (S.msState === 'running' ? '<span class="spin" aria-hidden="true"></span>' : '') + h(S.line) + '</p>' + (S.msState === 'running' ? '<button type="button" id="stop" class="stop">Stop</button>' : '') + '</div>' +
    (S.note ? '<p class="muted small">' + h(S.note) + '</p>' : '');
}

function drawCatalog() {
  // Catalog panel removed for the brand manager (catalog checks are covered in the demo and README).
  // A file that cannot be loaded still shows its error, so the page is never silently empty.
  const c = CATALOG;
  const el = $('#catalog');
  el.innerHTML = c.blocked ? '<div class="note bad"><span>We couldn\u2019t load your product data. Please check the file and try again.</span></div>' : '';
  $('#retailer').innerHTML = 'Retailer: <b>' + h(CATALOG_RETAILER) + '</b>';
}

// ---------- Admin view (D62 to D66) ----------
function catalogCheckHtml() {
  const c = CATALOG;
  if (c.blocked) return '<div class="note bad"><span class="code">V1–V2</span><span><b>File not loaded.</b> ' + h(c.blocked) + '</span></div>';
  const all = [...c.skus.values()].filter(r => !r.skippedReason);
  const clients = all.filter(r => r.is_client);
  let out = '<div class="cat-line"><span class="mono">' + h(CATALOG_NAME) + '</span><span>' + c.rowCount + ' rows checked</span><span>' + clients.length + ' client SKUs</span><span>' +
    (all.length - clients.length) + ' competitors</span><span>' + c.skipped.length + ' rows skipped</span><span>' + c.fixes.length + ' data fixes</span><span>Rules: Amazon guidelines</span></div>' +
    c.warnings.map(w => '<div class="note warn"><span class="code">' + h(w.code === 'SKIP' ? 'V5–V8' : w.code) + '</span>' + h(w.text) + '</div>').join('') +
    (c.skipped.length ? '<details class="fixes"><summary>' + c.skipped.length + ' rows skipped</summary><ul>' + c.skipped.map(x => '<li>' + h(x.label) + ': ' + h(x.reason) + '</li>').join('') + '</ul></details>' : '') +
    (c.fixes.length ? '<details class="fixes"><summary>' + c.fixes.length + ' data fixes applied</summary><ul>' + c.fixes.map(f => '<li><span class="code">' + h(f.code) + '</span> ' + h(f.text) + '</li>').join('') + '</ul></details>' : '') +
    '<p class="muted small">Client SKUs: ' + clients.map(r => '<span class="mono">' + h(r.sku_id) + '</span>').join(', ') + '</p>';
  if (TEST_NOTES.size) out += '<details class="fixes"><summary>' + TEST_NOTES.size + ' test cases in this file</summary><div class="tbl-wrap" style="margin-top:8px"><table class="audit cases"><thead><tr><th>SKU or row</th><th>What it tests and the expected result</th></tr></thead><tbody>' + [...TEST_NOTES].map(([k, v]) => '<tr><td class="mono">' + h(k) + '</td><td>' + h(v) + '</td></tr>').join('') + '</tbody></table></div></details>';
  return out;
}
function drawAdmin() {
  const el = $('#admin'); if (!el) return;
  const rows = library().map(x => {
    let st; try { const c = loadCatalog(x.csv); st = c.blocked ? '<span class="chip-s bad">Cannot be loaded</span>' : c.rowCount + ' rows'; } catch (e) { st = '<span class="chip-s bad">Cannot be loaded</span>'; }
    return '<tr' + (x.id === ACTIVE ? ' class="is-active"' : '') + '><td><input type="radio" name="active" value="' + h(x.id) + '" aria-label="Make active: ' + h(x.label) + '"' + (x.id === ACTIVE ? ' checked' : '') + '></td><td>' + h(x.label) + (x.preloaded ? '' : ' <span class="muted small">(uploaded)</span>') + '</td><td>' + h(x.retailer) + '</td><td>' + st + '</td><td>' + (x.preloaded ? '' : '<button type="button" class="link-btn" data-remove="' + h(x.id) + '">Remove</button>') + '</td></tr>';
  }).join('');
  el.innerHTML = '<section class="block"><h2 class="sec-h">Product data files</h2><p class="muted">Each file holds one retailer\u2019s catalog. The brand manager page uses the active file. Uploaded files stay in this browser only.</p>' +
    '<div class="tbl-wrap"><table class="audit lib"><thead><tr><th>Active</th><th>File</th><th>Retailer</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<form id="up" class="up" autocomplete="off"><h3>Upload a file</h3><div class="up-row"><label>Retailer name<input id="up-ret" maxlength="60" placeholder="For example, Amazon"></label><label>CSV file<input id="up-file" type="file" accept=".csv,text/csv"></label><button type="submit" class="btn2">Add file</button></div><p class="muted small">CSV only, up to 1 MB and 500 rows, with the same columns as the provided file. The rules applied are the Amazon guidelines, whatever the retailer name.</p><p id="up-err" role="alert"></p></form></section>' +
    '<section class="block"><h2 class="sec-h">Catalog check: active file</h2>' + catalogCheckHtml() + '</section>'
  if (typeof ALLY_VIEW !== 'undefined') el.innerHTML += '<p><a href="/">Open the brand manager page</a> (same browser) to analyse a SKU from the active file.</p>';
}
async function addUpload() {
  const err = m => { $('#up-err').textContent = m; };
  const ret = $('#up-ret').value.trim(), f = $('#up-file').files[0];
  if (!ret) return err('Enter the retailer name.');
  if (!f) return err('Choose a CSV file.');
  if (!/\.csv$/i.test(f.name)) return err('Only CSV files can be uploaded.');
  if (f.size > LIMITS.bytes) return err('This file is larger than 1 MB.');
  const text = await f.text();
  let n = 0; try { n = parseCSV(text).filter(r => r.some(c => String(c).trim())).length - 1; } catch (e) {}
  if (n > LIMITS.rows) return err('This file has more than 500 rows.');
  const entry = { id: 'up-' + Date.now(), label: f.name, file: f.name, retailer: ret, csv: text };
  UPLOADS.push(entry);
  const saved = LS.set('ally.uploads', UPLOADS);
  setActive(entry.id);
  if (!saved) err('Added for this visit only: this browser did not allow the file to be stored.');
}

// Preview: two tabs on one page. Hosted: two URLs, one view each (D62).
let VIEW = typeof ALLY_VIEW !== 'undefined' ? ALLY_VIEW : (LS.get('ally.view') || 'brand');
function drawView() {
  $('#admin').hidden = VIEW !== 'admin'; $('#bm').hidden = VIEW !== 'brand';
  const t = $('#tabs');
  if (typeof ALLY_VIEW === 'undefined') { t.hidden = false; t.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === VIEW))); }
}

// ---------- Rendering helpers ----------
const STATUS_LABEL = { met: 'Met', not_met: 'Not met', na: 'Not applicable', unchecked: 'Cannot be checked', pending: 'Not run' };
function statusChip(a) {
  let cls = 'neutral';
  if (a.status === 'met') cls = 'good';
  else if (a.status === 'not_met') cls = (a.rule.strength === 'Limit' || a.rule.strength === 'Prohibition') ? 'bad' : 'warn';
  return '<span class="chip-s ' + cls + '">' + STATUS_LABEL[a.status] + '</span>';
}
function auditTable(audit) {
  return '<div class="tbl-wrap"><table class="audit"><thead><tr><th>Rule</th><th>What the guidelines say</th><th>Strength</th><th>Result</th><th>Evidence</th></tr></thead><tbody>' +
    audit.map(a => '<tr><td class="mono nowrap">' + h(a.rule.ref) + (a.byAi ? ' <span class="ai-tag" title="Judged by AI">AI</span>' : '') + '</td><td>' + h(a.rule.says) + '</td><td class="nowrap">' + h(a.rule.strength) + '</td><td class="nowrap">' + statusChip(a) + '</td><td class="ev">' + a.evidence.map(e => h(e)).join('<br>') + '</td></tr>').join('') +
    '</tbody></table></div>';
}
function summaryLine(sum) {
  return '<p class="summary ' + (sum.compliant ? 'ok' : 'no') + '"><span class="dot"></span>' + h(sum.text) + '</p>';
}
// Rule IDs are internal: not shown to the brand manager (D68)
const ruleChips = ids => '';
const sameField = (a, f) => String(a || '').toLowerCase().slice(0, 4) === f.toLowerCase().slice(0, 4);
function copyBtn(id) { return '<button type="button" class="copy" data-copy="' + id + '">Copy</button>'; }
function reviewBlock(title, inner) {
  return '<details class="review"><summary>' + h(title) + '<span class="review-tag">For review</span></summary><div class="review-body">' + inner + '</div></details>';
}

function drawResults() {
  const el = $('#results');
  if (!S) { el.innerHTML = emptyState(); return; }
  const c = S.client;
  let html = '';

  // Warnings
  if (S.warnings.length) html += '<section class="block"><h2 class="sec-h">Warnings</h2>' + [...S.warnings.filter(w => !w.bottom), ...S.warnings.filter(w => w.bottom)].map(w => '<div class="note ' + (w.level || 'warn') + '">' + (w.code === 'TEST' ? '<span class="code">TEST</span>' : '') + w.html + '</div>').join('') + '</section>';

  // Recommended listing and attributes: shown only when the status reaches Done (D48)
  if (S.done) {
    html += '<section class="block rec"><div class="block-head"><h2 class="sec-h">Recommended listing</h2><span class="mono id">' + h(c.sku_id) + '</span><span class="brand">' + h(c.brand) + '</span>' + verifyBadge() + '</div>';
    if (!S.rec) {
      html += '<p class="muted">' + h(S.recNote || 'The recommended listing appears here once it has been generated and validated.') + '</p>';
    } else {
      const r = S.rec;
      if (S.recStatus === 'retrying') html += '<div class="note warn">This first version still has ' + S.recFailures.length + ' issue' + (S.recFailures.length === 1 ? '' : 's') + ' (shown in red below). Rewriting once…</div>';
      const explain = f => {
        const ch = (r.changes || []).filter(x => sameField(x.field, f));
        const ex = (r.excluded || []).filter(x => sameField(x.field, f));
        let inner = ch.length ? '<ul class="changes">' + ch.map(x => '<li>' + h(x.change) + ' ' + ruleChips(x.rules) + '</li>').join('') + '</ul>' : '<p class="muted">No changes recorded for this field.</p>';
        if (ex.length) inner += '<h4>Excluded claims</h4><ul class="excluded">' + ex.map(x => '<li><span class="quote">“' + h(x.claim) + '”</span> ' + ruleChips(x.rule ? [x.rule] : x.rules) + '<br>' + h(x.reason) + '</li>').join('') + '</ul>';
        return '<details class="expl"><summary>Explanation' + (ex.length ? ' and ' + ex.length + ' excluded claim' + (ex.length === 1 ? '' : 's') : '') + '</summary>' + inner + '</details>';
      };
      const fails = f => { const fl = S.recFailures.filter(x => sameField(x.field, f)); return fl.length ? '<ul class="fails">' + fl.map(x => '<li>' + h(x.text) + '</li>').join('') + '</ul>' : ''; };
      html += field('Title', '<p>' + h(c.title || '(blank)') + '</p>', '<p id="rw-title">' + h(r.title) + '</p>', 'rw-title', (r.title || '').length + ' characters', fails('Title') + explain('Title'));
      html += field('Bullets', '<ol class="bl">' + c.bullets.map(b => '<li>' + h(b) + '</li>').join('') + '</ol>', '<ol class="bl" id="rw-bullets">' + (r.bullets || []).map(b => '<li>' + h(b) + '</li>').join('') + '</ol>', 'rw-bullets', (r.bullets || []).length + ' of 5', fails('Bullets') + explain('Bullets'));
      html += field('Description', '<p>' + h(c.description || '(blank)') + '</p>', '<div id="rw-desc">' + String(r.description || '').split(/\n{2,}/).map(p => '<p>' + h(p) + '</p>').join('') + '</div>', 'rw-desc', (r.description || '').length + ' characters', fails('Description') + explain('Description'));
      // Images row: only when there is something to say (IMG-01 count)
      const n = c.images.length;
      if (n < 5) {
        const add = n === 0 ? 'Add at least a main image (required), then 4 to 6 more' : 'Add ' + (5 - n) + ' to ' + (7 - n) + ' more';
        html += '<div class="field"><div class="field-h"><h3>Images</h3></div><div class="cmp"><div class="cur"><span class="lbl">Current</span><p>' + n + ' image' + (n === 1 ? '' : 's') + '</p></div><div class="new"><span class="lbl">Recommended</span><p>5 to 7 images. ' + add + ': lifestyle, infographic, and size or scale reference.</p></div></div>' +
          '<details class="expl"><summary>Explanation</summary><ul class="changes"><li>The guidelines say a minimum of 1 main image, and best practice is 5 to 7 images including main, lifestyle, infographic and size or scale reference. ' + ruleChips(['AMZ-IMG-01']) + '</li></ul></details></div>';
      }
      const other = S.recFailures.filter(x => !x.field);
      if (other.length) html += '<div class="sub-block"><h3>Checks still failing</h3><ul class="fails">' + other.map(x => '<li>' + h(x.text) + '</li>').join('') + '</ul></div>';
    }
    html += '</section>';

    // Additional attributes (D36): prompt only, never written into the recommendation
    html += '<section class="block"><h2 class="sec-h">Enhance your listing with additional attributes</h2><p class="muted">Your current listing does not include information on these attributes, which we think are important for this item. They are not part of the recommended listing above either. If an attribute applies to this item, add the details in your seller portal. Listed with the most widely supported attributes first.</p>';
    if (!S.gaps.length) html += '<p class="muted">None found.</p>';
    else html += '<ul class="facts">' + S.gaps.map(g =>
      '<li><div class="fact-h"><b>' + h(g.attribute) + '</b>' + attrTag(g) + '</div>' +
      (g.reason ? '<span class="muted">' + h(g.reason) + '</span>' : '') +
      (g.evidence || []).map(e => '<br><span class="quote">' + h(e.brand || 'Another SKU') + ': \u201c' + h(e.quote) + '\u201d</span>').join('') + '</li>').join('') + '</ul>';
    html += '</section>';

  }

  el.innerHTML = html;
  maskDom(el, c.brand);
}

// One tag per attribute, by priority (D59): guidelines, then competitor listings (only with a quote), then Ally
function attrTag(g) {
  const src = g.sources || [];
  if (src.includes('guidelines')) return '<span class="as-per">As per retailer guidelines</span>';
  if (src.includes('same_category') && (g.evidence || []).some(e => e && e.quote)) return '<span class="as-per seen-comp">Seen in competitor listings</span>';
  return '<span class="as-per by-ally">Recommended by Ally</span>';
}

function field(name, current, recommended, copyId, meta, extra) {
  return '<div class="field"><div class="field-h"><h3>' + name + '</h3><span class="muted small">' + h(meta) + '</span>' + copyBtn(copyId) + '</div><div class="cmp"><div class="cur"><span class="lbl">Current</span>' + current + '</div><div class="new"><span class="lbl">Recommended</span>' + recommended + '</div></div>' + extra + '</div>';
}

function verifyBadge() {
  if (!S.recStatus) return '';
  const m = { passed: ['good', 'Validated: all checks pass'], retrying: ['warn', 'Rewriting once'], flagged: ['bad', S.recFailures.length + ' issue' + (S.recFailures.length === 1 ? '' : 's') + ' still flagged'] }[S.recStatus];
  return m ? '<span class="q ' + m[0] + '">' + h(m[1]) + '</span>' : '';
}

function emptyState() {
  return '<section class="block empty"><h2 class="sec-h">What you get</h2><ol class="what">' +
    '<li><b>A recommended title, bullets and description</b> that follow the retailer’s content guidelines, shown next to your current listing. Built only from your own product data.</li>' +
    '<li><b>An explanation for every change</b>, with the guideline it addresses and any claims that were left out, and why.</li>' +
    '<li><b>Additional attributes to enrich your listing</b>, such as size or flavor. You add the values; the system never invents them.</li></ol>' +
    '<p class="muted">Enter a SKU ID and select Optimize.</p></section>';
}

// ---------- Pipeline ----------
function issuesFor(audit) {
  return audit.filter(a => a.status === 'not_met').map(a => a.rule.ref + ' (' + a.rule.strength + '): ' + a.rule.says + (a.evidence.length ? ' Found: ' + a.evidence.join('; ') : ''));
}
function aiErrorText(e) {
  const code = e && e.code;
  if (code === 'unavailable' || code === 'not_granted' || code === 'sampling_disabled' || code === 'capability_disabled') return 'Ally is unavailable right now, so the recommendation could not be generated. Please try again later.';
  if (code === 'rate_limited') return 'Ally’s usage limit has been reached. Please try again later.';
  if (code === 'invalid_json') return 'Recommendation generation failed. Select Optimize to run it again.';
  return 'Ally was interrupted before finishing. Select Optimize to try again.';
}

// Stop (D57): the page drops the run; an AI call already in flight may still finish in the background
function stopRun() {
  if (!S || S.msState !== 'running') return;
  runId++; AI.abort();
  S.note = '';
  setStatus(S.ms, 'Stopped. Select Optimize to start again.', 'failed');
  drawResults(); $('#go').disabled = false;
}

async function analyse(input) {
  const my = ++runId;
  const live = () => my === runId;
  $('#err').textContent = '';
  const res = resolveSku(CATALOG, input);
  if (res.error) { S = null; drawProgress(); drawResults(); $('#err').textContent = res.error; return; }
  const client = res.client, comps = res.competitors;
  const ctx = { groupBrands: [client, ...comps].map(x => x.brand) };
  S = { client, warnings: [], competitors: [], gaps: [], rec: null, recStatus: null, recFailures: [], verifyDetail: '', models: [], ms: 0, line: '', msState: 'running', note: '' };
  $('#go').disabled = true;
  const stop = (msg) => { setStatus(S.ms, msg, 'failed'); S.recNote = msg; drawResults(); $('#go').disabled = false; };

  // Step 3
  setStatus(0, 'Checking the SKU ID and finding competitors');
  const tn = TEST_NOTES.get(client.sku_id.toUpperCase());
  // Test notes from the mock catalog are not shown to the brand manager (D61); tn kept for the admin view
  client.notes.forEach(n => S.warnings.push({ code: n.code, html: h(n.text) }));
  if (!comps.length) S.warnings.push({ code: 'V9', html: 'No direct competitors were found for this item.' });
  // SKIP and V11: only when they affect this SKU's group; shown at the bottom of Warnings (D60)
  if (CATALOG.skipped.some(x => x.group && x.group === client.group)) S.warnings.push({ code: 'SKIP', bottom: true, html: 'Some competing items could not be considered because key information was missing, so the comparison may be incomplete.' });
  if (CATALOG.mixedGroups && CATALOG.mixedGroups.has(client.group)) S.warnings.push({ code: 'V11', bottom: true, html: 'Some items compared with yours are from a different category, so they may not be true competitors.' });

  // Steps 4a, 4b, 5
  setStatus(0, 'Checking rules and judgement, summarising the listing');
  S.note = 'The first run asks permission to use your Claude account.';
  S.clientAudit = auditListing(client, ctx);
  drawResults();

  if (!(await AI.available())) { S.note = ''; stop(aiErrorText({ code: 'unavailable' })); return; }
  let contradictions = [];
  try {
    const j = await AI.judge([client], client.sku_id);
    if (!live()) return;
    S.note = '';
    S.models.push(['Judgement checks', j && j._model || 'unknown']);
    const by = new Map(((j && j.listings) || []).map(x => [String(x.sku_id).toUpperCase(), x]));
    const cj = by.get(client.sku_id.toUpperCase());
    S.clientAudit = mergeAi(S.clientAudit, cj && cj.checks);
    contradictions = ((cj && cj.contradictions) || []).filter(x => x && x.quote_a && x.quote_b);
    contradictions.forEach(x => S.warnings.push({ code: 'V19', html: 'Your ' + h(x.where_a) + ' says “' + h(x.quote_a) + '” but your ' + h(x.where_b) + ' says “' + h(x.quote_b) + '”. Both cannot be true, so we left this point out of the recommendation. Please correct it in your seller portal.' }));
    S.clientSum = summarise(S.clientAudit);
    drawResults();

    // Step 7
    setStatus(0, 'Finding recommended facts');
    const pool = categoryPool(CATALOG, client, 10);
    const g = await AI.factGaps(client, pool);
    if (!live()) return;
    S.models.push(['Recommended facts', g && g._model || 'unknown']);
    const order = { guidelines: 0, same_category: 1, ai_knowledge: 2 };
    S.gaps = ((g && g.facts) || []).filter(x => x && x.attribute).map(x => ({ ...x, sources: [...new Set((x.sources || []).filter(v => v in order))].sort((a, b) => order[a] - order[b]) }))
      .sort((a, b) => b.sources.length - a.sources.length || (order[a.sources[0]] ?? 9) - (order[b.sources[0]] ?? 9));
    drawResults();

    // Steps 8 and 9, with one retry (D26, D27)
    const base = { otherBrands: comps.map(x => x.brand), issues: issuesFor(S.clientAudit), contradictions, gaps: S.gaps };
    setStatus(1, 'Writing the recommendation');
    let raw = await AI.rewrite(client, base);
    if (!live()) return;
    S.models.push(['Recommendation', raw && raw._model || 'unknown']);
    setStatus(2, 'Verifying the recommendation');
    let v = await verify(client, raw, ctx, comps);
    if (!live()) return;
    S.models.push(['Fact tracing and completeness', v.model || 'unknown']);
    if (v.failures.length) {
      S.rec = v.rw; S.recFailures = v.failures; S.recStatus = 'retrying'; S.verifyDetail = v.detail;
      setStatus(1, 'Fixing ' + v.failures.length + ' issue' + (v.failures.length === 1 ? '' : 's') + ' and rewriting once');
      drawResults();
      const raw2 = await AI.rewrite(client, { ...base, feedback: v.failures.map(f => f.text) });
      if (!live()) return;
      S.models.push(['Recommendation, second attempt', raw2 && raw2._model || 'unknown']);
      setStatus(2, 'Verifying the second version');
      const v2 = await verify(client, raw2, ctx, comps);
      if (!live()) return;
      if (v2.failures.length <= v.failures.length) v = v2;
    }
    S.rec = v.rw; S.recFailures = v.failures; S.verifyDetail = v.detail;
    S.recStatus = v.failures.length ? 'flagged' : 'passed';
    setStatus(2, v.failures.length ? 'Recommendation ready, ' + v.failures.length + ' issue' + (v.failures.length === 1 ? '' : 's') + ' flagged' : 'Recommendation ready', 'done');
    S.done = true;
    drawResults(); $('#go').disabled = false;
  } catch (e) {
    if (!live()) return;
    S.note = '';
    stop(aiErrorText(e));
  }
}

async function verify(client, raw, ctx, comps) {
  const rw = { title: String(raw.title || ''), bullets: (Array.isArray(raw.bullets) ? raw.bullets : []).map(String).slice(0, 6), description: String(raw.description || ''), changes: raw.changes || [], excluded: Array.isArray(raw.excluded) ? raw.excluded : [] };
  const failures = [];
  const vr = verifyRules(rw, client, ctx);
  vr.failures.forEach(f => failures.push({ field: fieldOf(f.rule), text: f.rule + ': ' + f.says + (f.evidence.length ? ' Found: ' + f.evidence.join('; ') : '') }));
  const copies = copyCheck(rw, comps);
  copies.forEach(c => failures.push({ field: c.field, text: 'Copy check: “' + c.line + '” is too close to ' + c.brand + '’s “' + c.competitorLine + '”.' }));
  let t = null;
  try { t = await AI.traceFacts(client, rw); } catch (e) { t = null; }
  const untraced = ((t && t.claims) || []).filter(c => c && c.traced === false);
  untraced.forEach(c => failures.push({ field: c.where, text: 'Fact not found in your data: “' + c.claim + '”.' }));
  ((t && t.unverifiable) || []).forEach(u => failures.push({ field: null, text: (u.rule || 'Claim') + ': “' + u.quote + '” cannot be verified from your data. ' + (u.reason || '') }));
  const dropped = ((t && t.dropped) || []).filter(d => d && d.fact);
  dropped.forEach(d => failures.push({ field: null, text: 'Completeness: a fact from your data is missing from the recommendation: “' + d.fact + '” (your data says “' + (d.source_quote || '') + '”).' }));
  const traced = ((t && t.claims) || []).filter(c => c && c.traced);
  const detail = '<ul>' +
    '<li>Rules re-checked on the recommendation: ' + (vr.failures.length ? vr.failures.length + ' failing' : 'all pass') + (vr.recMisses.length ? '. Recommendations not followed: ' + h(vr.recMisses.map(r => r.rule + ' (' + r.evidence.join('; ') + ')').join(', ')) : '') + '.</li>' +
    '<li>Copy check against ' + comps.length + ' competitor listing' + (comps.length === 1 ? '' : 's') + ' (a line counts as copied if 80% of its words appear in order in one competitor line): ' + (copies.length ? copies.length + ' too close' : 'no copied lines') + '.</li>' +
    '<li>Fact tracing: ' + (t ? traced.length + ' claims traced to your data' + (untraced.length ? ', ' + untraced.length + ' not found' : '') : 'did not run') + '.</li>' +
    '<li>Completeness: ' + (t ? (dropped.length ? dropped.length + ' of your facts missing' : 'no facts from your data dropped') : 'did not run') + '.</li></ul>' +
    (traced.length ? '<div class="tbl-wrap"><table class="audit"><thead><tr><th>Claim in the recommendation</th><th>Where</th><th>Source in your data</th></tr></thead><tbody>' + traced.map(c => '<tr><td>' + h(c.claim) + '</td><td class="nowrap">' + h(c.where) + '</td><td class="quote">“' + h(c.source_quote) + '”</td></tr>').join('') + '</tbody></table></div>' : '');
  return { failures, detail, rw, model: t && t._model };
}
function fieldOf(ref) { if (/TITLE/.test(ref)) return 'Title'; if (/BULLET/.test(ref)) return 'Bullets'; if (/DESC/.test(ref)) return 'Description'; return null; }

// ---------- Wiring ----------
document.addEventListener('click', async e => {
  if (e.target.closest('#stop')) { stopRun(); return; }
  const cp = e.target.closest('button.copy');
  if (cp) {
    const src = document.getElementById(cp.dataset.copy);
    if (!src) return;
    const text = src.tagName === 'OL' ? [...src.querySelectorAll('li')].map(li => li.textContent).join('\n') : src.innerText;
    try { await navigator.clipboard.writeText(text); cp.textContent = 'Copied'; }
    catch (err) { const r = document.createRange(); r.selectNodeContents(src); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); cp.textContent = 'Selected: press Ctrl+C'; }
    setTimeout(() => { cp.textContent = 'Copy'; }, 2000);
  }
});
$('#f').addEventListener('submit', e => { e.preventDefault(); if (CATALOG.blocked) { $('#err').textContent = 'We couldn\u2019t load your product data, so no SKU can be optimized.'; return; } analyse($('#sku').value); });
document.addEventListener('change', e => { if (e.target.name === 'active') setActive(e.target.value); });
document.addEventListener('submit', e => { if (e.target.id === 'up') { e.preventDefault(); addUpload(); } });
document.addEventListener('click', e => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { UPLOADS = UPLOADS.filter(x => x.id !== rm.dataset.remove); LS.set('ally.uploads', UPLOADS); if (ACTIVE === rm.dataset.remove) ACTIVE = 'pre-0'; LS.set('ally.active', ACTIVE); useCatalog(); return; }
  const tb = e.target.closest('#tabs button');
  if (tb) { VIEW = tb.dataset.view; LS.set('ally.view', VIEW); drawView(); }
});
useCatalog(); drawView();
