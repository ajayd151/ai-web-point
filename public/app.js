// Finder runs client-side (mock data). Generation calls the Vercel function.
let pendingBusiness = null;
const $ = (id) => document.getElementById(id);

// ---- search --------------------------------------------------------------
$('searchBtn').addEventListener('click', runSearch);
['industry', 'location'].forEach((id) =>
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); })
);

function runSearch() {
  const industry = $('industry').value.trim();
  const location = $('location').value.trim();
  if (!industry || !location) { alert('Please enter both an industry and a location.'); return; }
  const filters = {
    website: $('f-website').value,
    phone: $('f-phone').value,
    email: $('f-email').value,
    minRatingsCount: Number($('f-minRatings').value || 0),
    minRatingScore: Number($('f-minScore').value || 0),
  };
  const all = window.BizData.generateBusinesses(industry, location);
  const results = window.BizData.filterBusinesses(all, filters);
  $('summary').classList.remove('hidden');
  $('summary').textContent = `Showing ${results.length} of ${all.length} ${industry} in ${location} matching your filters.`;
  renderResults(results);
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
      ${b.phones && b.phones.length ? '<span class="chip phone">Phone</span>' : ''}
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
  pendingBusiness = business;
  $('modal-biz').textContent = `${business.name} — ${business.category}, ${business.location}`;
  $('modal-req').value = '';
  $('modal').classList.remove('hidden');
}
$('modal-cancel').addEventListener('click', () => $('modal').classList.add('hidden'));
$('modal-proceed').addEventListener('click', proceedGenerate);

async function proceedGenerate() {
  const requirements = $('modal-req').value.trim();
  const business = Object.assign({}, pendingBusiness, { requirements });
  $('modal').classList.add('hidden');

  $('preview-title').textContent = `Mockup · ${business.name}`;
  $('preview').classList.remove('hidden');
  $('preview-warn').classList.add('hidden');
  $('preview-links').classList.add('hidden');
  $('preview-body').innerHTML =
    '<div class="empty"><span class="spinner"></span><br/><br/>Generating your AI mockup…<br/><small>This takes ~15–25 seconds.</small></div>';

  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business, requirements }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Generation failed');

    $('preview-body').innerHTML = `<img src="${esc(data.imageUrl)}" alt="Website mockup" />`;
    $('img-url').value = data.imageUrl;
    $('open-view').href = data.viewUrl || data.imageUrl;
    $('download-img').href = data.imageUrl;
    $('preview-links').classList.remove('hidden');
  } catch (err) {
    $('preview-body').innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
  }
}

$('preview-close').addEventListener('click', () => $('preview').classList.add('hidden'));
$('copy-img').addEventListener('click', () => {
  const el = $('img-url');
  el.select();
  navigator.clipboard.writeText(el.value).then(
    () => { $('copy-img').textContent = 'Copied!'; setTimeout(() => ($('copy-img').textContent = 'Copy'), 1500); },
    () => {}
  );
});

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
