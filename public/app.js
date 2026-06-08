// Finder runs client-side (mock data). Generation calls the Vercel function.
let pendingBusiness = null;
let currentBusiness = null;
let currentSlug = null; // slug of the mockup shown in the preview modal
let currentPersonName = '';
let currentRequirements = '';
let lastSearchResults = [];
let authed = false;
const $ = (id) => document.getElementById(id);

// ---- editable settings (message + CTA wording, saved per device) ---------
const SETTINGS_DEFAULTS = {
  waMsg: "Hi {name},\n\nI came across {business} while looking through {category} in {location}.\n\nI noticed you don't currently have a website, so I put together a website preview for your business:\n\n{link}\n\nI thought it might help you see what your business could look like online.\n\nIf you'd like me to show you how the rest of the website could look, just let me know.\n\nIf it's not something you're interested in, simply reply \"No\" and I won't contact you again.\n\nThanks,\n\nAjay",
  ctaHero: 'Request a demo of the full website',
  ctaBottom: 'Let me show you the full website over a call',
  followUp: "Hi {name}, just following up on the free website preview I put together for {business}. Did you get a chance to take a look?\n\n{link}\n\nNo worries if not — happy to jump on a quick call whenever suits.\n\nCheers,\nJames",
};
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('aiwp_settings') || '{}'); } catch (e) {}
  return Object.assign({}, SETTINGS_DEFAULTS, s);
}
function saveSettings() {
  try {
    localStorage.setItem('aiwp_settings', JSON.stringify({
      waMsg: $('set-wa-msg').value,
      ctaHero: $('set-cta-hero').value,
      ctaBottom: $('set-cta-bottom').value,
      followUp: $('set-followup').value,
    }));
  } catch (e) {}
}
(function initSettings() {
  const s = loadSettings();
  $('set-wa-msg').value = s.waMsg;
  $('set-cta-hero').value = s.ctaHero;
  $('set-cta-bottom').value = s.ctaBottom;
  $('set-followup').value = s.followUp;
  ['set-wa-msg', 'set-cta-hero', 'set-cta-bottom', 'set-followup'].forEach((id) => $(id).addEventListener('input', saveSettings));
})();

// ---- auth (protects the paid /api/generate endpoint) ---------------------
function setAuthUI(on) {
  authed = on;
  $('gate').classList.toggle('hidden', on);          // full-screen gate hides the app until signed in
  $('logout-btn').classList.toggle('hidden', !on);
  if (!on) { setTimeout(() => { try { $('gate-user').focus(); } catch (e) {} }, 60); }
  if (on) loadServerMockups();                        // pull every saved mockup so they show on any device
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
    if (!r.ok) throw new Error(d.error || 'Something went wrong — please try again.');
    $('apply-form').innerHTML =
      '<div class="ap-done"><h3>Application received 🎉</h3>' +
      '<p>Thank you — we read every founder application personally. If you look like a great fit, we\'ll be in touch with your private demo and your locked-in founder rate. Keep an eye on your inbox.</p></div>';
  } catch (e) {
    applyMsg(e.message, 'err');
  } finally {
    $('apply-submit').disabled = false;
  }
}

// ---- search --------------------------------------------------------------
$('searchBtn').addEventListener('click', runSearch);
['industry', 'location'].forEach((id) =>
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); })
);

async function runSearch() {
  const industry = $('industry').value.trim();
  const location = $('location').value.trim();
  if (!industry || !location) { alert('Please enter both an industry and a location.'); return; }
  const starBuckets = Array.from(document.querySelectorAll('.f-star:checked')).map((c) => Number(c.value));
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  const filters = {
    website: $('f-website').value,
    phone: $('f-phone').value,
    email: $('f-email').value,
    ratingsFrom: num('f-ratingsFrom'),
    ratingsTo: num('f-ratingsTo'),
    starBuckets,
  };
  // exclude businesses you've already messaged (so the server digs for fresh ones)
  const messagedMode = $('f-messaged').value;
  let excludeIds = [];
  if (messagedMode && messagedMode !== 'any') {
    const m = loadMessaged();
    const cutoff = messagedMode === '3m' ? (Date.now() - 90 * 24 * 3600 * 1000) : 0;
    excludeIds = Object.keys(m)
      .filter((k) => k.indexOf('id:') === 0 && new Date(m[k].at).getTime() >= cutoff)
      .map((k) => k.slice(3));
  }

  const btn = $('searchBtn');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  $('summary').classList.remove('hidden');
  $('summary').textContent = `Searching Google for ${industry} in ${location}…`;
  $('results').innerHTML = '';

  try {
    const resp = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry, location, limit: Number($('f-limit').value || 20), filters, excludeIds }),
    });
    const data = await resp.json();
    if (resp.status === 401) { setAuthUI(false); throw new Error('Please log in (top of the page) to search.'); }
    if (!resp.ok) throw new Error(data.error || 'Search failed');
    const results = data.results || [];
    const scanned = data.scanned || results.length;
    const primaryLoc = data.primaryLocation || location;
    const expanded = data.expandedLocations || [];
    const areaWord = expanded.length === 1 ? 'area' : 'areas';
    let summary;
    if (results.length === 0) {
      const areasNote = expanded.length ? `, plus ${expanded.length} nearby ${areaWord} (${expanded.join(', ')}),` : '';
      summary = `No ${industry} in ${primaryLoc}${areasNote} matched your filters — I scanned ${scanned} Google listings. Try loosening them: set Phone to "Has phone" (not "Mobile only"), or Website to "Any". Well-established businesses (solicitors, accountants, etc.) nearly all have a website, so "No website" + "Mobile only" together often returns nothing.`;
    } else if (expanded.length) {
      const primaryCount = data.primaryCount != null ? data.primaryCount : 0;
      summary = `🚀 Deep search complete! ${primaryLoc} only had ${primaryCount}, so I didn't stop there — I expanded the hunt across ${expanded.length} nearby ${areaWord} (${expanded.join(', ')}) and combed through ${scanned} listings to bring you ${results.length} ready-to-contact leads. 🔥`;
    } else {
      summary = `✅ Nailed it — ${results.length} ${industry} in ${primaryLoc} matched your filters. I combed through ${scanned} Google listings to find them.`;
    }
    $('summary').textContent = summary;
    renderResults(results);
    saveRecentSearch({
      date: new Date().toISOString(),
      industry: industry,
      location: location,
      filters: filters,
      matched: data.matched != null ? data.matched : results.length,
      limit: Number($('f-limit').value || 20),
    });
    renderRecentSearches();
  } catch (err) {
    $('summary').textContent = '';
    $('results').innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search businesses';
  }
}

function renderResults(list) {
  lastSearchResults = list || [];
  const root = $('results');
  root.innerHTML = '';
  if (!list.length) { root.innerHTML = '<div class="empty">No businesses match these filters. Try loosening them.</div>'; return; }
  list.forEach((b) => root.appendChild(card(b)));
}

function card(b) {
  const el = document.createElement('div');
  el.className = 'card';
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
    const via = channelName(mi.via);
    lab.textContent = '✓ You messaged them' + (via ? ' via ' + via : '') + ' on ' + fmtDateShort(mi.at);
    el.appendChild(lab);
  }

  const btn = document.createElement('button');
  btn.className = 'gen';
  btn.textContent = 'Generate website mockup';
  btn.addEventListener('click', () => openGenerateModal(b));
  el.appendChild(btn);
  return el;
}

// ---- generate modal ------------------------------------------------------
function openGenerateModal(business) {
  if (!authed) {
    setAuthUI(false); // session expired — bring the login gate back up
    showLoginMsg('Your session ended — please sign in again.', 'err');
    return;
  }
  pendingBusiness = business;
  $('modal-biz').textContent = `${business.name} — ${business.category}, ${business.location}`;
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
  if (!authed) { setAuthUI(false); showLoginMsg('Your session ended — please sign in again.', 'err'); return; }
  if (!currentBusiness) return;
  pendingBusiness = currentBusiness;
  $('modal-biz').textContent = `${currentBusiness.name}${currentBusiness.category ? ' — ' + currentBusiness.category : ''}${currentBusiness.location ? ', ' + currentBusiness.location : ''}`;
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
    ? `Hey ${personName} 👋 — mockup for ${business.name}`
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
      throw new Error('Your session expired — please log in again (top of the page).');
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
    '<p class="genprog-foot"><small>This usually takes ~15–25 seconds — hang tight.</small></p></div>';
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
  return 'The server hit an error (HTTP ' + status + '). This is usually a timeout while the AI image generates — please retry.';
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
function fillWaMessage(tpl, business, link, personName) {
  const greet = String(personName || '').trim();
  let out = String(tpl || '')
    .replace(/\{name\}/g, greet) // empty when no name → cleaned up below
    .replace(/\{business\}/g, business.name || 'there')
    .replace(/\{category\}/g, titleCaseIndustry(business.category || business.industry || 'businesses'))
    .replace(/\{location\}/g, business.location || 'your area')
    .replace(/\{link\}/g, link || '');
  // tidy up an empty name: "Hi ," → "Hi," and collapse any double spaces
  out = out.replace(/[ \t]+([,.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  return out;
}
function smsNumber(phone) {
  return String(phone || '').replace(/[^\d+]/g, ''); // keep digits (+ kept if present)
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
function setupWhatsApp(business, link, personName) {
  const wa = $('wa-send');
  const sms = $('sms-send');
  const note = $('wa-note');
  const phone = (business.phones && business.phones[0]) || '';
  const mobile = phone && window.BizData.isUkMobile(phone);
  note.classList.remove('hidden');
  if (!mobile) {
    wa.classList.add('hidden');
    sms.classList.add('hidden');
    note.textContent = phone
      ? `📱 WhatsApp/SMS hidden because ${phone} is a landline, not a mobile — they only work on mobiles. Use the image URL or view link in an email instead.`
      : '📱 WhatsApp/SMS hidden — no mobile number listed for this business. Use the image URL or view link instead.';
    return;
  }
  const tpl = loadSettings().waMsg;
  const waMsg = fillWaMessage(tpl, business, tagLink(link, 'w'), personName);
  const smsMsg = fillWaMessage(tpl, business, tagLink(link, 's'), personName);
  wa.href = 'https://wa.me/' + toWaNumber(phone) + '?text=' + encodeURIComponent(waMsg);
  wa.classList.remove('hidden');
  sms.href = 'sms:' + smsNumber(phone) + '?&body=' + encodeURIComponent(smsMsg);
  sms.classList.remove('hidden');
  note.textContent = 'Opens WhatsApp, or your Messages app for SMS, to ' + phone + ' with your message + link pre-filled — you review and press send.';
}
// record the send channel + mark the business as messaged when you click a send button
$('wa-send').addEventListener('click', () => { recordSentVia(currentSlug, 'w'); markMessaged(currentBusiness, 'w'); });
$('sms-send').addEventListener('click', () => { recordSentVia(currentSlug, 's'); markMessaged(currentBusiness, 's'); });

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
  m[bizKey(b)] = { at: new Date().toISOString(), name: b.name || '', via: channel || '' };
  try { localStorage.setItem('aiwp_messaged', JSON.stringify(m)); } catch (e) {}
  if (lastSearchResults.length) renderResults(lastSearchResults); // refresh visible cards
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
    out.set(r.id, sv ? Object.assign({}, r, { opens: sv.opens, lastOpen: sv.lastOpen, ctaClicks: sv.ctaClicks, platform: sv.platform }) : r);
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
      phones: m.phone ? [m.phone] : [],
      personName: m.who || '',
      imageUrl: m.img,
      viewUrl: m.viewUrl || m.img,
      opens: m.opens || 0,
      lastOpen: m.lastOpen || null,
      ctaClicks: m.ctaClicks || 0,
      platform: m.platform || '',
    }));
    renderRecent();
  } catch (e) { /* keep showing local-only list */ }
}
function engagementBadge(r) {
  if ((r.ctaClicks || 0) > 0) return '<span class="eng hot">🔥 Demo clicked</span>';
  if ((r.opens || 0) > 0) {
    return `<span class="eng seen">✓ Opened${r.opens > 1 ? ' ×' + r.opens : ''}</span>` +
      (r.lastOpen ? `<div class="eng-when">${esc(fmtDate(r.lastOpen))}</div>` : '');
  }
  return '<span class="eng none">Not opened yet</span>';
}
function renderRecent() {
  const list = mergedRecent();
  const sec = $('recent');
  const tb = $('recent-rows');
  if (!list.length) { sec.classList.add('hidden'); tb.innerHTML = ''; return; }
  sec.classList.remove('hidden');
  tb.innerHTML = '';
  list.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><img class="recent-thumb" src="${esc(r.imageUrl)}" alt="mockup" /></td>` +
      `<td>${esc(fmtDate(r.date))}</td>` +
      `<td>${esc(r.name || '')}${r.personName ? '<div class="who">' + esc(r.personName) + '</div>' : ''}</td>` +
      `<td>${esc(r.location || '')}</td>` +
      `<td><div class="eng-cell">${engagementBadge(r)}<button class="followup" title="Send a follow-up message">↩ Follow up</button></div></td>` +
      `<td><button class="ghost recent-open">Open ↗</button></td>`;
    tr.querySelector('.recent-open').addEventListener('click', () => openRecent(r));
    tr.querySelector('.recent-thumb').addEventListener('click', () => openRecent(r));
    tr.querySelector('.followup').addEventListener('click', () => doFollowUp(r));
    tb.appendChild(tr);
  });
}
function openRecent(r) {
  const business = { name: r.name, category: r.category, location: r.location, phones: r.phones || [], id: r.placeId || undefined };
  currentBusiness = business;
  currentSlug = r.id;
  $('preview-title').textContent = r.personName
    ? `Hey ${r.personName} 👋 — mockup for ${r.name}`
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
  const business = { name: r.name, category: r.category, location: r.location };
  const link = tagLink(r.viewUrl || r.imageUrl, channel);
  const msg = fillWaMessage(loadSettings().followUp, business, link, r.personName);
  if (channel === 's') {
    window.location.href = 'sms:' + smsNumber(phone) + '?&body=' + encodeURIComponent(msg);
  } else if (channel === 'e') {
    window.open('mailto:?subject=' + encodeURIComponent('Following up — ' + (r.name || 'your website preview')) +
      '&body=' + encodeURIComponent(msg), '_blank');
  } else {
    window.open('https://wa.me/' + toWaNumber(phone) + '?text=' + encodeURIComponent(msg), '_blank');
  }
}
$('recent-clear').addEventListener('click', () => {
  if (!confirm('Clear your recent mockups list? (The mockups themselves stay live at their links.)')) return;
  try { localStorage.removeItem('aiwp_recent'); } catch (e) {}
  renderRecent();
});
renderRecent();

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
