// Finder runs client-side (mock data). Generation calls the Vercel function.
let pendingBusiness = null;
let currentBusiness = null;
let authed = false;
const $ = (id) => document.getElementById(id);

// ---- editable settings (message + CTA wording, saved per device) ---------
const SETTINGS_DEFAULTS = {
  waMsg: "Hi {name}, it's James from Ai Web Point. I was looking through {category} in {location} and came across {business}. I noticed you don't have a website yet, so I put together a free homepage design to show what one could look like for you:\n\n{link}\n\nIf you like it I'd be happy to build the full site, and if not, no worries, we call it a day. Got time for a quick call so I can show you the website I built for you?\n\nCheers,\nJames",
  ctaHero: 'Request a demo of the full website',
  ctaBottom: 'Let me show you the full website over a call',
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
    }));
  } catch (e) {}
}
(function initSettings() {
  const s = loadSettings();
  $('set-wa-msg').value = s.waMsg;
  $('set-cta-hero').value = s.ctaHero;
  $('set-cta-bottom').value = s.ctaBottom;
  ['set-wa-msg', 'set-cta-hero', 'set-cta-bottom'].forEach((id) => $(id).addEventListener('input', saveSettings));
})();

// ---- auth (protects the paid /api/generate endpoint) ---------------------
function setAuthUI(on) {
  authed = on;
  $('loginBar').classList.toggle('hidden', on);
  $('loginOk').classList.toggle('hidden', !on);
}

function showLoginMsg(text, kind) {
  const el = $('login-msg');
  el.textContent = text;
  el.className = 'login-msg ' + (kind || '');
  el.classList.toggle('hidden', !text);
}

async function doLogin() {
  const username = $('login-user').value.trim();
  const password = $('login-pass').value;
  if (!password) { showLoginMsg('Enter your password.', 'err'); return; }
  $('login-btn').disabled = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Login failed');
    $('login-pass').value = '';
    setAuthUI(true);
    showLoginMsg('Unlocked — you can now generate mockups.', 'ok');
    setTimeout(() => showLoginMsg('', ''), 2500);
  } catch (e) {
    showLoginMsg(e.message, 'err');
  } finally {
    $('login-btn').disabled = false;
  }
}

$('login-btn').addEventListener('click', doLogin);
$('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('logout-btn').addEventListener('click', () => { setAuthUI(false); showLoginMsg('', ''); });

// check existing session on load
fetch('/api/login').then((r) => r.json()).then((d) => setAuthUI(!!d.authed)).catch(() => {});

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
      body: JSON.stringify({ industry, location, limit: Number($('f-limit').value || 20), filters }),
    });
    const data = await resp.json();
    if (resp.status === 401) { setAuthUI(false); throw new Error('Please log in (top of the page) to search.'); }
    if (!resp.ok) throw new Error(data.error || 'Search failed');
    const results = data.results || [];
    const scanned = data.scanned || results.length;
    const primaryLoc = data.primaryLocation || location;
    const expanded = data.expandedLocations || [];
    let summary;
    if (expanded.length) {
      const primaryCount = data.primaryCount != null ? data.primaryCount : 0;
      const areaWord = expanded.length === 1 ? 'area' : 'areas';
      summary = `🚀 Deep search complete! ${primaryLoc} only had ${primaryCount}, so I didn't stop there — I expanded the hunt across ${expanded.length} nearby ${areaWord} (${expanded.join(', ')}) and combed through ${scanned} listings to bring you ${results.length} ready-to-contact leads. 🔥`;
    } else {
      summary = `✅ Nailed it — ${results.length} ${industry} in ${primaryLoc} matched your filters. I combed through ${scanned} Google listings to find them.`;
    }
    $('summary').textContent = summary;
    renderResults(results);
  } catch (err) {
    $('summary').textContent = '';
    $('results').innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search businesses';
  }
}

function renderResults(list) {
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
    showLoginMsg('Please log in (top of the page) before generating mockups.', 'err');
    $('login-user').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

async function proceedGenerate() {
  const requirements = $('modal-req').value.trim();
  const personName = $('modal-name').value.trim();
  const settings = loadSettings();
  const business = Object.assign({}, pendingBusiness, { requirements });
  currentBusiness = business;
  $('modal').classList.add('hidden');

  $('preview-title').textContent = personName
    ? `Hey ${personName} 👋 — mockup for ${business.name}`
    : `Mockup · ${business.name}`;
  $('preview').classList.remove('hidden');
  $('preview-warn').classList.add('hidden');
  $('preview-links').classList.add('hidden');
  $('wa-send').classList.add('hidden');
  $('wa-note').classList.add('hidden');
  $('preview-body').innerHTML =
    '<div class="empty"><span class="spinner"></span><br/><br/>Generating your AI mockup…<br/><small>This takes ~15–25 seconds.</small></div>';

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

    $('preview-body').innerHTML = `<img src="${esc(data.imageUrl)}" alt="Website mockup" />`;
    $('img-url').value = data.imageUrl;
    $('open-view').href = data.viewUrl || data.imageUrl;
    $('download-img').href = '/api/download?img=' + encodeURIComponent(data.imageUrl);
    $('preview-links').classList.remove('hidden');
    setupWhatsApp(business, data.viewUrl || data.imageUrl, personName);
    saveRecent({
      id: data.id || data.imageUrl,
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
    const msg = err && err.message ? err.message : 'Generation failed';
    reportError('generate · ' + (business.name || ''), msg);
    showGenError(msg);
  }
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
    proceedGenerate();
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
function fillWaMessage(tpl, business, link, personName) {
  const greet = String(personName || '').trim();
  return String(tpl || '')
    .replace(/\{name\}/g, greet || 'there')
    .replace(/\{business\}/g, business.name || 'there')
    .replace(/\{category\}/g, (business.category || 'businesses').toLowerCase())
    .replace(/\{location\}/g, business.location || 'your area')
    .replace(/\{link\}/g, link || '');
}
function setupWhatsApp(business, link, personName) {
  const wa = $('wa-send');
  const note = $('wa-note');
  const phone = (business.phones && business.phones[0]) || '';
  const mobile = phone && window.BizData.isUkMobile(phone);
  note.classList.remove('hidden');
  if (!mobile) {
    wa.classList.add('hidden');
    note.textContent = phone
      ? `📱 WhatsApp button hidden because ${phone} is a landline, not a mobile — WhatsApp only works on mobiles. Use the image URL or view link in an email or text instead.`
      : '📱 WhatsApp button hidden — no mobile number listed for this business. Use the image URL or view link instead.';
    return;
  }
  const msg = fillWaMessage(loadSettings().waMsg, business, link, personName);
  wa.href = 'https://wa.me/' + toWaNumber(phone) + '?text=' + encodeURIComponent(msg);
  wa.classList.remove('hidden');
  note.textContent = 'Opens WhatsApp to ' + phone + ' with your message + link pre-filled — you review and press send.';
}

$('preview-close').addEventListener('click', () => { clearGenRetry(); $('preview').classList.add('hidden'); });
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
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return day + ' · ' + time;
}
function renderRecent() {
  const list = loadRecent();
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
      `<td><button class="ghost recent-open">Open ↗</button></td>`;
    tr.querySelector('.recent-open').addEventListener('click', () => openRecent(r));
    tr.querySelector('.recent-thumb').addEventListener('click', () => openRecent(r));
    tb.appendChild(tr);
  });
}
function openRecent(r) {
  const business = { name: r.name, category: r.category, location: r.location, phones: r.phones || [] };
  currentBusiness = business;
  $('preview-title').textContent = r.personName
    ? `Hey ${r.personName} 👋 — mockup for ${r.name}`
    : `Mockup · ${r.name}`;
  $('preview').classList.remove('hidden');
  $('preview-warn').classList.add('hidden');
  $('preview-body').innerHTML = `<img src="${esc(r.imageUrl)}" alt="Website mockup" />`;
  $('img-url').value = r.imageUrl;
  $('open-view').href = r.viewUrl || r.imageUrl;
  $('download-img').href = '/api/download?img=' + encodeURIComponent(r.imageUrl);
  $('preview-links').classList.remove('hidden');
  $('wa-send').classList.add('hidden');
  $('wa-note').classList.add('hidden');
  setupWhatsApp(business, r.viewUrl || r.imageUrl, r.personName);
}
$('recent-clear').addEventListener('click', () => {
  if (!confirm('Clear your recent mockups list? (The mockups themselves stay live at their links.)')) return;
  try { localStorage.removeItem('aiwp_recent'); } catch (e) {}
  renderRecent();
});
renderRecent();

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
