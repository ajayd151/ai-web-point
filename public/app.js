// Finder runs client-side (mock data). Generation calls the Vercel function.
let pendingBusiness = null;
let currentBusiness = null;
let currentSlug = null; // slug of the mockup shown in the preview modal
let currentPersonName = '';
let currentRequirements = '';
let lastSearchResults = [];
let hotCount = 0;
let signupCount = 0;
let recentIndex = new Map(); // normalized name|location -> recent mockup (for search-result status)
function normKey(name, loc) { return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + String(loc || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
let authed = false;
const $ = (id) => document.getElementById(id);

// ---- editable settings (message + CTA wording, saved per device) ---------
const DEFAULT_FIRST_MSG = "Hi {name},\n\nI came across {business} while looking through {category} in {location}.\n\nI noticed you don't currently have a website, so I put together a website preview for your business:\n\n{link}\n\nI thought it might help you see what your business could look like online.\n\nIf you'd like me to show you how the rest of the website could look, just let me know.\n\nIf it's not something you're interested in, simply reply \"No\" and I won't contact you again.\n\nThanks,\n\nAjay";
const SETTINGS_DEFAULTS = {
  waTemplates: [{ id: 'default', name: 'Default', body: DEFAULT_FIRST_MSG }], // multiple first-message templates
  lastTemplateId: 'default', // which one is selected by default when sending
  ctaHero: 'Request a demo of the full website',
  ctaBottom: 'Let me show you the full website over a call',
  followUp: "Hi {name}, just following up on the free website preview I put together for {business}. Did you get a chance to take a look?\n\n{link}\n\nNo worries if not, happy to jump on a quick call whenever suits.\n\nCheers,\nJames",
  waCap: 10, // hard daily WhatsApp send cap (ban protection)
  grammarFix: true, // AI tidies the first message's grammar when sent (default on)
};
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('aiwp_settings') || '{}'); } catch (e) {}
  const out = Object.assign({}, SETTINGS_DEFAULTS, s);
  // first-message templates: use the stored list, else migrate the legacy single waMsg
  let list = Array.isArray(s.waTemplates) ? s.waTemplates : null;
  if (!list || !list.length) {
    const body = (typeof s.waMsg === 'string' && s.waMsg) ? s.waMsg : DEFAULT_FIRST_MSG;
    list = [{ id: 'default', name: 'Default', body }];
  }
  list = list.filter((t) => t && typeof t.body === 'string').map((t, i) => ({
    id: String(t.id || ('t' + i)), name: String(t.name || 'Untitled').slice(0, 40), body: String(t.body), locked: !!t.locked,
  }));
  if (!list.length) list = [{ id: 'default', name: 'Default', body: DEFAULT_FIRST_MSG }];
  out.waTemplates = list;
  out.lastTemplateId = list.some((t) => t.id === s.lastTemplateId) ? s.lastTemplateId : list[0].id;
  return out;
}
// merge-persist (so template edits and field edits don't clobber each other)
function patchSettings(partial) {
  let cur = {};
  try { cur = JSON.parse(localStorage.getItem('aiwp_settings') || '{}'); } catch (e) {}
  try { localStorage.setItem('aiwp_settings', JSON.stringify(Object.assign({}, cur, partial))); } catch (e) {}
}
function firstTemplates() { return loadSettings().waTemplates; }
function activeFirstTemplate() { const s = loadSettings(); return s.waTemplates.find((t) => t.id === s.lastTemplateId) || s.waTemplates[0]; }
function firstTemplateById(id) { const l = firstTemplates(); return l.find((t) => t.id === id) || l[0]; }
function newTemplateId() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
// the non-template fields are merge-saved so they never overwrite the template list
function saveSettings() {
  patchSettings({
    ctaHero: $('set-cta-hero').value,
    ctaBottom: $('set-cta-bottom').value,
    followUp: $('set-followup').value,
    waCap: Math.max(1, Math.min(50, parseInt($('set-wa-cap').value, 10) || 10)),
    grammarFix: $('set-grammar-fix').checked,
  });
}
// ---- first-message template manager (Templates panel) --------------------
let editingTplId = null;
function tplLabel(t) { return (t.name || 'Untitled') + (t.locked ? ' 🔒' : ''); }
function renderTemplateManager() {
  const list = firstTemplates();
  if (!editingTplId || !list.some((t) => t.id === editingTplId)) editingTplId = activeFirstTemplate().id;
  $('tpl-select').innerHTML = list.map((t) => `<option value="${esc(t.id)}"${t.id === editingTplId ? ' selected' : ''}>${esc(tplLabel(t))}</option>`).join('');
  const cur = firstTemplateById(editingTplId);
  $('tpl-name').value = cur.name;
  $('set-wa-msg').value = cur.body;
  $('tpl-del').disabled = list.length <= 1;
  applyTplLockUI(cur);
}
// reflect the locked/draft state: a locked template's MESSAGE is read-only (so its
// stats stay tied to fixed wording), but it can still be renamed or duplicated.
function applyTplLockUI(cur) {
  const locked = !!cur.locked;
  const ta = $('set-wa-msg');
  ta.readOnly = locked;
  ta.classList.toggle('locked', locked);
  $('tpl-lock').classList.toggle('hidden', locked);
  $('tpl-status').textContent = locked
    ? '🔒 Saved & locked. Rename it any time, or Duplicate it to make a different version.'
    : '✍️ Draft, editable. Save & lock it when you are happy, so its stats stay accurate.';
  $('tpl-status').classList.toggle('is-locked', locked);
}
function saveEditingTemplate() {
  const list = firstTemplates().map((t) => t.id === editingTplId
    ? { id: t.id, name: ($('tpl-name').value || 'Untitled').slice(0, 40), body: t.locked ? t.body : $('set-wa-msg').value, locked: !!t.locked }
    : t);
  patchSettings({ waTemplates: list });
}
(function initSettings() {
  const s = loadSettings();
  $('set-cta-hero').value = s.ctaHero;
  $('set-cta-bottom').value = s.ctaBottom;
  $('set-followup').value = s.followUp;
  $('set-wa-cap').value = s.waCap;
  $('set-grammar-fix').checked = s.grammarFix !== false;
  $('set-grammar-fix').addEventListener('change', saveSettings);
  ['set-cta-hero', 'set-cta-bottom', 'set-followup', 'set-wa-cap'].forEach((id) => $(id).addEventListener('input', saveSettings));
  // template manager wiring
  renderTemplateManager();
  $('set-wa-msg').addEventListener('input', saveEditingTemplate);
  $('tpl-name').addEventListener('input', () => {
    saveEditingTemplate();
    const o = $('tpl-select').options[$('tpl-select').selectedIndex];
    if (o) o.textContent = tplLabel({ name: $('tpl-name').value, locked: firstTemplateById(editingTplId).locked });
  });
  $('tpl-select').addEventListener('change', () => {
    editingTplId = $('tpl-select').value;
    renderTemplateManager();
  });
  $('tpl-add').addEventListener('click', () => {
    const list = firstTemplates().slice();
    const id = newTemplateId();
    list.push({ id, name: 'New template', body: '', locked: false }); // start empty + editable; placeholder prompts the wording
    patchSettings({ waTemplates: list });
    editingTplId = id;
    renderTemplateManager();
    $('tpl-name').focus(); $('tpl-name').select();
  });
  $('tpl-dup').addEventListener('click', () => {
    const cur = firstTemplateById(editingTplId);
    const id = newTemplateId();
    const list = firstTemplates().slice();
    list.push({ id, name: (cur.name + ' (copy)').slice(0, 40), body: cur.body, locked: false }); // a fresh editable copy
    patchSettings({ waTemplates: list });
    editingTplId = id;
    renderTemplateManager();
    $('tpl-name').focus(); $('tpl-name').select();
  });
  $('tpl-lock').addEventListener('click', () => {
    if (!$('set-wa-msg').value.trim()) { alert('Add a message before you save and lock this template.'); return; }
    if (!confirm('Save & lock "' + ($('tpl-name').value || 'this template') + '"?\n\nThe message becomes read-only so its performance stats stay tied to fixed wording. You can still rename it, and you can Duplicate it to make a different version.')) return;
    const list = firstTemplates().map((t) => t.id === editingTplId
      ? { id: t.id, name: ($('tpl-name').value || 'Untitled').slice(0, 40), body: $('set-wa-msg').value, locked: true }
      : t);
    patchSettings({ waTemplates: list });
    renderTemplateManager();
  });
  $('tpl-del').addEventListener('click', () => {
    const list = firstTemplates();
    if (list.length <= 1) { alert('You need at least one first-message template.'); return; }
    const cur = firstTemplateById(editingTplId);
    if (!confirm('Delete the template "' + (cur.name || 'Untitled') + '"?')) return;
    const next = list.filter((t) => t.id !== editingTplId);
    const patch = { waTemplates: next };
    if (loadSettings().lastTemplateId === editingTplId) patch.lastTemplateId = next[0].id; // send default can't point at a deleted one
    patchSettings(patch);
    editingTplId = next[0].id;
    renderTemplateManager();
  });
  $('set-wa-cap').addEventListener('change', () => {
    const v = parseInt($('set-wa-cap').value, 10) || 10;
    if (v > 10) alert('⚠️ Heads up: more than 10 WhatsApp sends a day raises the risk of another ban, especially on a number that has already been restricted.');
    updateWaToday();
  });
})();

// ---- auth (protects the paid /api/generate endpoint) ---------------------
function setAuthUI(on) {
  authed = on;
  $('gate').classList.toggle('hidden', on);          // full-screen gate hides the app until signed in
  $('logout-btn').classList.toggle('hidden', !on);
  if (!on) { setTimeout(() => { try { $('gate-user').focus(); } catch (e) {} }, 60); }
  if (on) { loadServerMockups(); loadHotLeads(); loadCallList(); } // saved mockups + warm-lead and call-list badges + card states
}

function showLoginMsg(text, kind) {
  const el = $('gate-msg');
  el.textContent = text;
  el.className = 'login-msg ' + (kind || '');
  el.classList.toggle('hidden', !text);
}

async function doLogin() {
  const username = $('gate-user').value.trim();
  const password = $('gate-pass').value;
  if (!password) { showLoginMsg('Enter your password.', 'err'); return; }
  $('gate-btn').disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Login failed');
    $('gate-pass').value = '';
    showLoginMsg('', '');
    setAuthUI(true);
  } catch (e) {
    showLoginMsg(e.message, 'err');
  } finally {
    $('gate-btn').disabled = false;
  }
}

$('gate-btn').addEventListener('click', doLogin);
$('gate-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gate-pass').focus(); });
$('gate-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('logout-btn').addEventListener('click', () => { setAuthUI(false); showLoginMsg('', ''); });

// check existing session on load (gate stays up until this confirms a valid cookie)
fetch('/api/login').then((r) => r.json()).then((d) => setAuthUI(!!d.authed)).catch(() => setAuthUI(false));

// ---- founding-member application (public landing form) -------------------
function openApply() { applyMsg('', ''); $('apply-modal').classList.remove('hidden'); setTimeout(() => { try { $('ap-name').focus(); } catch (e) {} }, 50); }
function closeApply() { $('apply-modal').classList.add('hidden'); }
function applyMsg(text, kind) { const el = $('apply-msg'); el.textContent = text; el.className = 'login-msg ' + (kind || ''); el.classList.toggle('hidden', !text); }
['apply-open', 'apply-open2', 'apply-open3'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', openApply); });
$('apply-close').addEventListener('click', closeApply);
$('apply-cancel').addEventListener('click', closeApply);
$('apply-submit').addEventListener('click', submitApply);

async function submitApply() {
  const name = $('ap-name').value.trim();
  const email = $('ap-email').value.trim();
  const phone = $('ap-phone').value.trim();
  const role = $('ap-role').value;
  const volume = $('ap-volume').value;
  const why = $('ap-why').value.trim();
  if (!name || !email || !phone || !role || !volume || !why) { applyMsg('Please fill in the required fields marked *.', 'err'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { applyMsg('Please enter a valid email address.', 'err'); return; }
  const payload = {
    name, email, phone, role, volume, why,
    jobtitle: $('ap-title').value.trim(),
    business: $('ap-biz').value.trim(),
    website: $('ap-web').value.trim(),
    channels: $('ap-channels').value.trim(),
    hp: $('ap-hp').value,
  };
  $('apply-submit').disabled = true;
  applyMsg('Sending…', '');
  try {
    const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong, please try again.');
    $('apply-form').innerHTML =
      '<div class="ap-done"><h3>Application received 🎉</h3>' +
      '<p>Thank you, we read every founder application personally. If you look like a great fit, we\'ll be in touch with your private demo and your locked-in founder rate. Keep an eye on your inbox.</p></div>';
  } catch (e) {
    applyMsg(e.message, 'err');
  } finally {
    $('apply-submit').disabled = false;
  }
}

// ---- search --------------------------------------------------------------
$('searchBtn').addEventListener('click', runSearch);
// brief visual feedback so it's obvious a refresh actually happened
async function refreshFeedback(btn, action) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⟳ Refreshing…';
  try { await action(); } catch (e) {}
  btn.textContent = '✓ Refreshed';
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1300);
}
$('refresh-results').addEventListener('click', (e) => refreshFeedback(e.currentTarget, () => renderResults(lastSearchResults)));
$('export-results').addEventListener('click', exportSearchCsv);
$('loadmore-btn').addEventListener('click', loadMoreResults);
$('sort-order').addEventListener('change', () => renderResults(lastSearchResults));
['industry', 'location'].forEach((id) =>
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); })
);

let lastSearchParams = null; // {industry, location, filters} so Load more can repeat it
let lastBatchFull = false;   // was the last batch a full page (more may exist)?
function currentSearchFilters() {
  const starBuckets = Array.from(document.querySelectorAll('.f-star:checked')).map((c) => Number(c.value));
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  return { website: $('f-website').value, phone: $('f-phone').value, email: $('f-email').value, ratingsFrom: num('f-ratingsFrom'), ratingsTo: num('f-ratingsTo'), starBuckets };
}
function searchExcludeIds() {
  const messagedMode = $('f-messaged').value;
  let ids = [];
  if (messagedMode && messagedMode !== 'any') {
    const m = loadMessaged();
    const cutoff = messagedMode === '3m' ? (Date.now() - 90 * 24 * 3600 * 1000) : 0;
    ids = Object.keys(m).filter((k) => k.indexOf('id:') === 0 && new Date(m[k].at).getTime() >= cutoff).map((k) => k.slice(3));
  }
  const blockedIds = Object.values(loadBlocked()).map((r) => r.placeId).filter(Boolean);
  return Array.from(new Set(ids.concat(blockedIds)));
}
async function runSearch() {
  const industry = $('industry').value.trim();
  const location = $('location').value.trim();
  if (!industry || !location) { alert('Please enter both an industry and a location.'); return; }
  lastSearchParams = { industry, location, filters: currentSearchFilters() };
  await doSearch(false);
}
async function loadMoreResults() { if (lastSearchParams) await doSearch(true); }
// big animated "results banner" so a powerful search doesn't get lost in a paragraph
function heroHTML(head, leads, scanned, areas, primaryLoc, primaryCount) {
  const multi = areas.length > 1;
  const chips = areas.map((a) => `<span>📍 ${esc(a)}</span>`).join('');
  const areasTile = multi ? `<div class="sh-stat"><b class="sh-num" data-to="${areas.length}">0</b><span>areas searched</span></div>` : '';
  const n = areas.length - 1;
  const subBlock = multi
    ? `<div class="sh-sub">${esc(primaryLoc)} alone only had ${primaryCount}.</div>` +
      `<div class="sh-dug">So I dug into ${n} nearby ${n === 1 ? 'area' : 'areas'} to find you more 🔥</div>`
    : `<div class="sh-sub">All found right in ${esc(primaryLoc)}.</div>`;
  return '<div class="search-hero"><div class="sh-head">' + head + '</div><div class="sh-stats">' +
    `<div class="sh-stat sh-lead"><b class="sh-num" data-to="${leads}">0</b><span>leads ready to contact</span></div>` +
    `<div class="sh-stat"><b class="sh-num" data-to="${scanned}">0</b><span>listings combed</span></div>` +
    areasTile + '</div>' + (multi ? `<div class="sh-areas">${chips}</div>` : '') + subBlock + '</div>';
}
function animateCounts(root) {
  root.querySelectorAll('.sh-num').forEach(function (n) {
    const to = parseInt(n.getAttribute('data-to'), 10) || 0;
    if (to <= 0) { n.textContent = '0'; return; }
    const dur = 850; let s = null;
    function step(ts) { if (s === null) s = ts; const p = Math.min((ts - s) / dur, 1); n.textContent = Math.round((1 - Math.pow(1 - p, 3)) * to); if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  });
}
async function doSearch(append) {
  if (!lastSearchParams) return;
  const { industry, location, filters } = lastSearchParams;
  const limit = Number($('f-limit').value || 20);
  let excludeIds = searchExcludeIds();
  if (append) {
    // exclude the ones already shown so Google digs deeper / into nearby areas
    const shown = lastSearchResults.map((b) => b.id).filter(Boolean);
    excludeIds = Array.from(new Set(excludeIds.concat(shown)));
  }
  const btn = append ? $('loadmore-btn') : $('searchBtn');
  btn.disabled = true;
  btn.textContent = append ? 'Loading…' : 'Searching…';
  if (!append) {
    $('summary').classList.remove('hidden');
    $('summary').textContent = `Searching Google for ${industry} in ${location}…`;
    $('results').innerHTML = '';
    lastSearchResults = [];
  }
  try {
    const resp = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ industry, location, limit, filters, excludeIds }) });
    const data = await resp.json();
    if (resp.status === 401) { setAuthUI(false); throw new Error('Please log in (top of the page) to search.'); }
    if (!resp.ok) throw new Error(data.error || 'Search failed');
    const results = data.results || [];
    lastBatchFull = results.length >= limit;
    if (append) {
      const have = new Set(lastSearchResults.map((b) => b.id));
      const fresh = results.filter((b) => !have.has(b.id));
      lastSearchResults = lastSearchResults.concat(fresh);
      if (!fresh.length) lastBatchFull = false;
    } else {
      lastSearchResults = results;
      const scanned = data.scanned || results.length;
      const primaryLoc = data.primaryLocation || location;
      const expanded = data.expandedLocations || [];
      const areaWord = expanded.length === 1 ? 'area' : 'areas';
      let html;
      if (results.length === 0) {
        const areasNote = expanded.length ? `, plus ${expanded.length} nearby ${areaWord} (${esc(expanded.join(', '))}),` : '';
        html = `<div class="search-hero sh-empty"><b>⚠️ No matches.</b> No ${esc(industry)} in ${esc(primaryLoc)}${areasNote} matched your filters (I scanned ${scanned} listings). Try loosening them: set Phone to "Has phone" (not "Mobile only"), or Website to "Any". Well-established businesses (solicitors, accountants, etc.) nearly all have a website, so "No website" + "Mobile only" together often returns nothing.</div>`;
      } else if (expanded.length) {
        const primaryCount = data.primaryCount != null ? data.primaryCount : 0;
        html = heroHTML('🚀 Deep search complete!', results.length, scanned, [primaryLoc].concat(expanded), primaryLoc, primaryCount);
      } else {
        html = heroHTML('✅ Nailed it!', results.length, scanned, [primaryLoc], primaryLoc, results.length);
      }
      $('summary').innerHTML = html;
      animateCounts($('summary'));
      saveRecentSearch({ date: new Date().toISOString(), industry, location, filters, matched: data.matched != null ? data.matched : results.length, limit });
      renderRecentSearches();
    }
    renderResults(lastSearchResults);
    if (append && !lastBatchFull) {
      const hero = $('summary').querySelector('.search-hero');
      if (hero && !hero.querySelector('.sh-note')) { const nn = document.createElement('div'); nn.className = 'sh-note'; nn.textContent = "That's everything Google has for this search."; hero.appendChild(nn); }
    }
    saveLastResults(); // survive a page reload (free restore, no credit)
  } catch (err) {
    if (append) { alert(err.message || 'Could not load more.'); }
    else { $('summary').textContent = ''; $('results').innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`; }
  } finally {
    btn.disabled = false;
    btn.textContent = append ? '⬇ Load more results' : 'Search businesses';
  }
}

function sortResults(list) {
  const mode = $('sort-order') ? $('sort-order').value : 'default';
  if (mode === 'default') return list;
  const arr = list.slice();
  const msgAt = (b) => { const mi = messagedInfo(b); return mi && mi.at ? new Date(mi.at).getTime() : null; };
  if (mode === 'notmsg') arr.sort((a, b) => (messagedInfo(a) ? 1 : 0) - (messagedInfo(b) ? 1 : 0)); // un-messaged first (stable)
  else if (mode === 'az') arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  else if (mode === 'za') arr.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
  else if (mode === 'msg-asc' || mode === 'msg-desc') {
    arr.sort((a, b) => { const x = msgAt(a); const y = msgAt(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return mode === 'msg-asc' ? x - y : y - x; });
  }
  return arr;
}
function renderResults(list) {
  lastSearchResults = list || [];
  const has = lastSearchResults.length > 0;
  $('refresh-results').classList.toggle('hidden', !has);
  $('export-results').classList.toggle('hidden', !has);
  $('sort-order').classList.toggle('hidden', !has);
  $('loadmore-wrap').classList.toggle('hidden', !(has && lastBatchFull));
  // index generated mockups so each result can show its status
  try { recentIndex = new Map(mergedRecent().map((r) => [normKey(r.name, r.location), r])); } catch (e) { recentIndex = new Map(); }
  const root = $('results');
  root.innerHTML = '';
  if (!has) { root.innerHTML = '<div class="empty">No businesses match these filters. Try loosening them.</div>'; return; }
  const shown = sortResults(lastSearchResults.filter((b) => !isBlocked(b))); // hide do-not-contact, then sort
  if (!shown.length) { root.innerHTML = '<div class="empty">Every match here is on your blocked list. Try a different search.</div>'; return; }
  shown.forEach((b) => root.appendChild(card(b)));
}

function card(b) {
  const el = document.createElement('div');
  el.className = 'card';
  const rec = recentIndex.get(normKey(b.name, b.location));
  const recVia = rec ? recentSentVia(rec) : '';
  const statusChip = rec
    ? (recVia ? '<span class="chip gensent">✓ Mockup sent</span>' : '<span class="chip genmade">✓ Mockup made · not sent</span>')
    : '';
  const phones = b.phones && b.phones.length
    ? b.phones.map((p) => `<div>📞 ${esc(p)}</div>`).join('')
    : '<div class="muted">📞 No phone listed</div>';
  const email = b.email ? `✉️ ${esc(b.email)}` : '<span class="muted">✉️ No email found</span>';
  const website = b.website
    ? `🌐 <a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website.replace(/^https?:\/\//, ''))}</a>`
    : '<span class="muted">🌐 No website</span>';

  el.innerHTML = `
    <h3>${esc(b.name)}</h3>
    <div class="cat">${esc(b.category)} · ${esc(b.location)}</div>
    <div class="chips">
      ${b.website ? '<span class="chip site">Has website</span>' : '<span class="chip no-site">No website</span>'}
      ${phoneChip(b)}
      ${b.email ? '<span class="chip email">Email</span>' : ''}
      <span class="chip rating">★ ${b.rating} (${b.userRatingsTotal})</span>
      ${statusChip}
    </div>
    <div class="meta">
      ${phones}
      <div>${email}</div>
      <div>${website}</div>
      <div>📍 ${esc(b.address)}</div>
      <div><a href="${esc(b.mapsUrl)}" target="_blank" rel="noopener">View on Google Maps ↗</a></div>
    </div>`;

  const mi = messagedInfo(b);
  if (mi) {
    const lab = document.createElement('div');
    lab.className = 'messaged-lab';
    lab.innerHTML = messagedLabel(mi);
    el.appendChild(lab);
  }

  // calls-first: the phone is the safe (and warmest) first touch
  const onList = isOnCallList(b, rec);
  const callBtn = document.createElement('button');
  callBtn.className = 'gen call-add' + (onList ? ' added' : '');
  callBtn.textContent = onList ? '✓ On call list' : '📞 Add to call list';
  callBtn.title = 'Queue this business for a phone call (the safest first contact)';
  if (onList) callBtn.disabled = true;
  else callBtn.addEventListener('click', () => addToCallList(b, rec, callBtn));
  el.appendChild(callBtn);

  const btn = document.createElement('button');
  btn.className = 'gen';
  btn.textContent = rec ? 'Regenerate mockup' : 'Generate website mockup';
  btn.addEventListener('click', () => openGenerateModal(b));
  el.appendChild(btn);

  // follow-up button: only once you've messaged them, and only after 24h
  if (mi) {
    const at = mi.at ? new Date(mi.at).getTime() : 0;
    const ready = at && (Date.now() - at) >= 24 * 3600 * 1000;
    const fb = document.createElement('button');
    fb.className = 'card-followup';
    if (ready && rec) {
      fb.textContent = '↩ Send follow-up message';
      fb.title = 'Opens WhatsApp/SMS with your follow-up message pre-filled, you press send';
      fb.addEventListener('click', () => doFollowUp(rec));
    } else {
      fb.disabled = true;
      fb.textContent = ready ? '↩ Follow-up: open the mockup to send' : '↩ Follow-up unlocks 24h after your first message';
    }
    el.appendChild(fb);
  }

  // once a mockup exists, you can Prowl + Pounce this business straight from here
  if (rec) {
    const acts = document.createElement('div');
    acts.className = 'card-acts';
    const lead = { slug: rec.id, name: b.name, location: b.location, category: b.category || '', phone: (b.phones && b.phones[0]) || '', mapsUrl: b.mapsUrl || '', viewUrl: rec.viewUrl, who: rec.personName };
    const pb = document.createElement('button'); pb.className = 'mini rc-prowl'; pb.textContent = '🐾 Prowl'; pb.addEventListener('click', () => openProwl(lead));
    const cb = document.createElement('button'); cb.className = 'mini rc-pounce'; cb.textContent = '🐆 Pounce'; cb.addEventListener('click', () => openPounce(lead));
    acts.appendChild(pb); acts.appendChild(cb);
    el.appendChild(acts);
  }
  const blockBtn = document.createElement('button');
  blockBtn.className = 'card-block';
  blockBtn.textContent = '🚫 Block (not interested)';
  blockBtn.title = 'Hide this business and never contact them';
  blockBtn.addEventListener('click', () => confirmBlock(b, () => renderResults(lastSearchResults)));
  el.appendChild(blockBtn);
  return el;
}

// ---- generate modal ------------------------------------------------------
function openGenerateModal(business) {
  if (!authed) {
    setAuthUI(false); // session expired, bring the login gate back up
    showLoginMsg('Your session ended, please sign in again.', 'err');
    return;
  }
  pendingBusiness = business;
  $('modal-biz').textContent = `${business.name}, ${business.category}, ${business.location}`;
  $('modal-name').value = '';
  $('modal-req').value = '';
  $('modal').classList.remove('hidden');
}
$('modal-cancel').addEventListener('click', () => $('modal').classList.add('hidden'));
$('modal-proceed').addEventListener('click', proceedGenerate);
$('regen-btn').addEventListener('click', regenerateMockup);

async function proceedGenerate() {
  const requirements = $('modal-req').value.trim();
  const personName = $('modal-name').value.trim();
  const business = Object.assign({}, pendingBusiness, { requirements });
  $('modal').classList.add('hidden');
  runGeneration(business, requirements, personName);
}

// regenerate a fresh version: reopens the generate popup pre-filled, so you can
// optionally add a comment on what to change before it runs (costs 1 credit)
function regenerateMockup() {
  if (!authed) { setAuthUI(false); showLoginMsg('Your session ended, please sign in again.', 'err'); return; }
  if (!currentBusiness) return;
  pendingBusiness = currentBusiness;
  $('modal-biz').textContent = `${currentBusiness.name}${currentBusiness.category ? ', ' + currentBusiness.category : ''}${currentBusiness.location ? ', ' + currentBusiness.location : ''}`;
  $('modal-name').value = currentPersonName || '';
  $('modal-req').value = currentRequirements || '';
  $('preview').classList.add('hidden'); // close the preview so the popup sits on top
  $('modal').classList.remove('hidden');
}

async function runGeneration(business, requirements, personName) {
  const settings = loadSettings();
  currentBusiness = business;
  currentRequirements = requirements || '';
  currentPersonName = personName || '';

  $('preview-title').textContent = personName
    ? `Hey ${personName} 👋, mockup for ${business.name}`
    : `Mockup · ${business.name}`;
  $('preview').classList.remove('hidden');
  $('preview-warn').classList.add('hidden');
  $('preview-links').classList.add('hidden');
  $('wa-send').classList.add('hidden');
  $('sms-send').classList.add('hidden');
  $('wa-note').classList.add('hidden');
  startGenProgress(business);

  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business, requirements, personName, ctaHero: settings.ctaHero, ctaBottom: settings.ctaBottom }),
    });
    let data = {};
    try { data = await resp.json(); } catch (e) { data = {}; }
    if (resp.status === 401) {
      setAuthUI(false);
      throw new Error('Your session expired, please log in again (top of the page).');
    }
    if (!resp.ok) throw new Error(errText(data, resp.status));

    stopGenProgress();
    $('preview-body').innerHTML = `<img src="${esc(data.imageUrl)}" alt="Website mockup" />`;
    $('img-url').value = data.imageUrl;
    $('open-view').href = data.viewUrl || data.imageUrl;
    $('download-img').href = data.imageUrl + '?download=1';
    $('preview-links').classList.remove('hidden');
    currentSlug = data.slug || data.id || data.imageUrl;
    setupWhatsApp(business, data.viewUrl || data.imageUrl, personName);
    saveRecent({
      id: data.slug || data.id || data.imageUrl,
      placeId: business.id || '',
      date: new Date().toISOString(),
      name: business.name,
      category: business.category,
      location: business.location,
      searchLoc: business.searchLoc || '',
      phones: business.phones || [],
      personName: personName,
      imageUrl: data.imageUrl,
      viewUrl: data.viewUrl || data.imageUrl,
    });
    renderRecent();
  } catch (err) {
    stopGenProgress();
    const msg = err && err.message ? err.message : 'Generation failed';
    reportError('generate · ' + (business.name || ''), msg);
    showGenError(msg);
  }
}

// animated "thinking" steps while the mockup generates (keeps you engaged ~15-25s)
let genProgressTimers = [];
function stopGenProgress() { genProgressTimers.forEach(clearTimeout); genProgressTimers = []; }
function startGenProgress(business) {
  stopGenProgress();
  const niche = String(business.category || business.industry || 'this business').toLowerCase();
  const steps = [
    `Reading ${business.name || 'the business'}'s details`,
    `Studying what works best for ${niche}`,
    `Choosing an on-brand colour palette & layout`,
    `Generating a realistic, on-brand photo`,
    `Composing the hero section & headline`,
    `Adding their logo, contact details & call-to-action`,
    `Compiling the preview code`,
    `Personalising the copy & tone`,
    `Optimising for mobile & desktop`,
    `Running a quick quality check`,
    `Adding final touches & hosting it`,
  ];
  const delays = [0, 1200, 2600, 4000, 12000, 13500, 15000, 16500, 18000, 19500, 21000]; // when each line appears (ms)
  $('preview-body').innerHTML =
    '<div class="genprog"><div id="genprog-list"></div>' +
    '<p class="genprog-foot"><small>This usually takes around 20 to 40 seconds, hang tight.</small></p></div>';
  const listEl = $('genprog-list');
  steps.forEach((text, i) => {
    const timer = setTimeout(() => {
      if (!listEl.isConnected) return;
      const prev = listEl.children[i - 1];
      if (prev) { const ic = prev.querySelector('.gp-ic'); if (ic) ic.outerHTML = '<span class="gp-ic gp-done">✓</span>'; }
      const row = document.createElement('div');
      row.className = 'gp-row';
      row.innerHTML = '<span class="gp-ic"><span class="spinner sm"></span></span><span class="gp-text">' + esc(text) + '…</span>';
      listEl.appendChild(row);
    }, delays[i]);
    genProgressTimers.push(timer);
  });
}

// turn a server error payload (string OR Vercel's {code,message} object) into text
function errText(data, status) {
  const e = data && data.error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') return e.message || e.code || JSON.stringify(e);
  return 'The server hit an error (HTTP ' + status + '). This is usually a timeout while the AI image generates, please retry.';
}

// error panel with a Retry button that unlocks after a 45s countdown
let genRetryTimer = null;
function clearGenRetry() { if (genRetryTimer) { clearInterval(genRetryTimer); genRetryTimer = null; } }
function showGenError(msg) {
  clearGenRetry();
  $('preview-body').innerHTML =
    `<div class="empty">⚠️ ${esc(msg)}<br/><br/>` +
    `<button id="gen-retry" class="primary" disabled>Retry in 45s</button><br/>` +
    `<small class="muted">If it keeps failing, copy the message above and paste it to me so I can fix it.</small></div>`;
  const btn = $('gen-retry');
  let n = 45;
  genRetryTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) { clearGenRetry(); btn.disabled = false; btn.textContent = 'Retry now'; }
    else { btn.textContent = 'Retry in ' + n + 's'; }
  }, 1000);
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    clearGenRetry();
    if (currentBusiness) runGeneration(currentBusiness, currentRequirements, currentPersonName);
    else proceedGenerate();
  });
}

// best-effort error notification (emails via SendGrid if configured server-side)
function reportError(context, message) {
  try {
    fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: context, message: message, url: location.href, when: new Date().toISOString() }),
    }).catch(() => {});
  } catch (e) { /* never let reporting break the UI */ }
}

// ---- WhatsApp click-to-send (you press send; mobiles only) ----------------
function toWaNumber(phone) {
  let d = String(phone || '').replace(/[^\d]/g, ''); // digits only (drops +)
  if (d.startsWith('00')) d = d.slice(2);            // 0044… → 44…
  if (d.startsWith('0')) d = '44' + d.slice(1);      // 07… → 447…
  else if (!d.startsWith('44')) d = '44' + d;        // bare national (rare)
  return d;
}
// Title-case an industry, keeping known acronyms all-caps (mot → MOT, dog groomers → Dog Groomers)
const INDUSTRY_ACRONYMS = new Set(['mot', 'pat', 'epc', 'hvac', 'cctv', 'hgv', 'pcv', 'it', 'seo', 'ppc', 'tv', 'uk', 'dj', 'pa', 'hr']);
function titleCaseIndustry(s) {
  return String(s || '').trim().split(/\s+/).map((w) => {
    const lw = w.toLowerCase();
    if (INDUSTRY_ACRONYMS.has(lw)) return lw.toUpperCase();
    return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
  }).join(' ');
}
// capitalise the first letter of each word (wolverhampton → Wolverhampton,
// west bromwich → West Bromwich) without lowercasing the rest (keeps WV2, etc.)
function titleCaseLocation(s) {
  return String(s || '').trim().split(/\s+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}
// Make a business name read naturally. KEEP IN SYNC with lib/names.js (server),
// including the HBN_WORDS list. Splits run-together names by recognising common
// business words ("jjhomecarwash" -> "JJ Home Car Wash", "m1plumbing&heating" ->
// "M1 Plumbing & Heating"), camelCase ("PerformanceCarValeting"), spaces &/and/+//,
// Title-Cases all-lowercase names (leaves MOT / Marks & Spencer), and trims a
// keyword-stuffed overlong name. SAFE: if a split isn't confident, the name is
// left unchanged rather than mangled.
var HBN_WORDS = new Set(('home homes house houses mobile local pro professional expert experts master masters quick fast best premier prime quality reliable friendly family the all total complete perfect super smart easy direct first prestige elite classic modern fresh clean bright shine sparkle gleam ' +
  'car cars auto autos van vans dog dogs pet pets garden gardens window windows door doors roof roofs drive driveway driveways kitchen kitchens bathroom bathrooms floor floors wall walls gutter gutters fence fences gate gates oven ovens carpet carpets blind blinds tyre tyres wheel wheels brick brickwork hair nails beauty ' +
  'wash washing valet valeting clean cleaning care repair repairs fitting fitters installation installations removal removals service services solution solutions maintenance grooming detailing polishing painting decorating plumbing plumber plumbers heating electrical electrician roofing gardening landscaping building builders plastering tiling flooring fencing paving glazing rendering scaffolding catering refurbishment alloy recovery transport haulage skip skips waste rubbish ' +
  'and of').split(' '));
function hbnTc(w) { if (!w) return w; if (w.length <= 3 && !/[aeiou]/.test(w) && /^[a-z]+$/.test(w)) return w.toUpperCase(); return w.charAt(0).toUpperCase() + w.slice(1); }
function hbnSplit(tok) {
  if (tok.length < 6) return tok;
  var out = [], brand = '', i = 0;
  while (i < tok.length) {
    var m = '';
    for (var L = Math.min(15, tok.length - i); L > 2; L--) { var c = tok.slice(i, i + L); if (HBN_WORDS.has(c)) { m = c; break; } }
    if (m) { if (brand) { out.push(brand); brand = ''; } out.push(m); i += m.length; } else { brand += tok.charAt(i); i++; }
  }
  if (brand) out.push(brand);
  var nd = []; for (var k = 0; k < out.length; k++) { if (!HBN_WORDS.has(out[k])) nd.push(k); }
  if (out.length >= 2 && (nd.length === 0 || (nd.length === 1 && nd[0] === 0 && out[0].length <= 10))) return out.join(' ');
  return tok;
}
var HBN_LEGAL = new Set('ltd limited llp plc llc inc incorporated co company cic cio'.split(' '));
var HBN_FLUFF = new Set('independent professional certified registered qualified experienced reliable trusted established genuine approved accredited insured dependable'.split(' '));
var HBN_CONNECT = new Set(['and', 'of', 'the']);
function hbnNorm(w) { return w.toLowerCase().replace(/[^a-z]/g, ''); }
function hbnStripFiller(raw) {
  var toks = raw.split(' ');
  var kept = toks.filter(function (w) { return !HBN_LEGAL.has(hbnNorm(w)); }); // legal suffixes (Ltd...) always go
  if (kept.some(function (w) { var n = hbnNorm(w); return n && !HBN_CONNECT.has(n); })) toks = kept;
  var kept2 = toks.filter(function (w) { return !HBN_FLUFF.has(hbnNorm(w)); }); // fluff (Independent...) only if 2+ real words remain
  var meaningful = kept2.filter(function (w) { var n = hbnNorm(w); return n && !HBN_CONNECT.has(n); });
  if (meaningful.length >= 2) toks = kept2;
  var s = toks.join(' ').replace(/\s*([&/+])\s*([&/+])\s*/g, ' $1 ').replace(/^\s*[&/+]\s*/, '').replace(/\s*[&/+]\s*$/, '').replace(/\s+\band\b\s*$/i, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}
function humaniseBusinessName(name) {
  let raw = String(name == null ? '' : name).trim();
  if (!raw) return raw;
  raw = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  raw = raw.replace(/\s*&\s*/g, ' & ').replace(/\s*\/\s*/g, ' / ').replace(/\s*\+\s*/g, ' + ').replace(/\s*\band\b\s*/gi, ' and ');
  raw = raw.split(' ').map(function (t) { return (/^[a-z0-9]+$/.test(t) && t.length >= 6) ? hbnSplit(t) : t; }).join(' ');
  raw = raw.replace(/\s{2,}/g, ' ').trim();
  raw = hbnStripFiller(raw); // drop legal suffixes (Ltd) + fluff (Independent) so it reads casually
  if (!/[A-Z]/.test(raw)) {
    raw = raw.split(' ').map(function (w) { return (w === '&' || w === '/' || w === '+' || w === 'and' || w === 'of') ? w : hbnTc(w); }).join(' ');
  }
  if (raw.length <= 34) return raw;
  const segments = raw.split(/\s*(?:,|&|\/|\+|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return raw;
  let out = segments[0];
  if ((out + ' & ' + segments[1]).length <= 40) out += ' & ' + segments[1];
  return out;
}
function fillWaMessage(tpl, business, link, personName) {
  const greet = String(personName || '').trim();
  let out = String(tpl || '')
    .replace(/\{name\}/g, greet) // empty when no name → cleaned up below
    .replace(/\{business\}/g, humaniseBusinessName(business.name) || 'there')
    .replace(/\{category\}/g, titleCaseIndustry(business.category || business.industry || 'businesses'))
    .replace(/\{location\}/g, titleCaseLocation(business.location) || 'your area')
    .replace(/\{link\}/g, link || '');
  // tidy up an empty name: "Hi ," → "Hi," and collapse any double spaces
  out = out.replace(/[ \t]+([,.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  return out;
}
function smsNumber(phone) {
  return String(phone || '').replace(/[^\d+]/g, ''); // keep digits (+ kept if present)
}
// ---- ✨ AI Grammar Fix: tidy the first message so {category} reads naturally ----
// Cheap gpt-4o-mini pass (api/grammar). URLs are masked so the AI can't touch the
// tracking link. Cached per message for the session. Any failure returns the original.
const gfCache = new Map();
function grammarFixMessage(raw) {
  const text = String(raw || '');
  if (gfCache.has(text)) return Promise.resolve(gfCache.get(text));
  const urls = [];
  const masked = text.replace(/https?:\/\/\S+/g, (m) => { urls.push(m); return '[[U' + (urls.length - 1) + ']]'; });
  return fetch('/api/grammar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: masked }) })
    .then((r) => r.json())
    .then((j) => {
      let out = (j && j.text) || masked;
      out = out.replace(/\[\[U(\d+)\]\]/g, (_, i) => (urls[Number(i)] != null ? urls[Number(i)] : ''));
      gfCache.set(text, out);
      return out;
    })
    .catch(() => text);
}
// add ?c=<channel> to the preview link so opens are attributed to how it was sent
function tagLink(link, channel) {
  if (!link) return link;
  return link + (link.indexOf('?') === -1 ? '?' : '&') + 'c=' + channel;
}
// remember which channel a mockup was last sent on (so follow-ups default right
// even before it's opened). Keyed by slug in the local recent list.
function recordSentVia(slug, channel) {
  if (!slug) return;
  const list = loadRecent();
  const r = list.find((x) => x.id === slug);
  if (r) { r.sentVia = channel; try { localStorage.setItem('aiwp_recent', JSON.stringify(list)); } catch (e) {} renderRecent(); }
}
let firstSendCtx = null; // business/link/person/phone for the current mockup send row
let sendToken = 0;       // guards against a stale grammar-fix overwriting a newer render
function setupWhatsApp(business, link, personName) {
  const wa = $('wa-send');
  const sms = $('sms-send');
  const note = $('wa-note');
  const picker = $('wa-template');
  const phone = (business.phones && business.phones[0]) || '';
  const mobile = phone && window.BizData.isUkMobile(phone);
  note.classList.remove('hidden');
  if (!mobile) {
    wa.classList.add('hidden');
    sms.classList.add('hidden');
    if (picker) picker.classList.add('hidden');
    note.textContent = phone
      ? `📱 WhatsApp/SMS hidden because ${phone} is a landline, not a mobile, they only work on mobiles. Use the image URL or view link in an email instead.`
      : '📱 WhatsApp/SMS hidden, no mobile number listed for this business. Use the image URL or view link instead.';
    return;
  }
  firstSendCtx = { business, link, personName, phone };
  // template picker: list all first-message templates, default to the last-used one.
  // Hidden when there's only one (nothing to choose).
  const list = firstTemplates();
  if (picker) {
    if (list.length > 1) {
      const activeId = activeFirstTemplate().id;
      picker.innerHTML = list.map((t) => `<option value="${esc(t.id)}"${t.id === activeId ? ' selected' : ''}>${esc(t.name || 'Untitled')}</option>`).join('');
      picker.classList.remove('hidden');
    } else {
      picker.classList.add('hidden');
    }
  }
  wa.classList.remove('hidden');
  sms.classList.remove('hidden');
  note.textContent = 'Opens WhatsApp, or your Messages app for SMS, to ' + phone + ' with your message + link pre-filled, you review and press send.';
  renderFirstSendLinks(activeFirstTemplate().body);
}
// build the wa/sms hrefs from a chosen template body (+ optional AI grammar fix)
function renderFirstSendLinks(tplBody) {
  if (!firstSendCtx) return;
  const { business, link, personName, phone } = firstSendCtx;
  const wa = $('wa-send');
  const sms = $('sms-send');
  const myToken = ++sendToken;
  const waMsg = fillWaMessage(tplBody, business, tagLink(link, 'w'), personName);
  const smsMsg = fillWaMessage(tplBody, business, tagLink(link, 's'), personName);
  wa.href = 'https://wa.me/' + toWaNumber(phone) + '?text=' + encodeURIComponent(waMsg);
  sms.href = 'sms:' + smsNumber(phone) + '?&body=' + encodeURIComponent(smsMsg);
  // ✨ AI Grammar Fix (default on): the raw hrefs above work instantly; this swaps in
  // the cleaned version a moment later, unless a newer render has superseded this one.
  if (loadSettings().grammarFix !== false) {
    grammarFixMessage(waMsg).then((fixed) => {
      if (myToken !== sendToken || !fixed || fixed === waMsg) return;
      wa.href = 'https://wa.me/' + toWaNumber(phone) + '?text=' + encodeURIComponent(fixed);
      sms.href = 'sms:' + smsNumber(phone) + '?&body=' + encodeURIComponent(fixed.replace(tagLink(link, 'w'), tagLink(link, 's')));
    });
  }
}
// log the send server-side (channel + exact time) for later send-time analysis
function recordSendServer(channel) {
  if (!currentSlug) return;
  try {
    const u = '/api/track?slug=' + encodeURIComponent(currentSlug) + '&e=sent&c=' + channel;
    if (navigator.sendBeacon) navigator.sendBeacon(u); else fetch(u, { keepalive: true }).catch(() => {});
  } catch (e) {}
}
// ---- WhatsApp ban protection: hard daily cap + once-a-day warning ----------
// Cold WhatsApp violates WhatsApp policy and gets numbers restricted at volume,
// manual or not (it happened, 2026-06-12). Every wa.me click in the app goes
// through this guard: a confirm on the first send of the day, then a HARD block
// at the daily cap (default 10, set in Templates). Counter is per device.
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function waLog() { let l = {}; try { l = JSON.parse(localStorage.getItem('aiwp_wa_log') || '{}'); } catch (e) {} return l.date === todayKey() ? l : { date: todayKey(), count: 0 }; }
function updateWaToday() { const el = $('wa-today'); if (el) el.textContent = waLog().count + ' of ' + loadSettings().waCap; }
function waGuardAllow() {
  const cap = loadSettings().waCap;
  const log = waLog();
  if (log.count >= cap) {
    alert('🛑 WhatsApp send blocked.\n\nYou have hit today\'s hard cap (' + cap + '). Sending more risks another ban on your number.\n\nUse the 📞 Call List or SMS instead. The cap resets at midnight.');
    return false;
  }
  if (log.count === 0) {
    if (!confirm('⚠️ WhatsApp ban risk (shown once a day).\n\nCold WhatsApp messages to people who never opted in are against WhatsApp\'s rules and can get your number restricted, even when you press send yourself. Prefer the 📞 Call List or SMS for first contact, and keep WhatsApp for people who already replied.\n\nDaily hard cap: ' + cap + '. Carry on with send 1 of ' + cap + '?')) return false;
  }
  log.count += 1;
  try { localStorage.setItem('aiwp_wa_log', JSON.stringify(log)); } catch (e) {}
  updateWaToday();
  return true;
}
// one capture-phase gate for EVERY wa.me link in the app (preview send, warm
// leads, lead profile, dossier), nothing can bypass the cap
document.addEventListener('click', function (ev) {
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href^="https://wa.me"]') : null;
  if (!a) return;
  if (!waGuardAllow()) { ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); }
}, true);
// record the send channel + mark the business as messaged when you click a send button
$('wa-send').addEventListener('click', () => { recordSentVia(currentSlug, 'w'); markMessaged(currentBusiness, 'w'); recordSendServer('w'); });
$('sms-send').addEventListener('click', () => { recordSentVia(currentSlug, 's'); markMessaged(currentBusiness, 's'); recordSendServer('s'); });
// send-time template picker: remember the choice as the new default + rebuild the links
if ($('wa-template')) $('wa-template').addEventListener('change', () => {
  const id = $('wa-template').value;
  patchSettings({ lastTemplateId: id });
  renderFirstSendLinks(firstTemplateById(id).body);
});
// record a send from ANY surface (warm leads, lead profile, follow-up) so the
// "messaged" stat is accurate, not just the original preview button
function trackSentServer(slug, channel) {
  if (!slug) return;
  try { const u = '/api/track?slug=' + encodeURIComponent(slug) + '&e=sent&c=' + channel; if (navigator.sendBeacon) navigator.sendBeacon(u); else fetch(u, { keepalive: true }).catch(() => {}); } catch (e) { /* best effort */ }
}
function markSent(slug, biz, channel) {
  if (slug) recordSentVia(slug, channel);
  if (biz) markMessaged(biz, channel);
  trackSentServer(slug, channel);
}

// ---- "already messaged" tracking (per device, keyed by Google place id) ----
function loadMessaged() { try { return JSON.parse(localStorage.getItem('aiwp_messaged') || '{}'); } catch (e) { return {}; } }
function bizKey(b) {
  if (b && b.id) return 'id:' + b.id;
  return 'nm:' + String((b && b.name) || '').toLowerCase().trim() + '|' + String((b && b.location) || '').toLowerCase().trim();
}
function messagedInfo(b) { return loadMessaged()[bizKey(b)] || null; }
function channelName(via) { return via === 'w' ? 'WhatsApp' : via === 's' ? 'SMS' : via === 'e' ? 'email' : ''; }
function markMessaged(b, channel) {
  if (!b) return;
  const m = loadMessaged();
  const key = bizKey(b);
  const now = new Date().toISOString();
  const prev = m[key] || {};
  const channels = Object.assign({}, prev.channels);
  if (prev.via && !channels[prev.via]) channels[prev.via] = prev.at || now; // migrate old single-channel records
  if (channel) channels[channel] = now;                                     // record/refresh this channel's date
  m[key] = { name: b.name || prev.name || '', channels, at: now };          // `at` = most recent contact (used by the 3-month filter)
  try { localStorage.setItem('aiwp_messaged', JSON.stringify(m)); } catch (e) {}
  if (lastSearchResults.length) renderResults(lastSearchResults); // refresh visible cards
}

// ---- block list (do-not-contact, per device) -----------------------------
// Keyed by name+location (stable across search results, warm leads & mockups),
// storing the Google place id too so the server can exclude blocked leads.
function loadBlocked() { try { return JSON.parse(localStorage.getItem('aiwp_blocked') || '{}'); } catch (e) { return {}; } }
function blockKey(b) { return 'nm:' + String((b && b.name) || '').toLowerCase().trim() + '|' + String((b && b.location) || '').toLowerCase().trim(); }
function isBlocked(b) { return !!loadBlocked()[blockKey(b)]; }
function blockBiz(b) {
  if (!b || !b.name) return;
  const m = loadBlocked();
  m[blockKey(b)] = { name: b.name || '', location: b.location || '', placeId: b.id || b.placeId || '', at: new Date().toISOString() };
  try { localStorage.setItem('aiwp_blocked', JSON.stringify(m)); } catch (e) {}
  renderBlocked();
}
function unblockKey(key) {
  const m = loadBlocked(); delete m[key];
  try { localStorage.setItem('aiwp_blocked', JSON.stringify(m)); } catch (e) {}
  renderBlocked();
}
function confirmBlock(b, after) {
  if (!b || !b.name) return;
  if (!confirm('Block ' + b.name + '?\n\nThey will be hidden from searches and you will not be able to message them. You can unblock later from Templates, Blocked contacts.')) return;
  blockBiz(b);
  if (typeof after === 'function') after();
}
function renderBlocked() {
  const el = $('blocked-list'); if (!el) return;
  const m = loadBlocked();
  const keys = Object.keys(m).sort((a, b) => String(m[b].at || '').localeCompare(String(m[a].at || '')));
  if (!keys.length) { el.innerHTML = '<div class="empty">No blocked contacts yet. Use the 🚫 Block button on a business to add one.</div>'; return; }
  el.innerHTML = keys.map((k) => {
    const r = m[k];
    return `<div class="blk-row"><div class="blk-main"><b>${esc(r.name || '')}</b>${r.location ? ' · ' + esc(r.location) : ''}<div class="blk-when">Blocked ${esc(fmtDate(r.at))}</div></div><button class="ghost sm blk-unblock" data-key="${esc(k)}">Unblock</button></div>`;
  }).join('');
  Array.prototype.forEach.call(el.querySelectorAll('.blk-unblock'), (btn) => btn.addEventListener('click', () => unblockKey(btn.dataset.key)));
}
// build the "You messaged them via …" label HTML (date+time on its own line(s))
function messagedLabel(mi) {
  const order = ['w', 's', 'e'];
  const used = mi.channels ? order.filter((c) => mi.channels[c]) : [];
  if (used.length === 1) {
    const c = used[0];
    return '✓ You messaged them via ' + channelName(c) + '<span class="ml-when">' + esc(fmtDate(mi.channels[c])) + '</span>';
  }
  if (used.length > 1) {
    return '✓ You messaged them via ' + used.map(channelName).join(' & ') +
      used.map((c) => '<span class="ml-when">' + channelName(c) + ' · ' + esc(fmtDate(mi.channels[c])) + '</span>').join('');
  }
  // legacy records (single `via`, or none)
  if (mi.via) return '✓ You messaged them via ' + channelName(mi.via) + '<span class="ml-when">' + esc(fmtDate(mi.at)) + '</span>';
  return '✓ You messaged them<span class="ml-when">' + esc(fmtDate(mi.at)) + '</span>';
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

$('preview-close').addEventListener('click', () => { clearGenRetry(); stopGenProgress(); $('preview').classList.add('hidden'); });
$('copy-img').addEventListener('click', () => {
  const el = $('img-url');
  el.select();
  navigator.clipboard.writeText(el.value).then(
    () => { $('copy-img').textContent = 'Copied!'; setTimeout(() => ($('copy-img').textContent = 'Copy'), 1500); },
    () => {}
  );
});

// ---- recent mockups (saved on this device) -------------------------------
function loadRecent() {
  try { return JSON.parse(localStorage.getItem('aiwp_recent') || '[]'); } catch (e) { return []; }
}
function saveRecent(item) {
  let list = loadRecent().filter((r) => r.id !== item.id); // dedupe by id
  list.unshift(item);
  list = list.slice(0, 30);
  try { localStorage.setItem('aiwp_recent', JSON.stringify(list)); } catch (e) {}
}
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const tz = { timeZone: 'Europe/London' }; // always show UK time (GMT/BST)
  const day = d.toLocaleDateString('en-GB', Object.assign({ day: '2-digit', month: 'short', year: 'numeric' }, tz));
  const time = d.toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit' }, tz));
  return day + ' · ' + time;
}
let serverRecent = []; // mockups loaded from the server (all devices)
function mergedRecent() {
  const serverMap = new Map(serverRecent.map((r) => [r.id, r]));
  const out = new Map();
  // local entries first (they carry phone/personName); fold in server open-stats
  loadRecent().forEach((r) => {
    const sv = serverMap.get(r.id);
    out.set(r.id, sv ? Object.assign({}, r, { opens: sv.opens, lastOpen: sv.lastOpen, ctaClicks: sv.ctaClicks, signups: sv.signups, declines: sv.declines, sent: sv.sent, platform: sv.platform }) : r);
  });
  serverRecent.forEach((r) => { if (!out.has(r.id)) out.set(r.id, r); });
  return Array.from(out.values())
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 40);
}
async function loadServerMockups() {
  try {
    const r = await fetch('/api/mockups');
    if (!r.ok) return;
    const d = await r.json();
    serverRecent = (d.mockups || []).map((m) => ({
      id: m.slug || m.img,
      date: m.date,
      name: m.name,
      category: m.category || '',
      location: m.loc || '',
      searchLoc: m.searchLoc || '',
      phones: m.phone ? [m.phone] : [],
      personName: m.who || '',
      imageUrl: m.img,
      viewUrl: m.viewUrl || m.img,
      opens: m.opens || 0,
      lastOpen: m.lastOpen || null,
      ctaClicks: m.ctaClicks || 0,
      signups: m.signups || 0,
      declines: m.declines || 0,
      sent: m.sent || 0,
      platform: m.platform || '',
    }));
    renderRecent();
  } catch (e) { /* keep showing local-only list */ }
}
function engagementBadge(r) {
  if ((r.ctaClicks || 0) > 0) return '<span class="eng hot">🔥 Demo clicked</span>';
  if ((r.opens || 0) > 0) {
    return `<span class="eng seen">👁 Viewed${r.opens > 1 ? ' ×' + r.opens : ''}</span>` +
      (r.lastOpen ? `<div class="eng-when">${esc(fmtDate(r.lastOpen))}</div>` : '');
  }
  return '<span class="eng none">Not viewed yet</span>';
}
function renderRecent() {
  const list = mergedRecent();
  const sec = $('recent');
  const tb = $('recent-rows');
  if (!list.length) { sec.classList.add('hidden'); tb.innerHTML = ''; return; }
  sec.classList.remove('hidden');
  tb.innerHTML = '';
  list.forEach((r) => {
    const blk = isBlocked(r);
    const lead = { slug: r.id, name: r.name, location: r.location, category: r.category || '', phone: (r.phones && r.phones[0]) || '', mapsUrl: r.mapsUrl || '', viewUrl: r.viewUrl, who: r.personName };
    const biz = { name: r.name, category: r.category, location: r.location, phones: r.phones || [], id: r.placeId };
    const engCell = blk
      ? `<div class="eng-cell">${engagementBadge(r)}<span class="blk-flag">🚫 Blocked</span></div>`
      : `<div class="eng-cell">${engagementBadge(r)}<button class="followup" title="Send a follow-up message">↩ Follow up</button></div>`;
    const actsCell = blk
      ? `<div class="recent-acts"><button class="ghost recent-open">Open ↗</button><button class="ghost sm rc-unblock">Unblock</button></div>`
      : `<div class="recent-acts"><button class="mini rc-prowl" title="AI lead intelligence on this business">🐾 Prowl</button><button class="mini rc-pounce" title="Build them an AI website">🐆 Pounce</button><button class="ghost recent-open">Open ↗</button><button class="ghost recent-regen" title="Regenerate the mockup (add a tweak first)">🔄 Regenerate</button><button class="ghost sm rc-block" title="Mark not interested, hide & stop contacting">🚫 Block</button></div>`;
    const tr = document.createElement('tr');
    if (blk) tr.className = 'tr-blocked';
    tr.innerHTML =
      `<td><img class="recent-thumb" src="${esc(r.imageUrl)}" alt="mockup" /></td>` +
      `<td>${esc(fmtDate(r.date))}</td>` +
      `<td><button class="lead-name" data-slug="${esc(r.id)}">${esc(r.name || '')}</button>${r.personName ? '<div class="who">' + esc(r.personName) + '</div>' : ''}</td>` +
      `<td>${esc(r.location || '')}</td>` +
      `<td>${sentBadge(r)}</td>` +
      `<td>${engCell}</td>` +
      `<td>${actsCell}</td>`;
    const ln = tr.querySelector('.lead-name'); if (ln) ln.addEventListener('click', () => openLead(lead));
    tr.querySelector('.recent-open').addEventListener('click', () => openRecent(r));
    tr.querySelector('.recent-thumb').addEventListener('click', () => openRecent(r));
    if (blk) {
      tr.querySelector('.rc-unblock').addEventListener('click', () => { unblockKey(blockKey(r)); renderRecent(); });
    } else {
      tr.querySelector('.followup').addEventListener('click', () => doFollowUp(r));
      tr.querySelector('.rc-prowl').addEventListener('click', () => openProwl(lead));
      tr.querySelector('.rc-pounce').addEventListener('click', () => openPounce(lead));
      tr.querySelector('.recent-regen').addEventListener('click', () => openGenerateModal(biz));
      tr.querySelector('.rc-block').addEventListener('click', () => confirmBlock(biz, () => renderRecent()));
    }
    tb.appendChild(tr);
  });
}
// has a mockup been sent? prefer the per-row sentVia, fall back to the messaged map
function recentSentVia(r) {
  if (r.sentVia) return r.sentVia;
  const mi = messagedInfo({ name: r.name, location: r.location, id: r.placeId });
  if (mi && mi.channels) { const u = ['w', 's', 'e'].find((c) => mi.channels[c]); if (u) return u; }
  if (mi && mi.via) return mi.via;
  return '';
}
function sentBadge(r) {
  const via = recentSentVia(r);
  if (via) return `<span class="sent-yes">✓ Sent${channelName(via) ? ' · ' + channelName(via) : ''}</span>`;
  return '<span class="sent-no">Not sent yet</span>';
}
function openRecent(r) {
  const business = { name: r.name, category: r.category, location: r.location, phones: r.phones || [], id: r.placeId || undefined };
  currentBusiness = business;
  currentSlug = r.id;
  $('preview-title').textContent = r.personName
    ? `Hey ${r.personName} 👋, mockup for ${r.name}`
    : `Mockup · ${r.name}`;
  $('preview').classList.remove('hidden');
  $('preview-warn').classList.add('hidden');
  $('preview-body').innerHTML = `<img src="${esc(r.imageUrl)}" alt="Website mockup" />`;
  $('img-url').value = r.imageUrl;
  $('open-view').href = r.viewUrl || r.imageUrl;
  $('download-img').href = r.imageUrl + '?download=1';
  $('preview-links').classList.remove('hidden');
  $('wa-send').classList.add('hidden');
  $('sms-send').classList.add('hidden');
  $('wa-note').classList.add('hidden');
  setupWhatsApp(business, r.viewUrl || r.imageUrl, r.personName);
}
// ↩ Follow up: opens the same channel they engaged on (or you sent on), with the
// follow-up message pre-filled. Channel priority: how they OPENED (?p=) → how you
// SENT (sentVia) → default WhatsApp (mobile). You still press send (compliant).
function doFollowUp(r) {
  const phone = (r.phones && r.phones[0]) || '';
  const mobile = phone && window.BizData.isUkMobile(phone);
  let channel = r.platform || r.sentVia || (mobile ? 'w' : 'e');
  if ((channel === 'w' || channel === 's') && !mobile) channel = 'e'; // can't text a landline
  const business = { name: r.name, category: r.category, location: r.location, id: r.placeId };
  const link = tagLink(r.viewUrl || r.imageUrl, channel);
  const msg = fillWaMessage(loadSettings().followUp, business, link, r.personName);
  if (channel === 'w' && !waGuardAllow()) return; // hard daily WhatsApp cap
  markSent(r.id, business, channel); // a follow-up is still a send, record it
  if (channel === 's') {
    window.location.href = 'sms:' + smsNumber(phone) + '?&body=' + encodeURIComponent(msg);
  } else if (channel === 'e') {
    window.open('mailto:?subject=' + encodeURIComponent('Following up, ' + (r.name || 'your website preview')) +
      '&body=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/' + toWaNumber(phone) + '?text=' + encodeURIComponent(msg), '_blank');
  }
}
$('recent-refresh').addEventListener('click', (e) => refreshFeedback(e.currentTarget, loadServerMockups)); // re-check open status from the server
$('recent-clear').addEventListener('click', () => {
  if (!confirm('Clear your recent mockups list? (The mockups themselves stay live at their links.)')) return;
  try { localStorage.removeItem('aiwp_recent'); } catch (e) {}
  renderRecent();
});
renderRecent();
renderBlocked();

// ---- recent searches (saved on this device, one-click re-run) -------------
function loadRecentSearches() {
  try { return JSON.parse(localStorage.getItem('aiwp_searches') || '[]'); } catch (e) { return []; }
}
function searchSig(industry, location, filters) {
  return (String(industry) + '|' + String(location) + '|' + JSON.stringify(filters || {})).toLowerCase();
}
function saveRecentSearch(item) {
  const sig = searchSig(item.industry, item.location, item.filters);
  let list = loadRecentSearches().filter((r) => searchSig(r.industry, r.location, r.filters) !== sig);
  list.unshift(item);
  list = list.slice(0, 20);
  try { localStorage.setItem('aiwp_searches', JSON.stringify(list)); } catch (e) {}
}
function filterSummary(f) {
  f = f || {};
  const parts = [];
  const wl = { none: 'No website', has: 'Has website' };
  const pl = { has: 'Has phone', mobile: 'Mobile', landline: 'Landline', none: 'No phone' };
  const el = { has: 'Has email', none: 'No email' };
  if (wl[f.website]) parts.push(wl[f.website]);
  if (pl[f.phone]) parts.push(pl[f.phone]);
  if (el[f.email]) parts.push(el[f.email]);
  if (f.ratingsFrom != null && f.ratingsFrom !== '' || f.ratingsTo != null && f.ratingsTo !== '') {
    parts.push('ratings ' + (f.ratingsFrom != null && f.ratingsFrom !== '' ? f.ratingsFrom : '0') + '–' + (f.ratingsTo != null && f.ratingsTo !== '' ? f.ratingsTo : '∞'));
  }
  if (f.starBuckets && f.starBuckets.length) parts.push(f.starBuckets.slice().sort().map((s) => s + '★').join('/'));
  return parts.join(' · ') || 'No filters';
}
function renderRecentSearches() {
  const list = loadRecentSearches();
  const sec = $('recent-searches');
  const tb = $('rs-rows');
  if (!list.length) { sec.classList.add('hidden'); tb.innerHTML = ''; return; }
  sec.classList.remove('hidden');
  tb.innerHTML = '';
  list.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${esc(fmtDate(r.date))}</td>` +
      `<td>${esc(r.industry || '')}</td>` +
      `<td>${esc(r.location || '')}</td>` +
      `<td class="rs-filters">${esc(filterSummary(r.filters))}</td>` +
      `<td>${r.matched != null ? esc(String(r.matched)) : ''}</td>` +
      `<td><button class="primary rs-run">Run again ↻</button></td>` +
      `<td><button class="rs-del" title="Delete" aria-label="Delete this search">🗑</button></td>`;
    tr.querySelector('.rs-run').addEventListener('click', () => runRecentSearch(r));
    tr.querySelector('.rs-del').addEventListener('click', () => deleteRecentSearch(r));
    tb.appendChild(tr);
  });
}
function deleteRecentSearch(r) {
  if (!confirm(`Delete this saved search?\n\n${r.industry} · ${r.location}`)) return;
  const sig = searchSig(r.industry, r.location, r.filters);
  const list = loadRecentSearches().filter((x) => searchSig(x.industry, x.location, x.filters) !== sig);
  try { localStorage.setItem('aiwp_searches', JSON.stringify(list)); } catch (e) {}
  renderRecentSearches();
}
function runRecentSearch(r) {
  const f = r.filters || {};
  $('industry').value = r.industry || '';
  $('location').value = r.location || '';
  $('f-website').value = f.website || 'any';
  $('f-phone').value = f.phone || 'any';
  $('f-email').value = f.email || 'any';
  $('f-ratingsFrom').value = (f.ratingsFrom != null ? f.ratingsFrom : '');
  $('f-ratingsTo').value = (f.ratingsTo != null ? f.ratingsTo : '');
  const sb = f.starBuckets || [];
  document.querySelectorAll('.f-star').forEach((c) => { c.checked = sb.indexOf(Number(c.value)) !== -1; });
  if (r.limit) $('f-limit').value = String(r.limit);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  runSearch();
}
$('rs-clear').addEventListener('click', () => {
  if (!confirm('Clear your recent searches list?')) return;
  try { localStorage.removeItem('aiwp_searches'); } catch (e) {}
  renderRecentSearches();
});
renderRecentSearches();

// ---- performance dashboard -----------------------------------------------
// Generic best-practice tips (NOT based on your data, general outreach advice)
const GENERIC_TIPS = [
  'Tradespeople are often easiest to reach early (7–8am) or after they finish on site (5–7pm), they\'re rarely at a desk during the day.',
  'Tuesday to Thursday usually beats Mondays (catching up) and Fridays (winding down) for B2B replies.',
  'Keep the first message short and low-pressure, you\'re offering something free, not selling.',
  'Most replies come from a single polite follow-up 2–3 days later, use the ↩ Follow up button for those who didn\'t open.',
  'WhatsApp tends to feel more personal than SMS for sole traders and often gets a warmer response.',
  'Avoid weekends for trades that work Mon–Fri; weekends are fine for consumer-facing ones (salons, groomers, cleaners).',
];
// ---- top navigation (views) ----
let currentDashDays = 0;
let lastDashboard = null;
function showView(name) {
  ['search', 'messages', 'performance', 'hotleads', 'leads', 'websites', 'calls', 'enquiries'].forEach((v) => $('view-' + v).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'performance' && !lastDashboard) loadDashboard(currentDashDays); // lazy-load on first open only
  if (name === 'messages') { renderBlocked(); updateWaToday(); }
  if (name === 'leads') loadLeads();
  if (name === 'websites') loadWebsites();
  if (name === 'calls') loadCallList();
  if (name === 'enquiries') loadEnquiries();
}
document.querySelectorAll('.navbtn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('.dash-rbtn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.dash-rbtn').forEach((x) => x.classList.toggle('active', x === b));
  currentDashDays = Number(b.dataset.days) || 0;
  loadDashboard(currentDashDays);
}));
$('dash-csv').addEventListener('click', () => { if (lastDashboard) exportDashboardCsv(lastDashboard.rows || []); });

async function loadDashboard(days) {
  if (days == null) days = currentDashDays;
  const body = $('dash-body');
  body.innerHTML = '<div class="muted" style="padding:14px 2px">Loading your stats…</div>';
  try {
    const r = await fetch('/api/dashboard?days=' + (days || 0));
    if (r.status === 401) { setAuthUI(false); body.innerHTML = '<div class="muted" style="padding:14px 2px">Please sign in to view the dashboard.</div>'; return; }
    lastDashboard = await r.json();
    renderDashboard(lastDashboard);
  } catch (e) {
    body.innerHTML = '<div class="empty">Could not load the dashboard. Try again shortly.</div>';
  }
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportDashboardCsv(rows) {
  if (!rows || !rows.length) { alert('No activity to export yet.'); return; }
  const head = ['Business', 'Sent via', 'Sent (UK)', 'Viewed (UK)', 'Opens', 'Demo click', 'Sign-up click', 'Status'];
  const lines = [head.map(csvCell).join(',')];
  const statuses = (lastDashboard && lastDashboard.statuses) || {};
  const recMap = new Map(); try { mergedRecent().forEach((x) => recMap.set(x.id, x)); } catch (e) { /* ignore */ }
  rows.forEach((r) => {
    const via = String(r.sentVia || '').split(',').map(channelName).filter(Boolean).join(' & ');
    const rec = recMap.get(r.slug);
    const status = (rec && isBlocked(rec)) ? 'Blocked' : (statuses[r.slug] ? statusLabel(statuses[r.slug]) : '');
    lines.push([r.name, via, r.sentAt ? fmtDate(r.sentAt) : '', r.openedAt ? fmtDate(r.openedAt) : '', r.opens, r.demoClicks > 0 ? 'Yes' : 'No', r.signedUp ? 'Yes' : 'No', status].map(csvCell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'sitepounce-activity.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---- warm leads (its own page) ----
let lastHotLeads = [];
// exact stored Google Maps URL if we have it, else a name+location search link
function mapsLink(l) {
  if (l.mapsUrl) return l.mapsUrl;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(((l.name || '') + ' ' + (l.location || '')).trim());
}
function hotLeadCardHTML(l) {
  const phone = l.phone || '';
  const mobile = phone && window.BizData.isUkMobile(phone);
  if (isBlocked(l)) {
    return `<div class="hl-card hl-blocked"><div class="hl-main"><b>${esc(l.name)}</b>${l.location ? ' · ' + esc(l.location) : ''}<div class="hl-meta">🚫 Blocked, you marked them not interested</div></div><div class="hl-acts"><button class="hl-act hl-unblock" data-key="${esc(blockKey(l))}">Unblock</button></div></div>`;
  }
  let acts = `<button class="hl-act hl-prowl" data-slug="${esc(l.slug)}">🐾 Prowl</button>`;
  acts += `<button class="hl-act hl-pounce" data-slug="${esc(l.slug)}">🐆 Pounce</button>`;
  if (mobile) {
    const biz = { name: l.name, location: l.location, category: '' };
    const msg = fillWaMessage(loadSettings().followUp, biz, tagLink(l.viewUrl, 'w'), l.who);
    acts += `<a class="hl-act wa" target="_blank" rel="noopener" href="https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(msg)}">📱 WhatsApp</a>`;
  }
  if (phone) acts += `<a class="hl-act" href="tel:${esc(phone)}">📞 Call</a>`;
  acts += `<a class="hl-act" target="_blank" rel="noopener" href="${esc(mapsLink(l))}">📍 Maps</a>`;
  acts += `<a class="hl-act" target="_blank" rel="noopener" href="${esc(l.viewUrl)}">View ↗</a>`;
  acts += `<button class="hl-act hl-block" data-slug="${esc(l.slug)}" title="Mark not interested, hide & stop contacting">🚫 Block</button>`;
  const signed = !!l.signupAt;
  const badge = signed
    ? `<span class="hl-tag signup" title="Clicked &quot;Yes, sign me up&quot; on their preview (opens your subscribe page). An interest click, not a payment.">🤑 Clicked Sign Up</span>`
    : (l.demoAt ? `<span class="hl-tag demo" title="Clicked the &quot;Request a demo&quot; button on their preview (opens your booking page). An interest click, not a confirmed booking.">🔥 Requested a demo</span>` : '');
  const stChip = l.status ? `<span class="hl-tag lchip ${statusClass(l.status)}" title="Your status for this lead">${esc(statusLabel(l.status))}</span>` : '';
  const dim = (l.status === 'not-interested' || l.status === 'lost' || l.status === 'invalid-phone' || l.status === 'declined') ? ' hl-dim' : '';
  const signal = signed
    ? `🤑 clicked “Sign me up” ${esc(fmtDate(l.signupAt))}`
    : `requested demo ${esc(fmtDate(l.demoAt))}`;
  return `<div class="hl-card${signed ? ' hl-signup' : ''}${dim}"><div class="hl-main"><b class="lead-name" data-slug="${esc(l.slug)}">${esc(l.name)}</b>${l.location ? ' · ' + esc(l.location) : ''}${badge}${stChip}<div class="hl-meta">${phone ? '📞 ' + esc(phone) : 'No phone on file'} · ${signal}</div></div><div class="hl-acts">${acts}</div></div>`;
}
function renderHotLeads(list) {
  lastHotLeads = list || [];
  const n = lastHotLeads.length;
  const badge = $('hot-count');
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
  hotCount = n;
  signupCount = lastHotLeads.filter((l) => l.signupAt).length;
  updateTabTitle();
  const body = $('hot-body');
  if (!n) { body.innerHTML = '<div class="empty">No warm leads yet. When a prospect opens their preview and clicks "Request a demo", or "Yes, sign me up", they\'ll appear here with their contact details, ready to follow up.</div>'; return; }
  const intro = signupCount
    ? `<p class="muted view-sub"><b>🤑 ${signupCount} ${signupCount === 1 ? 'prospect' : 'prospects'} clicked “Sign me up”</b>, call these first. Below them, prospects who clicked "Request a demo".</p>`
    : '<p class="muted view-sub">These prospects opened their preview and clicked "Request a demo", your warmest leads. Follow up fast.</p>';
  const defnote = '<p class="dash-defnote">ⓘ <b>Requested a demo</b> = clicked the "Request a demo" button on their preview (which opens your booking page). <b>Clicked Sign Up</b> = clicked "Yes, sign me up" (opens your subscribe page). Both are interest clicks, <b>not</b> a confirmed booking or a payment.</p>';
  body.innerHTML = intro + defnote + lastHotLeads.map(hotLeadCardHTML).join('');
}
async function loadHotLeads() {
  try {
    const r = await fetch('/api/hotleads');
    if (!r.ok) return;
    const d = await r.json();
    renderHotLeads(d.hotLeads || []);
  } catch (e) { /* keep showing whatever's there */ }
}
$('hot-refresh').addEventListener('click', (e) => refreshFeedback(e.currentTarget, loadHotLeads));

// ---- 🐾 Prowl: lead intelligence dossier ----
$('hot-body').addEventListener('click', (e) => {
  const b = e.target.closest('.hl-prowl');
  if (b) { const lead = lastHotLeads.find((l) => l.slug === b.dataset.slug); if (lead) openProwl(lead); return; }
  const p = e.target.closest('.hl-pounce');
  if (p) { const lead = lastHotLeads.find((l) => l.slug === p.dataset.slug); if (lead) openPounce(lead); return; }
  const bl = e.target.closest('.hl-block');
  if (bl) { const lead = lastHotLeads.find((l) => l.slug === bl.dataset.slug); if (lead) confirmBlock(lead, () => renderHotLeads(lastHotLeads)); return; }
  const ub = e.target.closest('.hl-unblock');
  if (ub) { unblockKey(ub.dataset.key); renderHotLeads(lastHotLeads); return; }
  const nm = e.target.closest('.lead-name');
  if (nm) { const lead = lastHotLeads.find((l) => l.slug === nm.dataset.slug); if (lead) openLead(lead); return; }
  const wa = e.target.closest('.hl-act.wa');
  if (wa) { const card = wa.closest('.hl-card'); const slug = card && card.querySelector('.lead-name') && card.querySelector('.lead-name').dataset.slug; const lead = lastHotLeads.find((l) => l.slug === slug); if (lead) markSent(slug, lead, 'w'); } // let the link still open WhatsApp
});
$('prowl-close').addEventListener('click', () => {
  $('prowl-modal').classList.add('hidden');
  // back on the Call List? refresh so "Prowl" flips to "View intel ✓" and any status change shows
  if ($('view-calls') && !$('view-calls').classList.contains('hidden')) loadCallList();
});
function startProwlProgress() {
  const steps = ['Checking Companies House', 'Pulling Google reviews & score', 'Scouting nearby competitors', 'Reading recent reviews', 'Writing your sales briefing'];
  $('prowl-body').innerHTML = '<div class="genprog"><div>' +
    steps.map((s) => `<div class="gp-row"><span class="gp-ic"><span class="spinner sm"></span></span><span class="gp-text">${esc(s)}…</span></div>`).join('') +
    '</div><p class="genprog-foot"><small>Gathering AI intel… ~10–20 seconds.</small></p></div>';
}
function prowlFetch(lead, refresh) {
  return fetch('/api/prowl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: lead.slug, name: lead.name, location: lead.location, category: lead.category || '', phone: lead.phone || '', refresh: !!refresh }) })
    .then((r) => r.json().then((j) => ({ status: r.status, j })));
}
function openProwl(lead) {
  $('prowl-title').textContent = '🐾 Prowl · ' + lead.name;
  $('prowl-modal').classList.remove('hidden');
  startProwlProgress();
  prowlFetch(lead, false)
    .then(({ status, j }) => { if (status !== 200) throw new Error(j.error || 'Prowl failed'); renderDossier(j.dossier, lead); })
    .catch((e) => { $('prowl-body').innerHTML = `<div class="empty">⚠️ ${esc(e && e.message ? e.message : 'Prowl failed')}</div>`; });
}
function renderDossier(d, lead) {
  const ch = d.companiesHouse || {};
  const g = d.google || {};
  const comps = d.competitors || [];
  const snapshot = ch.found
    ? `<b>${esc(ch.name)}</b>${ch.type ? ' · ' + esc(ch.type) : ''} · established <b>${esc(fmtDateShort(ch.established))}</b> · ${esc(ch.status || '')}${ch.director ? ' · director <b>' + esc(ch.director) + '</b>' : ''}`
    : `<span class="muted">${esc(ch.note || 'No Companies House record (likely a sole trader).')}</span>`;
  let compTable = '';
  if (comps.length) {
    const maxRev = Math.max(1, g.reviews || 0, ...comps.map((c) => c.reviews || 0));
    const rank = 1 + comps.filter((c) => (c.reviews || 0) > (g.reviews || 0)).length; // lead's rank by reviews
    const bar = (n) => `<div class="rev-cell"><div class="rev-bar"><span style="width:${Math.round(((n || 0) / maxRev) * 100)}%"></span></div><span class="rev-n">${n || 0}</span></div>`;
    const youRow = `<tr class="dos-you"><td><b>${esc(d.business.name)} (you)</b></td><td>❌ No website</td><td>${bar(g.reviews)}</td><td>${g.rating}★</td></tr>`;
    const rows = comps.map((c) => `<tr><td>${esc(c.name)}</td><td>✅ <a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 28))}</a></td><td>${bar(c.reviews)}</td><td>${c.score}★</td></tr>`).join('');
    compTable = `<h3>How they stack up against nearby competitors</h3><div class="dos-rank">They rank <b>#${rank} of ${comps.length + 1}</b> on Google reviews in this area.</div><div class="recent-scroll"><table class="recent-table dos-table"><thead><tr><th>Business</th><th>Website</th><th>Google reviews</th><th>Score</th></tr></thead><tbody>${youRow}${rows}</tbody></table></div>`;
  }
  const services = (d.services && d.services.length) ? `<h3>What they do</h3><div class="chips">${d.services.map((s) => `<span class="chip site">${esc(s)}</span>`).join('')}</div>` : '';
  const strengths = (d.strengths && d.strengths.length) ? `<div class="dos-block"><h3>✅ Acknowledge first (builds rapport)</h3><div class="cue-list">${d.strengths.map((s) => `<div class="cue sev-good">${esc(s)}</div>`).join('')}</div></div>` : '';
  const weak = (d.weaknesses && d.weaknesses.length) ? `<div class="dos-block"><h3>🎯 Where they're losing out</h3><div class="cue-list">${d.weaknesses.map((w) => `<div class="cue sev-${w.severity === 'high' ? 'high' : 'med'}">${esc(w.label)}</div>`).join('')}</div></div>` : '';
  const ammo = (d.ammunition && d.ammunition.length) ? `<div class="dos-ammo"><h3>💬 Personalised AI talking points</h3><ul class="say-list">${d.ammunition.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '';
  const objections = (d.objections && d.objections.length) ? `<div class="dos-block dos-obj"><h3>🛡️ If they push back</h3>${d.objections.map((o) => `<div class="obj-item"><div class="obj-q">“${esc(o.objection)}”</div><div class="obj-a">${esc(o.response)}</div></div>`).join('')}</div>` : '';
  const opener = d.openingLine ? `<div class="dos-open"><h3>☎️ Your AI opener</h3><p>${esc(d.openingLine)}</p></div>` : '';
  // contact details + quick actions (so you can act on the intel right here)
  const b = d.business || {};
  const phone = (lead && lead.phone) || b.phone || '';
  const mobile = phone && window.BizData.isUkMobile(phone);
  const loc = b.location || (lead && lead.location) || '';
  const mapsU = g.mapsUrl || (lead && lead.mapsUrl) || mapsLink({ name: b.name, location: loc });
  let cActs = '';
  if (phone) cActs += `<a class="dos-act call" href="tel:${esc(phone)}">📞 Call ${esc(phone)}</a>`;
  if (mobile) { const msg = fillWaMessage(loadSettings().followUp, { name: b.name, location: loc, category: b.category }, tagLink((lead && lead.viewUrl) || '', 'w'), (lead && lead.who) || ''); cActs += `<a class="dos-act wa" target="_blank" rel="noopener" href="https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(msg)}">📱 WhatsApp</a>`; }
  cActs += `<a class="dos-act" target="_blank" rel="noopener" href="${esc(mapsU)}">📍 Maps</a>`;
  const contact = `<div class="dos-contact"><div class="dos-cline">${phone ? '📞 <b>' + esc(phone) + '</b>' : '<span class="muted">No phone on file</span>'}${loc ? ' · ' + esc(loc) : ''}</div><div class="dos-acts">${cActs}</div></div>`;
  $('prowl-body').innerHTML =
    contact +
    `<div class="dos-rep">⭐ Google: <b>${g.reviews}</b> reviews at <b>${g.rating}★</b>${g.mapsUrl ? ' · <a href="' + esc(g.mapsUrl) + '" target="_blank" rel="noopener">📍 Maps</a>' : ''}${g.website ? '' : ' · <b>no website</b>'}${d.reputationSummary ? ', ' + esc(d.reputationSummary) : ''}</div>` +
    opener + strengths + weak + ammo + objections +
    compTable + services +
    `<div class="dos-snap">${snapshot}</div>` +
    `<div class="dos-foot"><span class="muted">Prowled ${esc(fmtDate(d.generatedAt))}</span> <button id="prowl-pounce" class="primary sm">🐆 Pounce, build their website</button> <button id="prowl-rerun" class="ghost">↻ Re-run</button></div>` +
    '<div id="prowl-notes"></div>';
  const rr = $('prowl-rerun');
  if (rr) rr.addEventListener('click', () => { startProwlProgress(); prowlFetch(lead, true).then(({ j }) => renderDossier(j.dossier || {}, lead)).catch(() => {}); });
  const pb = $('prowl-pounce');
  if (pb) pb.addEventListener('click', () => { $('prowl-modal').classList.add('hidden'); openPounce(lead); });
  renderProwlNotes(lead); // status + timestamped notes right in the dossier (take notes while you call)
}
// CRM block inside the Prowl popup: same /api/note store as the Lead Profile and
// Call List, so a status or note made mid-call shows everywhere. Own ids (pn-*)
// because the Lead Profile modal can be open underneath.
function renderProwlNotes(lead) {
  const el = $('prowl-notes'); if (!el || !lead || !lead.slug) return;
  fetch('/api/note?slug=' + encodeURIComponent(lead.slug)).then((r) => r.json()).catch(() => ({})).then((d) => {
    const note = (d && d.note) || {};
    const cur = note.status || '';
    const comments = (note.comments || []).slice().reverse();
    el.innerHTML = '<div class="lead-notes-inner"><h3 class="ln-h">📝 Status & call notes</h3>' +
      '<div class="ln-row"><label>Status</label>' +
      `<select id="pn-status">${LEAD_STATUSES.map((o) => `<option value="${o[0]}"${o[0] === cur ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>` +
      '<span class="ln-saved" id="pn-saved"></span></div>' +
      '<div class="ln-add"><textarea id="pn-comment" rows="2" placeholder="Take notes while you talk, each one is saved with the date + time…"></textarea><button id="pn-add-btn" class="primary sm">Add note</button></div>' +
      `<div class="ln-log">${comments.length ? comments.map((c) => `<div class="ln-item"><div class="ln-when">${esc(fmtDate(c.at))}</div><div class="ln-text">${esc(c.text)}</div></div>`).join('') : '<div class="muted">No notes yet.</div>'}</div></div>`;
    const save = (payload) => {
      const sv = $('pn-saved'); if (sv) sv.textContent = 'Saving…';
      fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ slug: lead.slug }, payload)) })
        .then(() => {
          if (callsData && payload.status !== undefined) callsData.statuses[lead.slug] = payload.status;
          renderProwlNotes(lead);
        })
        .catch(() => { const s3 = $('pn-saved'); if (s3) s3.textContent = '⚠️ Failed'; });
    };
    const st = $('pn-status'); if (st) st.addEventListener('change', (e) => save({ status: e.target.value }));
    const ab = $('pn-add-btn'); if (ab) ab.addEventListener('click', () => { const t = ($('pn-comment').value || '').trim(); if (t) save({ comment: t }); });
  });
}

// ---- 🐆 Pounce: build a real 1-page website for the lead ----
$('pounce-close').addEventListener('click', () => $('pounce-modal').classList.add('hidden'));
let pounceProgTimers = [];
function stopPounceProgress() { pounceProgTimers.forEach(clearTimeout); pounceProgTimers = []; }
function startPounceProgress(lead) {
  stopPounceProgress();
  const who = (lead && lead.name) ? lead.name : 'this business';
  const steps = [
    'Researching ' + who + ' online',
    'Studying their Google Business profile',
    'Pulling in their best photos',
    'Checking each photo for quality',
    'Reading their 5★ reviews',
    'Sizing up nearby competitors',
    'Working out what makes them stand out',
    'Writing tailored website copy',
    'Curating the hero image',
    'Designing and laying out the page',
    'Publishing a private preview',
  ];
  const body = $('pounce-body');
  body.innerHTML = '<div class="genprog"><div class="gp-list"></div>' +
    '<p class="genprog-foot"><small>Doing the clever stuff. Building a full website usually takes around a minute, sometimes a little longer.</small></p></div>';
  const listEl = body.querySelector('.gp-list');
  const span = 44000; const n = steps.length; // spread steps so there is almost always movement
  steps.forEach((text, i) => {
    const at = Math.round((i / n) * span);
    pounceProgTimers.push(setTimeout(() => {
      if (!listEl.isConnected) return;
      const prev = listEl.children[i - 1];
      if (prev) { const ic = prev.querySelector('.gp-ic'); if (ic) ic.outerHTML = '<span class="gp-ic gp-done">✓</span>'; }
      const row = document.createElement('div');
      row.className = 'gp-row';
      row.innerHTML = '<span class="gp-ic"><span class="spinner sm"></span></span><span class="gp-text">' + esc(text) + '…</span>';
      listEl.appendChild(row);
    }, at));
  });
}
let lastPounceOpts = {};
function pounceFetch(lead, refresh, opts) {
  const payload = Object.assign({ slug: lead.slug, name: lead.name, location: lead.location, category: lead.category || '', phone: lead.phone || '', refresh: !!refresh }, opts || {});
  return fetch('/api/pounce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then((r) => r.json().then((j) => ({ status: r.status, j })));
}
function pounceHeroNote(src) {
  if (src === 'google') return '🖼️ Hero: their own Google photo';
  if (src === 'generated') return '✨ Hero: AI-curated (no good photo on Google)';
  if (src === 'google-unvetted') return '🖼️ Hero: their Google photo (unchecked)';
  return '';
}
// optional pre-build questions
const POUNCE_ACCENTS = [['', 'Auto (recommended)'], ['blue', 'Blue'], ['green', 'Green'], ['red', 'Red'], ['purple', 'Purple'], ['teal', 'Teal'], ['slate', 'Slate'], ['amber', 'Amber']];
const ACCRED_BY_TRADE = [
  [/electric/i, ['NICEIC Approved', 'NAPIT Registered', 'Part P Certified']],
  [/gas|boiler|heating|plumb/i, ['Gas Safe Registered', 'OFTEC Registered', 'CIPHE Member']],
  [/roof/i, ['NFRC Member']],
  [/build|construct|renovat|extension/i, ['FMB Member', 'TrustMark Registered']],
  [/window|glaz|conservatory/i, ['FENSA Registered', 'CERTASS']],
  [/pest/i, ['BPCA Member']],
  [/lock|security/i, ['MLA Approved']],
  [/garden|landscap|tree|paving|driveway/i, ['Marshalls Approved']],
];
const ACCRED_COMMON = ['Checkatrade Member', 'Which? Trusted Trader', 'TrustMark Registered', 'Fully Insured', 'Guaranteed Workmanship'];
function suggestAccreditations(category) {
  const set = [];
  ACCRED_BY_TRADE.forEach((pair) => { if (pair[0].test(category || '')) pair[1].forEach((x) => { if (!set.includes(x)) set.push(x); }); });
  ACCRED_COMMON.forEach((x) => { if (!set.includes(x)) set.push(x); });
  return set;
}
function pounceQuestionsHTML(lead) {
  return `<div class="pq">
    <p class="muted pq-intro">Optional, tweak the build below, or just hit <b>Build my site</b> for smart defaults.${lead && lead.prowled === false ? '' : ''}</p>
    <div class="pq-grid">
      <div class="pq-fld"><label>Accent colour</label><select id="pq-accent">${POUNCE_ACCENTS.map((a) => `<option value="${a[0]}">${a[1]}</option>`).join('')}</select></div>
      <div class="pq-fld"><label>Add an FAQ section?</label><label class="pq-toggle"><input id="pq-faq" type="checkbox"> Yes, generate FAQs</label></div>
      <div class="pq-fld wide"><label>Services to highlight</label><input id="pq-highlight" type="text" placeholder="e.g. EV chargers, rewires, fuse boards"></div>
      <div class="pq-fld wide"><label>Their standout selling point</label><input id="pq-usp" type="text" placeholder="e.g. 24/7 emergency callout · 10-year guarantee"></div>
      <div class="pq-fld wide"><label>Special offer banner <span class="muted">(optional)</span></label><input id="pq-offer" type="text" placeholder="e.g. £50 off your first job this month"></div>
      <div class="pq-fld wide"><label>Accreditations they actually hold <span class="muted">(tick only real ones)</span></label>
        <div class="pq-accred">${suggestAccreditations(lead && lead.category).map((a) => `<label class="pq-chip"><input type="checkbox" class="pq-acc" value="${esc(a)}"> ${esc(a)}</label>`).join('')}</div></div>
      <div class="pq-fld"><label>📥 Send enquiries to <span class="muted">(business owner's email, blank = you)</span></label><input id="pq-leademail" type="email" placeholder="owner@theirbusiness.co.uk"></div>
      <div class="pq-fld"><label>Their contact name <span class="muted">(optional)</span></label><input id="pq-leadname" type="text" placeholder="e.g. Dave"></div>
      <div class="pq-fld wide"><label>Anything to emphasise in the wording? <span class="muted">(shapes the copy only)</span></label><textarea id="pq-notes" rows="2" placeholder="e.g. family run since 2005, eco-friendly products, free callouts"></textarea></div>
    </div>
    <p class="muted pq-photonote">📸 Photos are pulled from their Google profile (we pick the best ones), or AI-generated if those are weak. Using the business's own photos, or before / after shots, needs them to send the images first (coming soon). The notes box steers the wording, not the photos or sections.</p>
    <div class="pq-actions"><button id="pq-build" class="primary">🐆 Build my site →</button><button id="pq-skip" class="ghost sm">Skip, smart defaults</button></div>
  </div>`;
}
function collectPounceOpts() {
  const v = (id) => { const el = $(id); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : ''; };
  const accreditations = Array.prototype.slice.call(document.querySelectorAll('.pq-acc:checked')).map((el) => el.value);
  return { accent: v('pq-accent'), faq: v('pq-faq'), highlightServices: v('pq-highlight'), usp: v('pq-usp'), offer: v('pq-offer'), notes: v('pq-notes'), accreditations, leadEmail: v('pq-leademail'), leadName: v('pq-leadname') };
}
function buildPounce(lead, opts, refresh) {
  lastPounceOpts = opts || {};
  startPounceProgress(lead);
  pounceFetch(lead, refresh, opts)
    .then(({ status, j }) => { stopPounceProgress(); if (status !== 200) throw new Error(j.error || 'Could not build the site'); renderPounceResult(j, lead); })
    .catch((e) => { stopPounceProgress(); $('pounce-body').innerHTML = `<div class="empty">⚠️ ${esc(e && e.message ? e.message : 'Pounce failed')}</div>`; });
}
function renderPounceResult(j, lead) {
  const url = j.siteUrl;
  const hero = pounceHeroNote(j.heroSource);
  $('pounce-body').innerHTML =
    `<div class="pounce-bar"><a class="primary btn" href="${esc(url)}" target="_blank" rel="noopener">Open full site ↗</a>` +
    `<button id="pounce-copy" class="ghost sm">📋 Copy link</button>` +
    `<button id="pounce-edit" class="ghost sm">✎ Edit & rebuild</button>` +
    (hero ? `<span class="muted pounce-note">${esc(hero)}</span>` : '') +
    (j.usedProwl ? `<span class="muted pounce-note">🐾 Used Prowl intel</span>` : '') +
    `<span class="muted pounce-note">Private preview · hidden from Google</span></div>` +
    `<iframe class="pounce-frame" src="${esc(url)}" title="Website preview"></iframe>`;
  const cp = $('pounce-copy');
  if (cp) cp.addEventListener('click', () => { navigator.clipboard.writeText(url).then(() => { cp.textContent = '✓ Copied'; setTimeout(() => { cp.textContent = '📋 Copy link'; }, 1500); }).catch(() => {}); });
  const ed = $('pounce-edit');
  if (ed) ed.addEventListener('click', () => openPounceQuestions(lead));
}
function openPounceQuestions(lead) {
  $('pounce-title').textContent = '🐆 Pounce · ' + lead.name;
  $('pounce-modal').classList.remove('hidden');
  $('pounce-body').innerHTML = pounceQuestionsHTML(lead);
  $('pq-build').addEventListener('click', () => buildPounce(lead, collectPounceOpts(), true));
  $('pq-skip').addEventListener('click', () => buildPounce(lead, {}, false));
}
function openPounce(lead) { openPounceQuestions(lead); }

// ---- Lead profile popup: contact + Prowl + Pounce in one place ----
function prettySlug(slug) { return String(slug || '').replace(/-[0-9a-f]{8}$/i, '').split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join(' ').trim() || slug; }
$('lead-close').addEventListener('click', () => $('lead-modal').classList.add('hidden'));
let currentLeadProfile = null;
$('lead-body').addEventListener('click', (e) => { if (e.target.closest('.lead-act.wa') && currentLeadProfile) markSent(currentLeadProfile.slug, currentLeadProfile, 'w'); });
function leadFromAny(biz) {
  const slug = biz.slug || biz.id;
  const m = mergedRecent().find((r) => r.id === slug) || {};
  const phone = biz.phone || (biz.phones && biz.phones[0]) || (m.phones && m.phones[0]) || '';
  return {
    slug, name: biz.name || m.name || prettySlug(slug), location: biz.location || m.location || '',
    category: biz.category || m.category || '', phone, phones: phone ? [phone] : [],
    mapsUrl: biz.mapsUrl || m.mapsUrl || '', viewUrl: biz.viewUrl || m.viewUrl || '', who: biz.who || m.personName || '',
    opens: m.opens, lastOpen: m.lastOpen, ctaClicks: m.ctaClicks, demoAt: biz.demoAt, signupAt: biz.signupAt,
  };
}
function refreshLeadSurfaces() {
  try { renderRecent(); } catch (e) { /* ignore */ }
  try { if (lastHotLeads) renderHotLeads(lastHotLeads); } catch (e) { /* ignore */ }
  try { if (lastSearchResults.length) renderResults(lastSearchResults); } catch (e) { /* ignore */ }
  renderBlocked();
}
function renderLeadShell(l) {
  const phone = l.phone;
  const mobile = phone && window.BizData.isUkMobile(phone);
  const blocked = isBlocked(l);
  let acts = '';
  if (phone && !blocked) acts += `<a class="lead-act call" href="tel:${esc(phone)}">📞 Call ${esc(phone)}</a>`;
  if (mobile && !blocked) {
    const msg = fillWaMessage(loadSettings().followUp, { name: l.name, location: l.location, category: l.category }, tagLink(l.viewUrl || '', 'w'), l.who);
    acts += `<a class="lead-act wa" target="_blank" rel="noopener" href="https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(msg)}">📱 WhatsApp</a>`;
  }
  if (l.mapsUrl || (l.name && l.location)) acts += `<a class="lead-act" target="_blank" rel="noopener" href="${esc(mapsLink(l))}">📍 Maps</a>`;
  if (l.viewUrl) acts += `<a class="lead-act" target="_blank" rel="noopener" href="${esc(l.viewUrl)}">View preview ↗</a>`;
  const eng = [];
  if (l.signupAt) eng.push('🤑 Clicked Sign Up');
  if ((l.ctaClicks || 0) > 0 || l.demoAt) eng.push('🔥 Requested a demo');
  if ((l.opens || 0) > 0) eng.push('👁 Viewed' + (l.opens > 1 ? ' ×' + l.opens : '') + (l.lastOpen ? ' · ' + fmtDate(l.lastOpen) : ''));
  const engHtml = eng.length ? `<div class="lead-eng">${eng.map((e) => `<span class="lead-chip">${esc(e)}</span>`).join('')}</div>` : '';
  return `<div class="lead-sub">${l.category ? esc(titleCaseIndustry(l.category)) + ' · ' : ''}${esc(l.location || '')}${phone ? '' : ' · <span class="muted">no phone on file</span>'}</div>` +
    (blocked ? '<div class="lead-blocked">🚫 This contact is blocked (do not contact).</div>' : '') +
    engHtml + `<div class="lead-acts">${acts}</div>`;
}
function renderLeadStatus(l, dossier, pounce) {
  const el = $('lead-status'); if (!el) return;
  let html = '';
  if (dossier) {
    const g = dossier.google || {}; const ch = dossier.companiesHouse || {}; const facts = [];
    if (ch.found && ch.established) facts.push('Est. ' + fmtDateShort(ch.established));
    if (g.reviews) facts.push(g.reviews + ' reviews at ' + g.rating + '★');
    if ((dossier.ammunition || []).length) facts.push(dossier.ammunition.length + ' talking points');
    html += `<div class="lead-card"><div class="lead-card-h">🐾 Prowled <span class="ok">✓</span></div><div class="muted">${esc(facts.join(' · ') || 'Intel gathered')}</div><div class="lead-card-acts"><button class="primary sm lead-viewprowl">View full dossier</button></div></div>`;
  } else {
    html += `<div class="lead-card"><div class="lead-card-h">🐾 Prowl</div><div class="muted">Not researched yet.</div><div class="lead-card-acts"><button class="primary sm lead-doprowl">🐾 Prowl now</button></div></div>`;
  }
  if (pounce && pounce.exists) {
    html += `<div class="lead-card"><div class="lead-card-h">🐆 Website built <span class="ok">✓</span></div><div class="muted">${pounce.mode === 'published' ? 'Published' : 'Private preview'}</div><div class="lead-card-acts"><a class="primary btn sm" href="${esc(pounce.siteUrl)}" target="_blank" rel="noopener">Open website ↗</a><button class="ghost sm lead-dopounce">↻ Rebuild</button></div></div>`;
  } else {
    html += `<div class="lead-card"><div class="lead-card-h">🐆 Pounce</div><div class="muted">No website built yet.</div><div class="lead-card-acts"><button class="primary sm lead-dopounce">🐆 Build website</button></div></div>`;
  }
  const onCallList = isOnCallList(l, { id: l.slug });
  html += isBlocked(l)
    ? '<div class="lead-foot"><button class="ghost sm lead-unblock">Unblock contact</button></div>'
    : `<div class="lead-foot"><button class="ghost sm lead-addcall"${onCallList ? ' disabled' : ''}>${onCallList ? '✓ On call list' : '📞 Add to call list'}</button> <button class="ghost sm lead-block">🚫 Block (not interested)</button></div>`;
  el.className = 'lead-cards';
  el.innerHTML = html;
  const q = (s) => el.querySelector(s);
  const ac = q('.lead-addcall'); if (ac && !onCallList) ac.addEventListener('click', () => addToCallList({ name: l.name, location: l.location, category: l.category, phone: l.phone, placeId: l.placeId || '', slug: l.slug, mapsUrl: l.mapsUrl || '' }, { id: l.slug }, ac));
  const vp = q('.lead-viewprowl'); if (vp) vp.addEventListener('click', () => openProwl(l));
  const dp = q('.lead-doprowl'); if (dp) dp.addEventListener('click', () => openProwl(l));
  const po = q('.lead-dopounce'); if (po) po.addEventListener('click', () => openPounce(l));
  const bk = q('.lead-block'); if (bk) bk.addEventListener('click', () => confirmBlock(l, () => { $('lead-modal').classList.add('hidden'); refreshLeadSurfaces(); }));
  const ub = q('.lead-unblock'); if (ub) ub.addEventListener('click', () => { unblockKey(blockKey(l)); $('lead-modal').classList.add('hidden'); refreshLeadSurfaces(); });
}
const LEAD_STATUSES = [['', 'New'], ['contacted', 'Contacted'], ['no-answer', "Doesn't answer"], ['interested', 'Interested'], ['callback', 'Call back'], ['not-interested', 'Not interested'], ['declined', 'Not interested (via mockup)'], ['invalid-phone', 'Invalid phone'], ['won', 'Won, customer'], ['lost', 'Lost']];
function statusLabel(s) { const f = LEAD_STATUSES.find((x) => x[0] === (s || '')); return f ? f[1] : 'New'; }
function statusClass(s) { return 'st-' + (s || 'new'); }
function renderLeadNotes(l, note) {
  const el = $('lead-notes'); if (!el) return;
  const cur = note.status || '';
  const comments = (note.comments || []).slice().reverse();
  el.innerHTML = '<div class="lead-notes-inner"><h3 class="ln-h">Status & notes</h3>' +
    '<div class="ln-row"><label>Status</label>' +
    `<select id="ln-status">${LEAD_STATUSES.map((o) => `<option value="${o[0]}"${o[0] === cur ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>` +
    '<span class="ln-saved" id="ln-saved"></span></div>' +
    '<div class="ln-add"><textarea id="ln-comment" rows="2" placeholder="Add a note (e.g. Called, not interested, already has a website but not on Maps, doing it as a sideline)…"></textarea><button id="ln-add-btn" class="primary sm">Add note</button></div>' +
    `<div class="ln-log">${comments.length ? comments.map((c) => `<div class="ln-item"><div class="ln-when">${esc(fmtDate(c.at))}</div><div class="ln-text">${esc(c.text)}</div></div>`).join('') : '<div class="muted">No notes yet.</div>'}</div></div>`;
  $('ln-status').addEventListener('change', (e) => saveNote(l, { status: e.target.value }));
  $('ln-add-btn').addEventListener('click', () => { const text = ($('ln-comment').value || '').trim(); if (text) saveNote(l, { comment: text }); });
}
function saveNote(l, payload) {
  const sv = $('ln-saved'); if (sv) sv.textContent = 'Saving…';
  fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ slug: l.slug }, payload)) })
    .then((r) => r.json()).then((d) => {
      renderLeadNotes(l, (d && d.note) || {});
      const s2 = $('ln-saved'); if (s2) { s2.textContent = '✓ Saved'; setTimeout(() => { if ($('ln-saved')) $('ln-saved').textContent = ''; }, 1500); }
      if (leadsData && payload.status !== undefined) { leadsData.statuses = leadsData.statuses || {}; if (payload.status) leadsData.statuses[l.slug] = payload.status; else delete leadsData.statuses[l.slug]; try { renderLeads(); } catch (e) { /* ignore */ } }
    }).catch(() => { const s3 = $('ln-saved'); if (s3) s3.textContent = '⚠️ Failed'; });
}
function openLead(biz) {
  const l = leadFromAny(biz);
  if (!l.slug) return;
  currentLeadProfile = l;
  $('lead-title').textContent = l.name;
  $('lead-modal').classList.remove('hidden');
  $('lead-body').innerHTML = renderLeadShell(l) + '<div id="lead-status" class="lead-status"><span class="spinner sm"></span> Checking Prowl & website…</div><div id="lead-notes"></div>';
  const peek = (url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: l.slug, peek: true }) }).then((r) => r.json()).catch(() => ({}));
  const getNote = fetch('/api/note?slug=' + encodeURIComponent(l.slug)).then((r) => r.json()).catch(() => ({}));
  Promise.all([peek('/api/prowl'), peek('/api/pounce'), getNote]).then(([pr, pc, nt]) => { renderLeadStatus(l, pr && pr.dossier, pc); renderLeadNotes(l, (nt && nt.note) || {}); });
}
// clickable business names → lead profile (dashboard activity table)
$('dash-body').addEventListener('click', (e) => { const n = e.target.closest('.lead-name'); if (n) openLead({ slug: n.dataset.slug, name: n.dataset.name }); });

// ---- 👤 Leads view: browse every business, filter by Prowled / Pounced / etc ----
let leadsData = null; // { prowled:Set, pounced:Set }
let leadsFilter = 'all';
async function loadLeads() {
  const tb = $('leads-rows'); if (tb) tb.innerHTML = '<tr><td colspan="4" class="muted" style="padding:14px">Loading…</td></tr>';
  if (!authed) return;
  try { await loadServerMockups(); } catch (e) { /* keep local */ }
  try { const r = await fetch('/api/leads'); const d = await r.json(); leadsData = { prowled: new Set(d.prowled || []), pounced: new Set(d.pounced || []), statuses: d.statuses || {} }; }
  catch (e) { leadsData = { prowled: new Set(), pounced: new Set(), statuses: {} }; }
  renderLeads();
}
function filteredLeads() {
  const q = ($('leads-search') ? $('leads-search').value : '').toLowerCase().trim();
  const pro = leadsData ? leadsData.prowled : new Set();
  const pou = leadsData ? leadsData.pounced : new Set();
  let list = mergedRecent();
  if (q) list = list.filter((r) => (String(r.name || '') + ' ' + String(r.location || '')).toLowerCase().indexOf(q) >= 0);
  list = list.filter((r) => {
    const messaged = !!recentSentVia(r);
    const blocked = isBlocked(r);
    if (leadsFilter === 'prowled') return pro.has(r.id);
    if (leadsFilter === 'pounced') return pou.has(r.id);
    if (leadsFilter === 'messaged') return messaged;
    if (leadsFilter === 'notmessaged') return !messaged && !blocked;
    if (leadsFilter === 'opened') return (r.opens || 0) > 0;
    if (leadsFilter === 'blocked') return blocked;
    return true;
  });
  const sel = $('leads-status-filter');
  const sf = sel ? sel.value : '__any';
  if (sf !== '__any') { const statuses = (leadsData && leadsData.statuses) || {}; list = list.filter((r) => (statuses[r.id] || '') === sf); }
  return list;
}
function renderLeads() {
  const tb = $('leads-rows'); if (!tb) return;
  const pro = leadsData ? leadsData.prowled : new Set();
  const pou = leadsData ? leadsData.pounced : new Set();
  const list = filteredLeads();
  if (!list.length) { tb.innerHTML = '<tr><td colspan="4" class="muted" style="padding:14px">No leads match.</td></tr>'; return; }
  tb.innerHTML = '';
  list.forEach((r) => {
    const chips = [];
    const st = (leadsData && leadsData.statuses) ? leadsData.statuses[r.id] : '';
    if (st) chips.push(`<span class="lchip ${statusClass(st)}">${esc(statusLabel(st))}</span>`);
    if (recentSentVia(r)) chips.push('<span class="lchip ok">✓ Messaged</span>');
    if ((r.ctaClicks || 0) > 0) chips.push('<span class="lchip hot">🔥 Demo</span>');
    else if ((r.opens || 0) > 0) chips.push('<span class="lchip">👁 Viewed</span>');
    if (pro.has(r.id)) chips.push('<span class="lchip prowl">🐾 Prowled</span>');
    if (pou.has(r.id)) chips.push('<span class="lchip pounce">🐆 Site</span>');
    if (isBlocked(r)) chips.push('<span class="lchip blk">🚫 Blocked</span>');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><button class="lead-name" data-slug="${esc(r.id)}">${esc(r.name || '')}</button></td><td>${esc(r.location || '')}</td><td><div class="lchips">${chips.join('') || '<span class="muted">New</span>'}</div></td><td><button class="ghost sm leadrow-open">Open profile →</button></td>`;
    const open = () => openLead({ slug: r.id, name: r.name, location: r.location, category: r.category, phone: (r.phones && r.phones[0]) || '', mapsUrl: r.mapsUrl, viewUrl: r.viewUrl, who: r.personName });
    tr.querySelector('.lead-name').addEventListener('click', open);
    tr.querySelector('.leadrow-open').addEventListener('click', open);
    tb.appendChild(tr);
  });
}
$('leads-search').addEventListener('input', renderLeads);
$('leads-status-filter').addEventListener('change', renderLeads);
$('leads-refresh').addEventListener('click', (e) => refreshFeedback(e.currentTarget, loadLeads));
$('leads-export').addEventListener('click', exportLeadsCsv);

// ---- 🌐 Websites: mockups (/v/) + Pounce sites (/s/, preview or live) ----
let websitesData = null;
let websitesFilter = 'all';
async function loadWebsites() {
  const tb = $('websites-rows'); if (tb) tb.innerHTML = '<tr><td colspan="4" class="muted" style="padding:14px">Loading…</td></tr>';
  if (!authed) return;
  const items = [];
  try {
    const d = await (await fetch('/api/mockups')).json();
    (d.mockups || []).forEach((m) => {
      const slug = m.slug || m.img;
      items.push({ type: 'mockup', name: humaniseBusinessName(m.name) || m.name || prettySlug(slug), url: m.viewUrl || m.img, date: m.date, slug });
    });
  } catch (e) { /* ignore */ }
  try {
    const d = await (await fetch('/api/sites')).json();
    (d.sites || []).forEach((s) => {
      items.push({ type: s.mode === 'published' ? 'live' : 'draft', name: humaniseBusinessName(s.name) || s.name, url: s.url, date: s.createdAt, slug: s.slug });
    });
  } catch (e) { /* ignore */ }
  websitesData = { items };
  renderWebsites();
}
function renderWebsites() {
  const tb = $('websites-rows'); if (!tb) return;
  const items = (websitesData && websitesData.items) || [];
  const counts = { all: items.length, mockup: 0, draft: 0, live: 0 };
  items.forEach((it) => { counts[it.type] = (counts[it.type] || 0) + 1; });
  document.querySelectorAll('#websites-filters .leadf-btn').forEach((b) => {
    const base = b.textContent.replace(/\s*\(\d+\)\s*$/, '');
    b.textContent = base + ' (' + (counts[b.dataset.f] || 0) + ')';
  });
  const q = ($('websites-search') ? $('websites-search').value : '').toLowerCase().trim();
  let list = items.slice();
  if (websitesFilter !== 'all') list = list.filter((it) => it.type === websitesFilter);
  if (q) list = list.filter((it) => String(it.name || '').toLowerCase().indexOf(q) >= 0);
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!list.length) { tb.innerHTML = '<tr><td colspan="4" class="muted" style="padding:14px">Nothing here yet.</td></tr>'; return; }
  const badge = {
    mockup: '<span class="lchip wt-mock">🖼️ Mockup</span>',
    draft: '<span class="lchip wt-draft">🛠️ Draft site</span>',
    live: '<span class="lchip wt-live">🟢 Live site</span>',
  };
  tb.innerHTML = list.map((it) => {
    let actions = '';
    if (it.type === 'draft') actions += `<button class="primary btn sm w-publish" data-slug="${esc(it.slug)}" data-name="${esc(it.name || '')}" data-pub="1">🚀 Make live</button> `;
    else if (it.type === 'live') actions += `<button class="ghost sm w-publish" data-slug="${esc(it.slug)}" data-name="${esc(it.name || '')}" data-pub="0">Unpublish</button> `;
    actions += `<a class="ghost sm" href="${esc(it.url)}" target="_blank" rel="noopener">Open ↗</a>`;
    return `<tr><td><b>${esc(it.name || '')}</b></td><td>${badge[it.type] || ''}</td>` +
      `<td>${it.date ? esc(fmtDate(it.date)) : '<span class="muted">·</span>'}</td>` +
      `<td class="w-acts">${actions}</td></tr>`;
  }).join('');
}
function subFromName(n) { return String(n || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
function showLiveDialog(host) {
  const url = 'https://' + host;
  const wrap = document.createElement('div');
  wrap.className = 'live-modal';
  wrap.innerHTML = '<div class="live-card"><div class="live-h">🎉 It\'s live!</div>' +
    '<p class="live-url">' + esc(url) + '</p>' +
    '<p class="live-note">The HTTPS padlock can take a minute or two to activate on a brand-new address.</p>' +
    '<div class="live-acts"><a class="primary btn live-go" href="' + esc(url) + '" target="_blank" rel="noopener">🌐 Go to website →</a>' +
    '<button class="ghost btn live-close" type="button">Done</button></div></div>';
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.live-close').addEventListener('click', close);
  wrap.querySelector('.live-go').addEventListener('click', close);
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
}
$('websites-rows').addEventListener('click', async (e) => {
  const btn = e.target.closest && e.target.closest('.w-publish'); if (!btn) return;
  const slug = btn.dataset.slug; const publish = btn.dataset.pub === '1'; const name = btn.dataset.name || 'this site';
  let payload;
  if (publish) {
    const def = subFromName(name);
    const sub = prompt('Make "' + name + '" LIVE.\n\nChoose its web address (just the part before .aiwebpoint.com).\nLeave blank to publish on the plain /s/ link instead.', def);
    if (sub === null) return; // cancelled
    payload = { slug, publish: true, subdomain: sub.trim() };
  } else {
    if (!confirm('Unpublish "' + name + '"?\n\nIt goes back to a private draft and its subdomain (if any) is freed.')) return;
    payload = { slug, publish: false };
  }
  btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
  try {
    const r = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Failed');
    if (publish && d.host) showLiveDialog(d.host);
    await loadWebsites();
  } catch (x) { alert('Could not update: ' + (x.message || x)); btn.disabled = false; btn.textContent = old; }
});
document.querySelectorAll('#websites-filters .leadf-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#websites-filters .leadf-btn').forEach((x) => x.classList.toggle('active', x === b));
  websitesFilter = b.dataset.f; renderWebsites();
}));
$('websites-search').addEventListener('input', renderWebsites);
$('websites-refresh').addEventListener('click', (e) => refreshFeedback(e.currentTarget, loadWebsites));

// 📨 Enquiries inbox: form submissions from Pounce sites (stored by /api/contact)
let enquiriesData = null;
async function loadEnquiries() {
  const tb = $('enq-rows'); if (tb) tb.innerHTML = '<tr><td colspan="5" class="muted" style="padding:14px">Loading…</td></tr>';
  if (!authed) return;
  try {
    const d = await (await fetch('/api/enquiries')).json();
    enquiriesData = { items: d.enquiries || [] };
  } catch (e) { enquiriesData = { items: [] }; }
  renderEnquiries();
}
function renderEnquiries() {
  const tb = $('enq-rows'); if (!tb) return;
  const items = (enquiriesData && enquiriesData.items) || [];
  const q = ($('enq-search') ? $('enq-search').value : '').toLowerCase().trim();
  let list = items.slice();
  if (q) list = list.filter((it) => (String(it.name) + ' ' + it.business + ' ' + it.message + ' ' + it.email + ' ' + it.service).toLowerCase().indexOf(q) >= 0);
  if (!list.length) { tb.innerHTML = '<tr><td colspan="5" class="muted" style="padding:14px">No enquiries yet. They appear here the moment a visitor submits a quote form on one of your sites.</td></tr>'; return; }
  tb.innerHTML = list.map((it) => {
    const contact = [];
    if (it.phone) contact.push('<a href="tel:' + esc(it.phone.replace(/[^+0-9]/g, '')) + '">📞 ' + esc(it.phone) + '</a>');
    if (it.email) contact.push('<a href="mailto:' + esc(it.email) + '">✉️ ' + esc(it.email) + '</a>');
    const enquiry = (it.service ? '<b>' + esc(it.service) + '</b>' : '') +
      (it.message ? (it.service ? '<br>' : '') + '<span class="muted">' + esc(it.message) + '</span>' : (it.service ? '' : '<span class="muted">·</span>'));
    return '<tr>' +
      '<td>' + (it.receivedAt ? esc(fmtDate(it.receivedAt)) : '<span class="muted">·</span>') + '</td>' +
      '<td><b>' + esc(humaniseBusinessName(it.business) || it.business) + '</b></td>' +
      '<td>' + esc(it.name || '·') + '</td>' +
      '<td class="enq-contact">' + (contact.join('<br>') || '<span class="muted">·</span>') + '</td>' +
      '<td class="enq-msg">' + enquiry + '</td></tr>';
  }).join('');
}
$('enq-search').addEventListener('input', renderEnquiries);
$('enq-refresh').addEventListener('click', (e) => refreshFeedback(e.currentTarget, loadEnquiries));

// ---- 📞 Call List: phone-first outreach (the safe first touch) -------------
// Stored server-side (calls/_list.json) so the list built on desktop is on your
// phone when out calling. Status + notes reuse the CRM (/api/note keyed by the
// same key), so Call List / All Leads / Lead Profile show ONE status.
let callsData = null;
let callsFilter = 'tocall';
let callKeys = new Set();        // server entry keys
let callNameKeys = new Set();    // normKey(name|location) of entries, reliable membership check
let callOptimistic = new Set();  // adds made THIS session: blob reads can lag a put by a moment,
                                 // so a refresh must never flip a just-added ✓ back to the button
// serialize every write: /api/calls does read-modify-write on one blob, so two
// overlapping adds would silently lose one (last write wins). A promise chain
// guarantees one in flight at a time.
let callsPostChain = Promise.resolve();
function callsPost(payload) {
  const run = () => fetch('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(async (r) => { if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed'); } return r.json(); });
  const p = callsPostChain.then(run, run);
  callsPostChain = p.catch(() => {});
  return p;
}
const CALL_FILTERS = {
  tocall: ['', 'no-answer'],
  callback: ['callback'],
  contacted: ['contacted'],
  interested: ['interested', 'won'],
  notint: ['not-interested', 'declined', 'invalid-phone', 'lost'],
};
function callKeyFor(a) {
  const slug = String(a.slug || '').replace(/[^a-z0-9-]/gi, '');
  if (slug) return slug;
  return String((a.name || '') + '-' + (a.location || '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'lead';
}
function isOnCallList(b, rec) {
  if (callOptimistic.has(normKey(b.name, b.location))) return true; // just added, even if the server read lags
  if (callNameKeys.has(normKey(b.name, b.location))) return true; // matches however the entry was keyed
  return callKeys.has(callKeyFor({ slug: rec ? rec.id : '', name: b.name, location: b.location })) ||
    callKeys.has(callKeyFor({ name: b.name, location: b.location }));
}
async function loadCallList() {
  const tb = $('calls-rows'); if (tb) tb.innerHTML = '<tr><td colspan="5" class="muted" style="padding:14px">Loading…</td></tr>';
  if (!authed) return;
  try {
    const [cr, lr] = await Promise.all([fetch('/api/calls'), fetch('/api/leads')]);
    const cd = await cr.json();
    const ld = await lr.json().catch(() => ({}));
    callsData = { calls: cd.calls || [], statuses: (ld && ld.statuses) || {}, prowled: new Set((ld && ld.prowled) || []), prowledAt: (ld && ld.prowledAt) || {} };
  } catch (e) { callsData = { calls: [], statuses: {}, prowled: new Set(), prowledAt: {} }; }
  callKeys = new Set(callsData.calls.map((c) => c.key));
  callNameKeys = new Set(callsData.calls.map((c) => normKey(c.name, c.location)));
  renderCallList();
  updateCallBadge();
  // search results on screen? re-render so the ✓ On-call-list states reflect the server truth
  try { if (lastSearchResults && lastSearchResults.length && $('view-search') && !$('view-search').classList.contains('hidden')) renderResults(lastSearchResults); } catch (e) { /* cosmetic */ }
}
function callStatusOf(c) { return (callsData && callsData.statuses && callsData.statuses[c.key]) || ''; }
// the rows currently visible (active filter chip + search box), used by the table AND the export
function filteredCalls() {
  if (!callsData) return [];
  const q = ($('calls-search') ? $('calls-search').value : '').toLowerCase().trim();
  let list = callsData.calls.slice();
  if (callsFilter !== 'all') list = list.filter((c) => CALL_FILTERS[callsFilter].indexOf(callStatusOf(c)) >= 0);
  if (q) list = list.filter((c) => ((c.name || '') + ' ' + (c.location || '')).toLowerCase().indexOf(q) >= 0);
  return list;
}
function updateCallBadge() {
  const el = $('call-count'); if (!el) return;
  if (!callsData) { el.classList.add('hidden'); return; }
  const need = callsData.calls.filter((c) => { const st = callStatusOf(c); return st === '' || st === 'no-answer' || st === 'callback'; }).length;
  el.textContent = need;
  el.classList.toggle('hidden', need <= 0);
}
function renderCallList() {
  const tb = $('calls-rows'); if (!tb || !callsData) return;
  const counts = { all: callsData.calls.length };
  Object.keys(CALL_FILTERS).forEach((f) => { counts[f] = callsData.calls.filter((c) => CALL_FILTERS[f].indexOf(callStatusOf(c)) >= 0).length; });
  document.querySelectorAll('#calls-filters .leadf-btn').forEach((b) => {
    const base = b.textContent.replace(/\s*\(\d+\)\s*$/, '');
    b.textContent = base + ' (' + (counts[b.dataset.f] || 0) + ')';
  });
  const list = filteredCalls();
  if (!list.length) { tb.innerHTML = '<tr><td colspan="5" class="muted" style="padding:14px">Nothing here. Add businesses from the search results with "📞 Add to call list".</td></tr>'; return; }
  tb.innerHTML = '';
  list.forEach((c) => {
    const st = callStatusOf(c);
    const tr = document.createElement('tr');
    const opts = LEAD_STATUSES.map(([v, l]) => `<option value="${esc(v)}"${v === st ? ' selected' : ''}>${esc(l)}</option>`).join('');
    tr.innerHTML = `<td><button class="lead-name">${esc(humaniseBusinessName(c.name) || c.name)}</button><div class="muted st-area">📍 ${esc(c.location || '')}${c.category ? ' · ' + esc(c.category) : ''}</div></td>` +
      `<td>${c.phone ? `<a class="call-tel" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">📞 ${esc(c.phone)}</a>` : '<span class="muted">No phone</span>'}</td>` +
      `<td><select class="call-status leads-statusf">${opts}</select></td>` +
      `<td><button class="ghost sm call-notes">📝 Notes</button></td>` +
      `<td class="w-acts">${(callsData.prowled && callsData.prowled.has(c.key))
        ? '<button class="ghost sm call-prowl intel-ready" title="The intelligence dossier is ready, open it">🐾 View intel ✓</button>'
        : '<button class="mini rc-prowl call-prowl" title="Gather intelligence on this business before you dial (takes ~30s)">🐾 Prowl</button>'} <button class="ghost sm call-remove" title="Remove from the call list">✕</button>` +
      ((callsData.prowled && callsData.prowled.has(c.key) && callsData.prowledAt[c.key]) ? `<div class="intel-when muted">Prowled ${esc(fmtDateShort(callsData.prowledAt[c.key]))}</div>` : '') + '</td>';
    const lead = { slug: c.key, name: c.name, location: c.location || '', category: c.category || '', phone: c.phone || '', mapsUrl: c.mapsUrl || '' };
    tr.querySelector('.lead-name').addEventListener('click', () => openLead(lead));
    tr.querySelector('.call-prowl').addEventListener('click', () => openProwl(lead));
    tr.querySelector('.call-status').addEventListener('change', async (ev) => {
      const v = ev.target.value;
      try {
        await fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: c.key, status: v }) });
        callsData.statuses[c.key] = v;
        renderCallList(); updateCallBadge();
      } catch (e) { alert('Could not save the status.'); }
    });
    tr.querySelector('.call-remove').addEventListener('click', async () => {
      if (!confirm('Remove ' + c.name + ' from the call list? (Their status and notes are kept.)')) return;
      try {
        await callsPost({ remove: c.key }); // serialized with any pending adds
        callsData.calls = callsData.calls.filter((x) => x.key !== c.key);
        callKeys.delete(c.key);
        callNameKeys.delete(normKey(c.name, c.location));
        callOptimistic.delete(normKey(c.name, c.location));
        renderCallList(); updateCallBadge();
      } catch (e) { alert('Could not remove.'); }
    });
    tb.appendChild(tr);
    // expandable notes row (timestamped, shared with the Lead Profile CRM)
    const nr = document.createElement('tr');
    nr.className = 'call-notes-row hidden';
    nr.innerHTML = `<td colspan="5"><div class="call-notes-box"><div class="call-notes-list muted">Loading notes…</div><div class="call-notes-add"><textarea rows="2" placeholder="e.g. Spoke to Dave, send the mockup link and ring back Friday…"></textarea><button class="primary btn sm">Save note</button></div></div></td>`;
    tb.appendChild(nr);
    tr.querySelector('.call-notes').addEventListener('click', async () => {
      const open = !nr.classList.contains('hidden');
      nr.classList.toggle('hidden', open);
      if (open) return;
      const listEl = nr.querySelector('.call-notes-list');
      try {
        const d = await (await fetch('/api/note?slug=' + encodeURIComponent(c.key))).json();
        const com = (d.note && d.note.comments) || [];
        listEl.innerHTML = com.length
          ? com.slice().reverse().map((x) => `<div class="call-note"><span class="muted">${esc(fmtDate(x.at))}</span> ${esc(x.text)}</div>`).join('')
          : '<span class="muted">No notes yet.</span>';
      } catch (e) { listEl.textContent = 'Could not load notes.'; }
    });
    nr.querySelector('button').addEventListener('click', async () => {
      const ta = nr.querySelector('textarea');
      const text = ta.value.trim(); if (!text) return;
      try {
        await fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: c.key, comment: text }) });
        ta.value = '';
        const listEl = nr.querySelector('.call-notes-list');
        listEl.innerHTML = `<div class="call-note"><span class="muted">just now</span> ${esc(text)}</div>` + listEl.innerHTML.replace('No notes yet.', '');
      } catch (e) { alert('Could not save the note.'); }
    });
  });
}
async function addToCallList(b, rec, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  const add = { name: b.name, location: b.location || '', category: b.category || '', phone: (b.phones && b.phones[0]) || b.phone || '', placeId: b.id || b.placeId || '', slug: rec ? rec.id : (b.slug || ''), mapsUrl: b.mapsUrl || '' };
  try {
    await callsPost({ add }); // serialized, so rapid adds can't overwrite each other
    callKeys.add(callKeyFor(add));
    callNameKeys.add(normKey(add.name, add.location));
    callOptimistic.add(normKey(add.name, add.location));
    if (btn) { btn.textContent = '✓ On call list'; btn.classList.add('added'); }
    loadCallList(); // refresh cache + badge from the server in the background
  } catch (e) {
    alert('Could not add to the call list: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '📞 Add to call list'; }
  }
}
document.querySelectorAll('#calls-filters .leadf-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#calls-filters .leadf-btn').forEach((x) => x.classList.toggle('active', x === b));
  callsFilter = b.dataset.f; renderCallList();
}));
$('calls-search').addEventListener('input', renderCallList);
$('calls-refresh').addEventListener('click', (e) => refreshFeedback(e.currentTarget, loadCallList));
// Export the visible rows (active filter + search) as a CSV call sheet, incl.
// each lead's notes count + latest note (fetched from the CRM at export time).
async function exportCallsCsv() {
  const list = filteredCalls();
  if (!list.length) { alert('Nothing to export in this filter yet.'); return; }
  const btn = $('calls-export');
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
  let notes = [];
  try {
    notes = await Promise.all(list.map((c) => fetch('/api/note?slug=' + encodeURIComponent(c.key)).then((r) => r.json()).catch(() => ({}))));
  } catch (e) { notes = []; }
  const header = ['Business', 'Location', 'Category', 'Phone', 'Status', 'Added', 'Prowled', 'Prowled on', 'Notes count', 'Latest note', 'Google Maps'];
  const rows = list.map((c, i) => {
    const com = (notes[i] && notes[i].note && notes[i].note.comments) || [];
    const last = com.length ? com[com.length - 1] : null;
    return [
      c.name || '', c.location || '', c.category || '', c.phone || '',
      statusLabel(callStatusOf(c)),
      c.addedAt ? fmtDate(c.addedAt) : '',
      (callsData.prowled && callsData.prowled.has(c.key)) ? 'Yes' : 'No',
      callsData.prowledAt && callsData.prowledAt[c.key] ? fmtDateShort(callsData.prowledAt[c.key]) : '',
      com.length,
      last ? (fmtDate(last.at) + ': ' + last.text) : '',
      c.mapsUrl || '',
    ];
  });
  downloadCsv('call-list.csv', header, rows);
  if (btn) { btn.disabled = false; btn.textContent = '⬇ Export CSV'; }
}
$('calls-export').addEventListener('click', exportCallsCsv);
document.querySelectorAll('.leadf-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.leadf-btn').forEach((x) => x.classList.toggle('active', x === b));
  leadsFilter = b.dataset.f; renderLeads();
}));

// ---- CSV exports (Leads + Search results) ----
function downloadCsv(filename, header, rows) {
  if (!rows.length) { alert('Nothing to export yet.'); return; }
  const lines = [header.map(csvCell).join(',')].concat(rows.map((row) => row.map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportLeadsCsv() {
  const pro = leadsData ? leadsData.prowled : new Set();
  const pou = leadsData ? leadsData.pounced : new Set();
  const statuses = (leadsData && leadsData.statuses) || {};
  const header = ['Business', 'Person name', 'Location', 'Category', 'Phone', 'Google Maps', 'Status', 'Messaged via', 'Viewed', 'Last viewed', 'Demo click', 'Sign-up click', 'Prowled', 'Website built', 'Blocked', 'Preview URL'];
  const rows = filteredLeads().map((r) => [
    r.name || '', r.personName || '', r.location || '', r.category || '', (r.phones && r.phones[0]) || '', r.mapsUrl || '',
    statuses[r.id] ? statusLabel(statuses[r.id]) : '',
    recentSentVia(r) ? channelName(recentSentVia(r)) : '',
    (r.opens || 0) > 0 ? 'Yes' : 'No', r.lastOpen ? fmtDate(r.lastOpen) : '',
    (r.ctaClicks || 0) > 0 ? 'Yes' : 'No', (r.signups || 0) > 0 ? 'Yes' : 'No',
    pro.has(r.id) ? 'Yes' : 'No', pou.has(r.id) ? 'Yes' : 'No', isBlocked(r) ? 'Yes' : 'No', r.viewUrl || '',
  ]);
  downloadCsv('leads.csv', header, rows);
}
async function exportSearchCsv() {
  const list = (lastSearchResults || []).filter((b) => !isBlocked(b));
  if (!list.length) { alert('No results to export yet.'); return; }
  // make sure the lead intel (statuses / prowled / pounced) is loaded
  if (!leadsData) { try { const r = await fetch('/api/leads'); const d = await r.json(); leadsData = { prowled: new Set(d.prowled || []), pounced: new Set(d.pounced || []), statuses: d.statuses || {} }; } catch (e) { leadsData = { prowled: new Set(), pounced: new Set(), statuses: {} }; } }
  const pro = leadsData.prowled; const pou = leadsData.pounced; const statuses = leadsData.statuses || {};
  const recMap = new Map(); try { mergedRecent().forEach((x) => recMap.set(normKey(x.name, x.location), x)); } catch (e) { /* ignore */ }
  const header = ['Company', 'Category', 'Location', 'Address', 'Has website', 'Website', 'Phone(s)', 'Mobile?', 'Email', 'Star rating', 'Number of ratings', 'Google Maps', 'Status', 'Mockup made', 'Messaged via', 'Viewed', 'Demo click', 'Sign-up click', 'Prowled', 'Website built'];
  const rows = list.map((b) => {
    const phones = (b.phones || []);
    const anyMobile = phones.some((p) => window.BizData.isUkMobile(p));
    const rec = recMap.get(normKey(b.name, b.location));
    const slug = rec ? rec.id : '';
    return [
      b.name || '', b.category || '', b.location || '', b.address || '',
      b.website ? 'Yes' : 'No', b.website || '',
      phones.join(' / '), anyMobile ? 'Yes' : 'No', b.email || '',
      b.rating != null ? b.rating : '', b.userRatingsTotal != null ? b.userRatingsTotal : '', b.mapsUrl || '',
      slug && statuses[slug] ? statusLabel(statuses[slug]) : '',
      rec ? 'Yes' : 'No',
      rec && recentSentVia(rec) ? channelName(recentSentVia(rec)) : '',
      rec && (rec.opens || 0) > 0 ? 'Yes' : 'No',
      rec && (rec.ctaClicks || 0) > 0 ? 'Yes' : 'No',
      rec && (rec.signups || 0) > 0 ? 'Yes' : 'No',
      slug && pro.has(slug) ? 'Yes' : 'No',
      slug && pou.has(slug) ? 'Yes' : 'No',
    ];
  });
  downloadCsv('search-results.csv', header, rows);
}

// ---- tab-title alert: flashes when you have warm leads + are on another tab ----
let titleTimer = null;
const BASE_TITLE = document.title;
function updateTabTitle() {
  if (titleTimer) { clearInterval(titleTimer); titleTimer = null; }
  if (hotCount <= 0) { document.title = BASE_TITLE; return; }
  const settled = `Site Pounce (${hotCount})`;
  const alertMsg = signupCount > 0
    ? `🤑 (${signupCount}) want to sign up!`
    : `🌡️ (${hotCount}) warm ${hotCount === 1 ? 'lead' : 'leads'}!`;
  if (document.hidden) {
    let on = false;
    document.title = alertMsg;
    titleTimer = setInterval(() => { on = !on; document.title = on ? settled : alertMsg; }, 1000);
  } else {
    document.title = settled; // settle to a clean count when you're looking
  }
}
document.addEventListener('visibilitychange', updateTabTitle);
setInterval(() => { if (authed) loadHotLeads(); }, 180000); // refresh the count every 3 min so it catches new ones while you're away
function dowName(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] || ''; }
function fmtHourClient(h) { const a = h < 12 ? 'a' : 'p'; const hr = h % 12 === 0 ? 12 : h % 12; return hr + a; }
function dashBars(items, labelFn, valFn, highlightMax) {
  const vals = items.map(valFn);
  const max = Math.max(1, ...vals);
  const maxIdx = vals.reduce((bi, v, i) => (v > vals[bi] ? i : bi), 0);
  return '<div class="dash-bars">' + items.map((it, i) => {
    const v = valFn(it); const ht = Math.round((v / max) * 72) + 2;
    const hot = highlightMax && v > 0 && i === maxIdx ? ' hot' : '';
    return `<div class="dash-barwrap" title="${esc(String(labelFn(it, true)))}: ${v}"><div class="dash-bar${hot}" style="height:${ht}px"></div><span class="dash-blabel">${esc(String(labelFn(it)))}</span></div>`;
  }).join('') + '</div>';
}
// "By search type": group every mockup by niche + area, show pipeline counts
// "Daily activity": one row per day (newest first) so you can track daily targets
function dailyTableHTML(d) {
  const days = d.daily || [];
  if (!days.length) return '';
  let lastActive = 0;
  days.forEach((r, i) => { if (r.mockups || r.messaged || r.viewed || r.demo || r.signup || r.declined) lastActive = i; });
  const show = days.slice(0, Math.max(7, lastActive + 1)); // always show the last week, plus older active days
  const pct = (num, den) => (den > 0 && num > 0 ? ' <span class="muted">(' + Math.round((num / den) * 100) + '%)</span>' : '');
  const cell = (n, names, pctStr, bold) => {
    if (n <= 0) return '<span class="muted">·</span>';
    const inner = bold ? '<b>' + n + '</b>' : String(n);
    const num = (names && names.length) ? `<span class="hovname" title="${esc(names.join(', '))}">${inner}</span>` : inner;
    return num + (pctStr || '');
  };
  const tr = show.map((r) => {
    const cls = r.label === 'Today' ? ' class="dt-today"' : '';
    return `<tr${cls}><td><b>${esc(r.label)}</b></td>` +
      `<td>${cell(r.mockups, r.mockupNames)}</td>` +
      `<td>${cell(r.messaged, r.messagedNames, pct(r.messaged, r.mockups), true)}</td>` +
      `<td>${cell(r.viewed, r.viewedNames, pct(r.viewed, r.messaged))}</td>` +
      `<td>${cell(r.demo, r.demoNames, pct(r.demo, r.messaged))}</td>` +
      `<td>${cell(r.signup, r.signupNames, pct(r.signup, r.messaged))}</td>` +
      `<td>${cell(r.declined, r.declinedNames, pct(r.declined, r.messaged))}</td></tr>`;
  }).join('');
  return '<div class="dash-table-wrap"><h3>🎯 Daily activity</h3>' +
    '<p class="muted dash-sub">What you did each day (UK time), newest first. <b>Hover any number to see the businesses.</b> % is the share of that day\'s Messaged (Messaged is the share of Mockups). Heads up: "Messaged" is counted when you <b>open</b> a WhatsApp/SMS send for a business, the app can\'t tell whether you then pressed send inside WhatsApp.</p>' +
    '<div class="recent-scroll"><table class="recent-table"><thead><tr><th>Day</th><th>Mockups</th><th>Messaged</th><th>Mockup viewed</th><th>Demo clicks</th><th>Sign-up clicks</th><th>Not interested</th></tr></thead><tbody>' + tr + '</tbody></table></div></div>';
}
function bySearchTypeHTML() {
  let list = [];
  try { list = mergedRecent(); } catch (e) { list = []; }
  if (!list.length) return '';
  const groups = new Map();
  list.forEach((r) => {
    const niche = titleCaseIndustry(r.category || '') || '(unknown)';
    const area = r.location || '';
    const key = niche + '||' + area;
    const g = groups.get(key) || { niche, area, made: 0, messaged: 0, opened: 0, demo: 0, signup: 0, declined: 0, demoNames: [], signupNames: [], declineNames: [], searchLocs: new Set() };
    if (r.searchLoc) g.searchLocs.add(r.searchLoc);
    g.made++;
    if ((r.sent || 0) > 0 || recentSentVia(r)) g.messaged++;
    if ((r.opens || 0) > 0) g.opened++;
    if ((r.ctaClicks || 0) > 0) { g.demo++; if (r.name) g.demoNames.push(r.name); }
    if ((r.signups || 0) > 0) { g.signup++; if (r.name) g.signupNames.push(r.name); }
    if ((r.declines || 0) > 0) { g.declined++; if (r.name) g.declineNames.push(r.name); }
    groups.set(key, g);
  });
  // group by niche (keep all areas of a niche together), busiest niche first,
  // then within a niche order areas by most messaged
  const allRows = Array.from(groups.values());
  const nicheMsg = {};
  allRows.forEach((g) => { nicheMsg[g.niche] = (nicheMsg[g.niche] || 0) + g.messaged; });
  const rows = allRows.sort((a, b) =>
    (nicheMsg[b.niche] - nicheMsg[a.niche]) || a.niche.localeCompare(b.niche) ||
    (b.messaged - a.messaged) || (b.made - a.made));
  let prevNiche = null;
  const tr = rows.map((g) => {
    const firstOfNiche = g.niche !== prevNiche;
    prevNiche = g.niche;
    const rate = g.messaged ? Math.round((g.opened / g.messaged) * 100) : 0;
    const demoCell = g.demo > 0
      ? `<span class="hovname" title="Clicked Request a demo: ${esc(g.demoNames.join(', '))}">🔥 ${g.demo}</span>`
      : g.demo;
    const signupCell = g.signup > 0
      ? `<span class="hovname" title="Clicked Sign me up: ${esc(g.signupNames.join(', '))}">🤑 ${g.signup}</span>`
      : g.signup;
    const declineCell = g.declined > 0
      ? `<span class="hovname" title="Clicked No thanks on the mockup: ${esc(g.declineNames.join(', '))}">🙅 ${g.declined}</span>`
      : g.declined;
    // show the core location you searched, with the lead's actual town in brackets
    // (the area may be an auto-expanded nearby town, e.g. you searched Wolverhampton, lead is in Dudley)
    const core = Array.from(g.searchLocs).find((c) => c && c.toLowerCase() !== (g.area || '').toLowerCase());
    let locHtml = '';
    if (g.area) {
      locHtml = core
        ? '<div class="muted st-area">📍 ' + esc(core) + ' <span class="st-exp">(' + esc(g.area) + ')</span></div>'
        : '<div class="muted st-area">📍 ' + esc(g.area) + '</div>';
    }
    return `<tr${firstOfNiche ? ' class="bst-gstart"' : ''}><td><b>${esc(g.niche)}</b>${locHtml}</td><td>${g.made}</td><td>${g.messaged}</td><td>${g.opened}${g.messaged ? ' <span class="muted">(' + rate + '%)</span>' : ''}</td><td>${demoCell}</td><td>${signupCell}</td><td>${declineCell}</td></tr>`;
  }).join('');
  return '<div class="dash-table-wrap"><h3>🔎 By search type</h3><p class="muted dash-sub">Which niches and areas actually convert. The location is what you searched, with the lead\'s actual town in brackets if it differs (auto-expanded nearby). Mockup viewed % is of those you messaged. Grouped by niche, busiest first.</p>' +
    '<div class="recent-scroll"><table class="recent-table"><thead><tr><th>Niche / area</th><th>Mockups</th><th>Messaged</th><th>Mockup viewed</th><th>Demo clicks</th><th>Sign-up clicks</th><th>Not interested</th></tr></thead><tbody>' + tr + '</tbody></table></div></div>';
}
function renderDashboard(d) {
  const body = $('dash-body');
  if (!d || d.configured === false) {
    body.innerHTML = '<div class="empty">Stats will appear here once you start sending.' + (d && d.generated ? ' You\'ve generated ' + d.generated + ' mockups so far.' : '') + '</div>';
    return;
  }
  const t = d.totals, rates = d.rates, ch = d.byChannel;
  // names behind each number (hover to see the latest 10)
  const rws = d.rows || [];
  const namesOf = (pred) => rws.filter(pred).map((r) => r.name).filter(Boolean).slice(0, 10);
  const pop = (title, def, names) => `<div class="stat-pop"><p class="sp-def">${esc(def)}</p>${names.length ? `<b>Latest ${esc(title)}</b><ul>${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<span class="sp-none">No names yet.</span>'}</div>`;
  let mockNames = []; try { mockNames = mergedRecent().map((r) => r.name).filter(Boolean).slice(0, 10); } catch (e) { /* ignore */ }
  const cards =
    '<div class="dash-cards">' +
    `<div class="dash-card pop-host"><div class="dc-num">${t.generated}</div><div class="dc-lab">Mockups made</div>${pop('mockups', 'Website mockups you have generated.', mockNames)}</div>` +
    `<div class="dash-card pop-host"><div class="dc-num">${t.sent}</div><div class="dc-lab">Businesses messaged</div>${pop('messaged', 'Businesses you have sent a preview to (WhatsApp, SMS or email).', namesOf((r) => r.sentAt))}</div>` +
    `<div class="dash-card pop-host"><div class="dc-num">${t.opened}</div><div class="dc-lab">Mockup viewed<span class="dc-sub">${rates.openRate}% view rate</span></div>${pop('mockup views', 'They clicked the link in your message and viewed their mockup (tracked with date/time).', namesOf((r) => r.openedAt))}</div>` +
    `<div class="dash-card pop-host"><div class="dc-num">${t.demoClicks}</div><div class="dc-lab">Demo clicks<span class="dc-sub">${rates.demoRate}% of sent</span></div>${pop('demo clicks', 'Clicked "Request a demo" on their preview, which opens your booking page. A click showing interest, not a confirmed booking.', namesOf((r) => (r.demoClicks || 0) > 0))}</div>` +
    `<div class="dash-card signup pop-host"><div class="dc-num">🤑 ${t.signups || 0}</div><div class="dc-lab">Sign-up clicks<span class="dc-sub">${rates.signupRate || 0}% of sent</span></div>${pop('sign-up clicks', 'Clicked "Yes, sign me up" on their preview, which opens your subscribe page. A strong intent click, not a payment yet.', namesOf((r) => r.signedUp))}</div>` +
    `<div class="dash-card declined pop-host"><div class="dc-num">🙅 ${t.declined || 0}</div><div class="dc-lab">Not interested (mockup)<span class="dc-sub">${rates.declineRate || 0}% of viewed</span></div><div class="stat-pop"><p class="sp-def">Clicked "No thanks" on their mockup. Auto-marked "Not interested (via mockup)" so you do not chase them. This is separate from the leads you mark not interested yourself.</p>${(d.declineReasons && d.declineReasons.length) ? '<b>Why</b><ul>' + d.declineReasons.map((x) => '<li>' + esc(x.reason) + ' (' + x.n + ')</li>').join('') + '</ul>' : '<span class="sp-none">No reasons given yet.</span>'}</div></div>` +
    '</div>';
  // colourful funnel: continuous trapezoids tapering top-to-bottom (a real funnel)
  const F = [
    { label: 'Mockups', n: t.generated, color: '#6366f1' },
    { label: 'Messaged', n: t.sent, color: '#3b82f6' },
    { label: 'Viewed', n: t.opened, color: '#0ea5e9' },
    { label: 'Demos', n: t.demoClicks, color: '#f59e0b' },
    { label: 'Signup clicks', n: t.signups || 0, color: '#16a34a' },
  ];
  const FW = [100, 80, 62, 46, 32]; // visual widths so it always tapers like a funnel
  const funnel = '<div class="dash-funnel"><h3>🪜 Funnel</h3><div class="funnel">' +
    F.map((s, i) => {
      const wt = i === 0 ? FW[0] : FW[i - 1];
      const wb = FW[i];
      const clip = `polygon(${50 - wt / 2}% 0, ${50 + wt / 2}% 0, ${50 + wb / 2}% 100%, ${50 - wb / 2}% 100%)`;
      const pct = i > 0 && F[i - 1].n ? Math.round((s.n / F[i - 1].n) * 100) : null;
      return `<div class="fn-seg" style="background:${s.color};-webkit-clip-path:${clip};clip-path:${clip}"><b>${s.n}</b><span>${esc(s.label)}${pct != null ? ' · ' + pct + '%' : ''}</span></div>`;
    }).join('') + '</div><p class="fn-note">Each % is conversion from the stage above.' + (t.declined ? ' 🙅 ' + t.declined + ' marked not interested via the mockup.' : '') + '</p></div>';
  const defnote = '<p class="dash-defnote">ⓘ <b>Demo clicks</b> = clicked "Request a demo" on their preview (opens your booking page). <b>Sign-up clicks</b> = clicked "Yes, sign me up" on their preview (opens your subscribe page). Both are interest clicks, <b>not</b> a confirmed booking or a payment. Hover any number to see who.</p>';
  const top = '<div class="dash-top">' + cards + funnel + '</div>' + defnote;
  const insights = '<div class="dash-insights"><h3>📊 Based on your data</h3><ul>' +
    (d.insights || []).map((s) => `<li>${esc(s)}</li>`).join('') + '</ul></div>';
  const tips = '<div class="dash-tips"><h3>💡 General tips <span class="muted">(best practice, not your data)</span></h3><ul>' +
    GENERIC_TIPS.map((s) => `<li>${esc(s)}</li>`).join('') + '</ul></div>';
  const chanRow = (icon, name, c) =>
    `<div class="dash-chrow"><span>${icon} ${name}</span>` +
    `<span><b>${c.rate}%</b> viewed <span class="muted">(${c.opened} of ${c.sent} sent were viewed)</span></span></div>`;
  const channelBlock = (ch.w.sent || ch.s.sent)
    ? '<div class="dash-chan"><h3>📨 By channel</h3>' +
      '<p class="muted dash-sub">Of the previews you sent on each channel, how many got viewed. Compare the % to see whether WhatsApp or SMS gets more people to open and look.</p>' +
      chanRow('📱', 'WhatsApp', ch.w) +
      chanRow('💬', 'SMS', ch.s) + '</div>'
    : '';
  const hourChart = t.opened > 0
    ? '<div class="dash-chart"><h3>⏰ Opens by hour <span class="muted">(UK time)</span></h3>' +
      dashBars(d.opensByHour, (it, full) => (full || it.h % 4 === 0 ? fmtHourClient(it.h) : ''), (it) => it.n, true) + '</div>'
    : '';
  const dayChart = t.opened > 0
    ? '<div class="dash-chart"><h3>📅 Opens by day</h3>' +
      dashBars(d.opensByDow, (it) => dowName(it.d), (it) => it.n, true) + '</div>'
    : '';
  let table = '';
  if (d.rows && d.rows.length) {
    const recMap = new Map(); try { mergedRecent().forEach((x) => recMap.set(x.id, x)); } catch (e) { /* ignore */ }
    const statuses = d.statuses || {};
    const tr = d.rows.map((r) => {
      const via = String(r.sentVia || '').split(',').map((c) => channelName(c)).filter(Boolean).join(' & ');
      const sent = r.sentAt ? fmtDate(r.sentAt) : '·';
      const opened = r.openedAt ? ('✓ ' + fmtDate(r.openedAt) + (r.opens > 1 ? ' (' + r.opens + '×)' : '')) : '<span class="muted">Not yet</span>';
      const demo = r.demoClicks > 0 ? '🔥 Yes' : '·';
      const signed = r.signedUp ? '🤑 Yes' : '·';
      const rec = recMap.get(r.slug);
      const blocked = rec ? isBlocked(rec) : false;
      const stKey = statuses[r.slug] || '';
      const statusCell = blocked ? '<span class="lchip blk">🚫 Blocked</span>' : (stKey ? `<span class="lchip ${statusClass(stKey)}">${esc(statusLabel(stKey))}</span>` : '<span class="muted">·</span>');
      return `<tr${r.signedUp ? ' class="tr-signup"' : ''}><td><button class="lead-name" data-slug="${esc(r.slug)}" data-name="${esc(r.name)}">${esc(r.name)}</button></td><td>${esc(via || '·')}</td><td>${esc(sent)}</td><td>${opened}</td><td>${demo}</td><td>${signed}</td><td>${statusCell}</td></tr>`;
    }).join('');
    table = '<div class="dash-table-wrap"><h3>🕒 Recent activity</h3><div class="recent-scroll"><table class="recent-table">' +
      '<thead><tr><th>Business</th><th>Sent via</th><th>Sent</th><th>Mockup viewed</th><th>Demo click</th><th>Sign-up click</th><th>Status</th></tr></thead><tbody>' + tr + '</tbody></table></div></div>';
  }
  body.innerHTML = insights + top + dailyTableHTML(d) + bySearchTypeHTML() + channelBlock + hourChart + dayChart + table + tips +
    '<div class="dash-refresh"><button id="dash-refresh" class="ghost">↻ Refresh</button></div>';
  const rb = $('dash-refresh'); if (rb) rb.addEventListener('click', loadDashboard);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function phoneChip(b) {
  if (!b.phones || !b.phones.length) return '';
  const mobile = b.phones.some(window.BizData.isUkMobile);
  return mobile
    ? '<span class="chip phone">📱 Mobile</span>'
    : '<span class="chip phone">☎ Landline</span>';
}

// ---- restore the last search after a page reload (free, no credit) ---------
// Results only lived in memory, so any reload (refresh, phone tab reclaim,
// reopening the app) lost them and a "Run again" cost another search credit.
// Now each search is cached locally and restored with a banner; "Search again"
// re-runs the exact criteria (incl. filters) only when YOU choose to.
function saveLastResults() {
  try {
    localStorage.setItem('aiwp_last_results', JSON.stringify({
      at: new Date().toISOString(),
      params: lastSearchParams,
      results: lastSearchResults,
      batchFull: lastBatchFull,
      summaryHTML: $('summary') ? $('summary').innerHTML : '',
    }));
  } catch (e) { /* storage full: not fatal, just no restore */ }
}
function restoreLastSearch() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('aiwp_last_results') || 'null'); } catch (e) {}
  if (!c || !c.params || !c.results || !c.results.length) return;
  if (Date.now() - new Date(c.at).getTime() > 48 * 3600 * 1000) return; // too stale, nudge a fresh search instead
  lastSearchParams = c.params;
  lastSearchResults = c.results;
  lastBatchFull = !!c.batchFull;
  $('industry').value = c.params.industry || '';
  $('location').value = c.params.location || '';
  $('summary').classList.remove('hidden');
  $('summary').innerHTML =
    `<div class="restored-bar">💾 Restored your last search, <b>${esc(c.params.industry)} in ${esc(c.params.location)}</b> (${esc(fmtDate(c.at))}), no credit used. <button class="linkbtn" id="restored-rerun" type="button">↻ Search again for fresh results</button></div>` +
    (c.summaryHTML || '');
  // restored banner shows the final numbers straight away (no count-up replay)
  $('summary').querySelectorAll('.sh-num').forEach((n) => { const to = n.getAttribute('data-to'); if (to) n.textContent = to; });
  const rb = $('restored-rerun');
  if (rb) rb.addEventListener('click', () => runRecentSearch({ industry: c.params.industry, location: c.params.location, filters: c.params.filters }));
  renderResults(lastSearchResults);
}
try { restoreLastSearch(); } catch (e) { /* a restore problem must never break the app */ }
