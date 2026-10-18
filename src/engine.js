// ===================== ENGINE: plain rules, no AI =====================
// Everything in this block gives the same result every time.

const REQUIRED_COLS = ['sku_id','is_client','competitor_group','brand','category','title','bullet_1','bullet_2','bullet_3','bullet_4','bullet_5','description','image_urls'];
const MINOR_WORDS = new Set(['a','an','and','or','for','of','the','with','in','on','to','by','from','at','as','per']);

// ---------- CSV parsing ----------
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

// ---------- Text helpers ----------
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function phraseRegex(p) { return new RegExp('(?<![A-Za-z0-9])' + esc(p) + '(?![A-Za-z0-9])', 'gi'); }
function findPhrases(text, list) {
  const hits = [];
  if (!text) return hits;
  for (const p of list) { const m = text.match(phraseRegex(p)); if (m) for (const x of m) hits.push(x); }
  return hits;
}
function normSpace(s, keepParagraphs) {
  let t = String(s || '').replace(/\t/g, ' ');
  if (keepParagraphs) t = t.replace(/[  ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  else t = t.replace(/\s+/g, ' ');
  return t.trim();
}
function words(s) { return (String(s || '').toLowerCase().match(/[a-z0-9%#']+/g) || []); }
function stem(w) { return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; }

// ---------- Load the catalog: validations V1 to V24 ----------
function loadCatalog(text) {
  const out = { blocked: null, warnings: [], fixes: [], skipped: [], skus: new Map(), groups: new Map(), rowCount: 0 };
  let rows;
  try { rows = parseCSV(text); } catch (e) { rows = []; }
  if (!rows.length || rows.length < 1) { out.blocked = 'The catalog file is empty or is not a readable CSV.'; return out; }   // V1
  const header = rows[0].map(h => h.trim().toLowerCase());
  const missing = REQUIRED_COLS.filter(c => !header.includes(c));
  if (missing.length === REQUIRED_COLS.length) { out.blocked = 'The catalog file has no header row.'; return out; }           // V1
  if (missing.length) { out.blocked = 'The catalog file is missing required columns: ' + missing.join(', ') + '.'; return out; } // V2
  const extra = header.filter(h => h && !REQUIRED_COLS.includes(h));
  if (extra.length) out.warnings.push({ code: 'V3', text: 'Extra columns were ignored: ' + extra.join(', ') + '.' });          // V3
  const idx = Object.fromEntries(REQUIRED_COLS.map(c => [c, header.indexOf(c)]));
  const data = rows.slice(1);
  out.rowCount = data.length;
  if (!data.length) { out.blocked = 'The catalog file has a header but no rows.'; return out; }
  const garbled = [];
  out.mixedGroups = new Set();
  data.forEach((r, n) => {
    const rowNo = n + 2; // line number in the file
    const get = c => (r[idx[c]] ?? '');
    const rawId = get('sku_id').trim();
    const label = rawId || ('row ' + rowNo);
    if (r.some(cell => /Ã.|â€|\uFFFD/.test(cell))) garbled.push(label);                                                    // V4
    if (!rawId) { out.skipped.push({ label, reason: 'SKU ID is blank' }); return; }                                           // V5
    const key = rawId.toUpperCase();
    if (out.skus.has(key)) { out.skipped.push({ label: rawId + ' (row ' + rowNo + ')', reason: 'duplicate SKU ID; the first row was used', group: get('competitor_group').trim() }); return; } // V6
    const ic = get('is_client').trim().toUpperCase();
    if (ic !== 'TRUE' && ic !== 'FALSE') { out.skipped.push({ label: rawId, reason: 'is_client is not TRUE or FALSE', group: get('competitor_group').trim() }); out.skus.set(key, { skippedReason: 'is_client is not TRUE or FALSE' }); return; } // V7
    const group = get('competitor_group').trim();
    if (!group) { out.skipped.push({ label: rawId, reason: 'competitor_group is blank' }); out.skus.set(key, { skippedReason: 'competitor_group is blank' }); return; } // V8
    // V18: spacing
    let spacingFixed = false;
    const clean = (v, keepP) => { const c = normSpace(v, keepP); if (c !== String(v || '').trim()) spacingFixed = true; return c; };
    const rec = {
      row: rowNo, sku_id: rawId, is_client: ic === 'TRUE', group,
      brand: clean(get('brand')), category: clean(get('category')), title: clean(get('title')),
      description: clean(get('description'), true), bullets: [], images: [], notes: []
    };
    const rawBullets = [1, 2, 3, 4, 5].map(i => clean(get('bullet_' + i)));
    rec.bullets = rawBullets.filter(b => b);
    const firstBlank = rawBullets.findIndex(b => !b);
    if (firstBlank !== -1 && rawBullets.slice(firstBlank).some(b => b)) out.fixes.push({ code: 'V15', text: rawId + ': bullets were out of order and were shifted up.' }); // V15
    if (spacingFixed) out.fixes.push({ code: 'V18', text: rawId + ': extra spaces, tabs or line breaks were cleaned.' });
    // V21: image separators
    const imgRaw = get('image_urls').trim();
    if (imgRaw) {
      if (imgRaw.includes('|')) rec.images = imgRaw.split('|').map(s => s.trim()).filter(Boolean);
      else {
        const parts = imgRaw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 1) out.fixes.push({ code: 'V21', text: rawId + ': image URLs used a separator other than | and were split.' });
        rec.images = parts;
      }
    }
    if (!rec.brand) rec.notes.push({ code: 'V12', text: 'Your listing has no brand name, so we could not fully check how your title is structured.' });
    // V13: a blank title is not a warning; a new title is simply written (D58)
    if (!rec.bullets.length && !rec.description) rec.notes.push({ code: 'V16', text: 'Your bullets and description are empty, so the recommendation has very little to work with.' });
    out.skus.set(key, rec);
    if (!out.groups.has(group)) out.groups.set(group, []);
    out.groups.get(group).push(rec);
  });
  if (garbled.length) out.warnings.push({ code: 'V4', text: 'Some text looks garbled, possibly an encoding problem: ' + garbled.slice(0, 3).join(', ') + (garbled.length > 3 ? ' and ' + (garbled.length - 3) + ' more' : '') + '.' });
  for (const [g, members] of out.groups) {
    if (!members.some(m => m.is_client)) out.warnings.push({ code: 'V10', text: 'Group "' + g + '" has competitors but no client SKU.' });                     // V10
    const cats = [...new Set(members.map(m => m.category))];
    if (cats.length > 1) out.mixedGroups.add(g);
    if (cats.length > 1) out.warnings.push({ code: 'V11', text: 'Group "' + g + '" mixes categories, so its SKUs may not be true competitors: ' + cats.join('; ') + '.' }); // V11
  }
  if (out.skipped.length) {
    const ex = out.skipped.slice(0, 3).map(s => s.label + ' (' + s.reason + ')').join('; ');
    out.warnings.unshift({ code: 'SKIP', text: 'Some items have incomplete critical information and could not be considered. Examples: ' + ex + '.' });
  }
  return out;
}

// ---------- SKU entry: V25 to V28 ----------
function resolveSku(catalog, input) {
  const key = String(input || '').trim().toUpperCase();                                                                       // V28
  if (!key) return { error: 'Enter a SKU ID.' };
  const rec = catalog.skus.get(key);
  if (!rec) {
    const sk = catalog.skipped.find(s => s.label.toUpperCase() === key);
    if (sk) return { error: 'This SKU has incomplete critical information and could not be analysed: ' + sk.reason + '.' };     // V27
    return { error: 'SKU not found. Check the ID and try again.' };                                                            // V25
  }
  if (rec.skippedReason) return { error: 'This SKU has incomplete critical information and could not be analysed: ' + rec.skippedReason + '.' }; // V27
  if (!rec.is_client) return { error: 'This SKU isn’t one of your products. Please enter one of your own SKU IDs.' };   // V26
  const competitors = (catalog.groups.get(rec.group) || []).filter(m => !m.is_client);                                       // D14
  return { client: rec, competitors };
}

// ---------- Rule table (D18): built from the Amazon guidelines file ----------
// strength: the file's own wording. Limit = hard number; Recommendation = "generally perform better",
// "Recommended", "best practice", "roughly"; Instruction = tells the writer to do something; Prohibition = "Do not", "No", "Avoid".
const RULES = [
  { id: 'TITLE-01a', ref: 'AMZ-TITLE-01', field: 'Title', strength: 'Limit', check: 'maxLength', value: 200, says: 'Keep titles under 200 characters.' },
  { id: 'TITLE-01b', ref: 'AMZ-TITLE-01', field: 'Title', strength: 'Recommendation', check: 'lengthRange', value: [80, 150], says: 'Titles of about 80 to 150 characters generally perform better on mobile.' },
  { id: 'TITLE-02', ref: 'AMZ-TITLE-02', field: 'Title', strength: 'Recommendation', check: 'ai', says: 'Recommended pattern: Brand + Model/Key Feature + Product Type + Size/Count/Color.' },
  { id: 'TITLE-03a', ref: 'AMZ-TITLE-03', field: 'Title', strength: 'Prohibition', check: 'noAllCapsRun', says: 'Do not write in ALL CAPS.' },
  { id: 'TITLE-03b', ref: 'AMZ-TITLE-03', field: 'Title', strength: 'Instruction', check: 'titleCase', says: 'Capitalize the first letter of each word (title case).' },
  { id: 'TITLE-04', ref: 'AMZ-TITLE-04', field: 'Title', strength: 'Prohibition', check: 'titlePromo', value: ['best', '#1', 'cheap', 'sale', 'free shipping', '100% guaranteed'], says: 'No promotional or subjective claims such as "Best", "#1", "Cheap", "Sale", "Free Shipping", "100% Guaranteed", or excessive punctuation.' },
  { id: 'TITLE-05a', ref: 'AMZ-TITLE-05', field: 'Title', strength: 'Prohibition', check: 'repeatedWords', says: 'Do not repeat the same keyword multiple times.' },
  { id: 'TITLE-05b', ref: 'AMZ-TITLE-05', field: 'Title', strength: 'Prohibition', check: 'ai', says: 'Do not cram unrelated search terms into the title.' },
  { id: 'TITLE-06', ref: 'AMZ-TITLE-06', field: 'Title', strength: 'Instruction', check: 'ai', says: 'Include size, count, color, or flavor when the product has variants.' },
  { id: 'BULLET-01', ref: 'AMZ-BULLET-01', field: 'Bullets', strength: 'Limit', check: 'maxBullets', value: 5, says: 'Use up to 5 bullet points.' },
  { id: 'BULLET-02a', ref: 'AMZ-BULLET-02', field: 'Bullets', strength: 'Limit', check: 'bulletLength', value: 255, says: 'Keep each bullet under roughly 200 to 255 characters.' },
  { id: 'BULLET-02b', ref: 'AMZ-BULLET-02', field: 'Bullets', strength: 'Instruction', check: 'ai', says: 'Lead with the most important information first.' },
  { id: 'BULLET-03', ref: 'AMZ-BULLET-03', field: 'Bullets', strength: 'Instruction', check: 'bulletHeader', says: 'Start each bullet with a short capitalized header phrase followed by a benefit sentence.' },
  { id: 'BULLET-04', ref: 'AMZ-BULLET-04', field: 'Bullets', strength: 'Instruction', check: 'ai', says: 'Explain what each feature means for the customer, not just the feature.' },
  { id: 'BULLET-05', ref: 'AMZ-BULLET-05', field: 'Bullets', strength: 'Prohibition', check: 'phrases', scope: 'bullets', value: ['price', 'priced', 'pricing', 'discount', 'deal', 'deals', 'sale', 'save', 'savings', 'cheap', 'cheapest', 'shipping', 'guarantee', 'guaranteed', 'money back', 'warranty', '$'], says: 'Do not mention price, discounts, deals, or shipping or guarantee terms in bullets.' },
  { id: 'BULLET-06', ref: 'AMZ-BULLET-06', field: 'Bullets', strength: 'Prohibition', check: 'allCapsBullet', says: 'Full bullets should not be written in all caps.' },
  { id: 'BULLET-07a', ref: 'AMZ-BULLET-07', field: 'Bullets', strength: 'Prohibition', check: 'phrases', scope: 'bullets', value: ['best', 'cures', 'cure', 'guaranteed', 'clinically proven'], says: 'Avoid "best", "cures", "guaranteed", "clinically proven".' },
  { id: 'BULLET-07b', ref: 'AMZ-BULLET-07', field: 'Bullets', strength: 'Prohibition', check: 'ai', says: 'Avoid health or safety claims that cannot be verified.' },
  { id: 'DESC-01a', ref: 'AMZ-DESC-01', field: 'Description', strength: 'Limit', check: 'maxLength', value: 2000, says: 'Up to approximately 2,000 characters.' },
  { id: 'DESC-01b', ref: 'AMZ-DESC-01', field: 'Description', strength: 'Instruction', check: 'ai', says: 'Use complete sentences and short paragraphs; avoid a single wall of text.' },
  { id: 'DESC-02', ref: 'AMZ-DESC-02', field: 'Description', strength: 'Instruction', check: 'ai', says: 'Expand on bullets with use case, materials, care, sizing guidance and relevant safety notes.' },
  { id: 'DESC-03', ref: 'AMZ-DESC-03', field: 'Description', strength: 'Prohibition', check: 'contactPromo', value: ['buy now', 'limited time', 'free shipping'], says: 'No contact info, external links, or promotional pricing language ("buy now", "limited time", "free shipping").' },
  { id: 'DESC-04', ref: 'AMZ-DESC-04', field: 'Description', strength: 'Prohibition', check: 'html', says: 'Do not paste raw HTML tags into the description.' },
  { id: 'DESC-05', ref: 'AMZ-DESC-05', field: 'Description', strength: 'Prohibition', check: 'firstPerson', says: 'Avoid first person seller voice; write in third person.' },
  { id: 'IMG-01a', ref: 'AMZ-IMG-01', field: 'Images', strength: 'Limit', check: 'minImages', value: 1, says: 'Provide a minimum of 1 main image.' },
  { id: 'IMG-01b', ref: 'AMZ-IMG-01', field: 'Images', strength: 'Recommendation', check: 'imageRange', value: [5, 7], says: 'Best practice is 5 to 7 images: main, lifestyle, infographic, size or scale reference.' },
  { id: 'IMG-02', ref: 'AMZ-IMG-02', field: 'Images', strength: 'Prohibition', check: 'unchecked', says: 'Main image: pure white background, product fills about 85% of frame, no text, logos, watermarks or props.' },
  { id: 'IMG-03', ref: 'AMZ-IMG-03', field: 'Images', strength: 'Limit', check: 'unchecked', says: 'At least 1000px on the longest side.' },
  { id: 'RESTRICT-01', ref: 'AMZ-RESTRICT-01', field: 'All text', strength: 'Prohibition', check: 'phrases', scope: 'all', value: ['sale', 'best price', 'cheap', 'cheapest', 'discount', 'free gift', 'deal', 'deals', 'save', 'savings'], says: 'No pricing or promotional claims ("sale", "best price", "cheap", "discount", "free gift").' },
  { id: 'RESTRICT-02', ref: 'AMZ-RESTRICT-02', field: 'All text', strength: 'Prohibition', check: 'phrases', scope: 'all', value: ['order now', 'order today', 'buy now', 'while supplies last', 'limited time', 'deal ends'], says: 'No time sensitive claims ("order now", "while supplies last", "limited time offer").' },
  { id: 'RESTRICT-03', ref: 'AMZ-RESTRICT-03', field: 'All text', strength: 'Prohibition', check: 'phrases', scope: 'all', value: ['guarantee', 'guaranteed', 'money back', 'warranty'], says: 'No self declared guarantee or warranty language.' },
  { id: 'RESTRICT-04a', ref: 'AMZ-RESTRICT-04', field: 'All text', strength: 'Prohibition', check: 'phrases', scope: 'all', value: ['#1', 'number one', 'best', 'best-selling', 'best selling', 'best in the world'], says: 'No unverifiable superlatives ("#1 best-selling", "best in the world").' },
  { id: 'RESTRICT-04b', ref: 'AMZ-RESTRICT-04', field: 'All text', strength: 'Prohibition', check: 'ai', says: 'No other unverifiable superlative claims without substantiation.' },
  { id: 'RESTRICT-05', ref: 'AMZ-RESTRICT-05', field: 'All text', strength: 'Prohibition', check: 'phrases', scope: 'all', value: ['5-star', '5 star', 'five star', 'star rated', 'customers love', 'reviews', 'testimonial', '#1 rated'], says: 'No reviews or testimonials referenced in content.' },
  { id: 'RESTRICT-06', ref: 'AMZ-RESTRICT-06', field: 'All text', strength: 'Prohibition', check: 'competitorBrands', says: 'No competitor brand names.' },
  { id: 'RESTRICT-07', ref: 'AMZ-RESTRICT-07', field: 'All text', strength: 'Prohibition', check: 'contact', says: 'No seller or company contact information or external links.' }
];
const AI_RULES = RULES.filter(r => r.check === 'ai');

const RX_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const RX_URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co)\b/gi;
const RX_PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const RX_HTML = /<\/?[a-z][^>]*>/gi;

function contactHits(t) {
  const emails = t.match(RX_EMAIL) || [];
  const urls = (t.match(RX_URL) || []).map(u => u.replace(/[.,;:)\]]+$/, '')).filter(u => !emails.some(e => e.endsWith(u) || e.includes('@' + u)));
  const phones = t.match(RX_PHONE) || [];
  return [...emails, ...urls, ...phones];
}
function allText(l) { return [l.title, ...l.bullets, l.description].filter(Boolean); }
function brandTokens(brand) { return new Set(words(brand)); }

// Each check returns { status: 'met' | 'not_met' | 'na' | 'unchecked', evidence: [] }
function runCheck(rule, l, ctx) {
  const met = () => ({ status: 'met', evidence: [] });
  const fail = ev => ({ status: 'not_met', evidence: ev });
  switch (rule.check) {
    case 'maxLength': {
      const t = rule.field === 'Title' ? l.title : l.description;
      if (!t) return { status: 'na', evidence: ['Field is blank'] };
      return t.length <= rule.value ? { status: 'met', evidence: [t.length + ' characters'] } : fail([t.length + ' characters']);
    }
    case 'lengthRange': {
      if (!l.title) return { status: 'na', evidence: ['Title is blank'] };
      const n = l.title.length;
      return n >= rule.value[0] && n <= rule.value[1] ? { status: 'met', evidence: [n + ' characters'] } : fail([n + ' characters']);
    }
    case 'noAllCapsRun': {
      // A11b: ALL CAPS = two or more consecutive all-capital words of 3+ letters, brand excluded
      const bt = brandTokens(l.brand);
      const runs = []; let cur = [];
      for (const w of (l.title || '').split(/\s+/)) {
        const lw = w.replace(/[^A-Za-z]/g, '');
        if (lw.length >= 3 && lw === lw.toUpperCase() && !bt.has(lw.toLowerCase())) cur.push(w);
        else { if (cur.length >= 2) runs.push(cur.join(' ')); cur = []; }
      }
      if (cur.length >= 2) runs.push(cur.join(' '));
      return runs.length ? fail(runs) : met();
    }
    case 'titleCase': {
      const bt = brandTokens(l.brand);
      const bad = (l.title || '').split(/\s+/).filter(w => {
        const core = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
        return core && /^[a-z]/.test(core) && !MINOR_WORDS.has(core.toLowerCase()) && !bt.has(core.toLowerCase());
      });
      return bad.length ? fail(['Lowercase: ' + [...new Set(bad.map(w => w.replace(/[^A-Za-z0-9]+$/, '')))].join(', ')]) : met();
    }
    case 'titlePromo': {
      const hits = findPhrases(l.title, rule.value);
      const punct = (l.title || '').match(/[!?]{2,}/g) || [];
      const ev = [...hits, ...punct];
      return ev.length ? fail(ev) : met();
    }
    case 'repeatedWords': {
      const bt = brandTokens(l.brand), count = new Map(), seen = new Map();
      for (const w of words(l.title)) {
        if (MINOR_WORDS.has(w) || /^\d+$/.test(w) || w.length < 3 || bt.has(w)) continue;
        const s = stem(w);
        count.set(s, (count.get(s) || 0) + 1);
        if (!seen.has(s)) seen.set(s, new Set());
        seen.get(s).add(w);
      }
      const rep = [...count].filter(([, n]) => n > 1).map(([s, n]) => [...seen.get(s)].join('/') + ' ×' + n);
      return rep.length ? fail(rep) : met();
    }
    case 'maxBullets':
      return l.bullets.length <= rule.value ? { status: 'met', evidence: [l.bullets.length + ' of 5 used'] } : fail([l.bullets.length + ' bullets']);
    case 'bulletLength': {
      if (!l.bullets.length) return { status: 'na', evidence: ['No bullets'] };
      const long = l.bullets.map((b, i) => [i + 1, b.length]).filter(([, n]) => n > rule.value);
      return long.length ? fail(long.map(([i, n]) => 'Bullet ' + i + ': ' + n + ' characters')) : met();
    }
    case 'bulletHeader': {
      if (!l.bullets.length) return { status: 'na', evidence: ['No bullets'] };
      const bad = l.bullets.map((b, i) => [i + 1, b]).filter(([, b]) => !/^[A-Z0-9][A-Z0-9 &'’,\/%+().-]{1,60}:\s*\S/.test(b));
      return bad.length ? fail(bad.map(([i, b]) => 'Bullet ' + i + ': "' + b.slice(0, 40) + (b.length > 40 ? '…' : '') + '"')) : met();
    }
    case 'allCapsBullet': {
      if (!l.bullets.length) return { status: 'na', evidence: ['No bullets'] };
      const bad = l.bullets.map((b, i) => [i + 1, b]).filter(([, b]) => {
        const body = b.replace(/^[^:]{1,60}:\s*/, '');
        const letters = body.replace(/[^A-Za-z]/g, '');
        return letters.length >= 10 && letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.9;
      });
      return bad.length ? fail(bad.map(([i]) => 'Bullet ' + i + ' is in all caps')) : met();
    }
    case 'phrases': {
      const texts = rule.scope === 'bullets' ? l.bullets : allText(l);
      const hits = [];
      texts.forEach(t => {
        for (const p of rule.value) {
          if (p === '$') { const m = t.match(/\$\s?\d/g); if (m) hits.push(...m); continue; }
          const m = t.match(phraseRegex(p)); if (m) hits.push(...m);
        }
      });
      return hits.length ? fail([...new Set(hits)]) : met();
    }
    case 'contactPromo': {
      const t = l.description || '';
      const hits = [...findPhrases(t, rule.value), ...contactHits(t)];
      return hits.length ? fail([...new Set(hits)]) : met();
    }
    case 'contact': {
      const hits = [];
      allText(l).forEach(t => hits.push(...contactHits(t)));
      return hits.length ? fail([...new Set(hits)]) : met();
    }
    case 'html': {
      const hits = (l.description || '').match(RX_HTML) || [];
      return hits.length ? fail([...new Set(hits)]) : met();
    }
    case 'firstPerson': {
      const t = l.description || '';
      const hits = [...(t.match(/(?<![A-Za-z'])(?:we|We|WE|our|Our|OUR|ours|us|I|my|My|we're|We're|we've|We've)(?![A-Za-z'])/g) || [])];
      return hits.length ? fail([...new Set(hits)]) : met();
    }
    case 'minImages':
      return l.images.length >= rule.value ? { status: 'met', evidence: [l.images.length + ' found'] } : fail([l.images.length + ' found']);
    case 'imageRange': {
      const n = l.images.length;
      return n >= rule.value[0] ? { status: 'met', evidence: [n + ' found'] } : fail([n + ' found']);
    }
    case 'unchecked':
      return { status: 'unchecked', evidence: ['Images cannot be opened from this catalog'] };
    case 'competitorBrands': {
      const others = (ctx.groupBrands || []).filter(b => b && b.toLowerCase() !== (l.brand || '').toLowerCase());
      const hits = [];
      allText(l).forEach(t => others.forEach(b => { if (phraseRegex(b).test(t)) hits.push(b); }));
      return hits.length ? fail([...new Set(hits)]) : met();
    }
    case 'ai':
      return { status: 'pending', evidence: [] };
  }
  return { status: 'unchecked', evidence: [] };
}

function auditListing(l, ctx) {
  return RULES.map(r => ({ rule: r, ...runCheck(r, l, ctx) }));
}

// Merge AI judgement results into an audit
function mergeAi(audit, aiChecks) {
  const byId = new Map((aiChecks || []).map(c => [String(c.rule || '').replace(/^AMZ-/, ''), c]));
  return audit.map(a => {
    if (a.rule.check !== 'ai') return a;
    const c = byId.get(a.rule.id) || byId.get(a.rule.ref.replace(/^AMZ-/, ''));
    if (!c) return { ...a, status: 'pending', evidence: ['Judgement check unavailable'] };
    const ev = [];
    if (c.evidence) ev.push('"' + c.evidence + '"');
    if (c.note) ev.push(c.note);
    return { ...a, status: c.met ? 'met' : 'not_met', evidence: ev, byAi: true };
  });
}

// One line summary (D8)
function summarise(audit) {
  const broken = audit.filter(a => a.status === 'not_met' && (a.rule.strength === 'Limit' || a.rule.strength === 'Prohibition'));
  const instr = audit.filter(a => a.status === 'not_met' && a.rule.strength === 'Instruction');
  const rec = audit.filter(a => a.status === 'not_met' && a.rule.strength === 'Recommendation');
  const pending = audit.filter(a => a.status === 'pending');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  let s = broken.length ? 'Not compliant: ' + plural(broken.length, 'rule') + ' broken.' : 'Compliant.';
  const extra = [];
  if (instr.length) extra.push(plural(instr.length, 'instruction'));
  if (rec.length) extra.push(plural(rec.length, 'recommendation'));
  if (extra.length) s += ' ' + extra.join(' and ') + ' not followed.';
  if (pending.length) s += ' ' + plural(pending.length, 'judgement check') + ' not run.';
  return { text: s, compliant: !broken.length, broken: broken.length, instr: instr.length, rec: rec.length, pending: pending.length };
}

// D38: competitor compliance mark, for the audit only; it affects no output
function qualifies(audit) {
  const p = audit.filter(a => a.rule.strength === 'Prohibition' && a.status === 'not_met');
  const pend = audit.filter(a => a.rule.strength === 'Prohibition' && a.status === 'pending');
  if (p.length) return { ok: false, reason: 'Breaks ' + [...new Set(p.map(a => a.rule.ref))].join(', ') };
  if (pend.length) return { ok: null, reason: 'Judgement checks did not run, so this is not decided' };
  return { ok: true, reason: 'No prohibition broken' };
}

// ---------- Same category pool for attribute types (D37, A16, A17) ----------
// Any valid SKU with the same category, across groups, passing the guidelines or not.
// Excludes the client itself and other client SKUs. Same group first, capped at 10.
function categoryPool(catalog, client, cap = 10) {
  const cat = (client.category || '').trim().toLowerCase();
  const all = [...catalog.skus.values()].filter(r => !r.skippedReason && !r.is_client && r !== client && (r.category || '').trim().toLowerCase() === cat);
  all.sort((x, y) => (y.group === client.group) - (x.group === client.group));
  return all.slice(0, cap);
}

// ---------- Copy check (D12, definition 3; A11) ----------
function lcs(a, b) {
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
function sentences(t) { return String(t || '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean); }
function copyCheck(rewrite, competitors, threshold = 0.8) {
  const units = [];
  competitors.forEach(c => {
    [c.title, ...c.bullets, ...sentences(c.description)].forEach(u => { if (u) units.push({ brand: c.brand, text: u, w: words(u) }); });
  });
  const lines = [['Title', rewrite.title], ...(rewrite.bullets || []).map((b, i) => ['Bullet ' + (i + 1), b]), ...sentences(rewrite.description).map(s => ['Description', s])];
  const hits = [];
  for (const [field, line] of lines) {
    const lw = words(line);
    if (lw.length < 5) continue;
    for (const u of units) {
      const r = lcs(lw, u.w) / lw.length;
      if (r >= threshold) { hits.push({ field, line, brand: u.brand, competitorLine: u.text, ratio: r }); break; }
    }
  }
  return hits;
}

// ---------- Verification of a rewrite (step 9, rules part) ----------
function verifyRules(rewrite, client, ctx) {
  const l = { ...client, title: rewrite.title || '', bullets: (rewrite.bullets || []).filter(Boolean), description: rewrite.description || '' };
  const audit = auditListing(l, ctx).filter(a => a.rule.field !== 'Images');
  // Failures that trigger a retry: limits, prohibitions, and plain rule instructions (D26)
  const failures = audit.filter(a => a.status === 'not_met' && (a.rule.strength !== 'Recommendation')).map(a => ({ rule: a.rule.ref, says: a.rule.says, evidence: a.evidence }));
  const recMisses = audit.filter(a => a.status === 'not_met' && a.rule.strength === 'Recommendation').map(a => ({ rule: a.rule.ref, says: a.rule.says, evidence: a.evidence }));
  return { audit, failures, recMisses };
}

if (typeof module !== 'undefined') module.exports = { categoryPool, parseCSV, loadCatalog, resolveSku, RULES, AI_RULES, auditListing, mergeAi, summarise, qualifies, copyCheck, verifyRules, words, sentences };
// =================== END ENGINE ===================
