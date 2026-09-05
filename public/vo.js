// Video Outreach UI (spec v4 section 5, Phase 1). Loaded after app.js and reuses its helpers
// ($, esc, showView). Four panes inside the Video Outreach view: Campaigns, Campaign edit,
// Prospects (per campaign or global), Prospect detail (full width). Everything is edited in-app
// as table rows; the v12 tracker CSV is only a one-time seed.
var VO = { campaigns: [], campaign: null, prospects: [], prospect: null, enums: null, profile: null, placeholder: '[insert URL here]', pane: 'campaigns',
  filters: { campaignId: '', run: '', priority: '', connection: '', creativeStyle: '', stage: '', q: '', includeDisqualified: false }, loaded: false };

async function voApi(action, payload) {
  const r = await fetch('/api/vo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: action }, payload || {})) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
function voPane(name) {
  VO.pane = name;
  ['campaigns', 'edit', 'prospects', 'detail'].forEach((p) => { const el = $('vo-pane-' + p); if (el) el.classList.toggle('hidden', p !== name); });
  document.querySelectorAll('.vo-tab').forEach((b) => b.classList.toggle('active', b.dataset.vopane === (name === 'edit' ? 'campaigns' : (name === 'detail' ? 'prospects' : name))));
  try { window.scrollTo({ top: 0 }); } catch (e) {}
}
async function voShow() {
  await voLoadCampaigns();
  if (!VO.loaded) { voPane('campaigns'); VO.loaded = true; }
}
document.querySelectorAll('.vo-tab').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.vopane === 'prospects') { VO.filters.campaignId = ''; voOpenProspects(''); } else voPane('campaigns');
}));

// ---- helpers ----
var VO_PRIO_CLASS = { 'Must target': 'p1', 'Strong': 'p2', 'Possible': 'p3', 'Later': 'p4', 'Unlikely': 'p5', 'Skip': 'p6' };
function voPrio(p) { return p.priority ? '<span class="vo-prio ' + (VO_PRIO_CLASS[p.priority] || '') + '">' + esc(p.priority) + '</span>' : '<span class="vo-prio p0">Unscored</span>'; }
function voStamp(ts) { if (!ts) return ''; try { return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function voLink(url, label) { if (!url) return '<span class="muted">–</span>'; const u = /^https?:\/\//i.test(url) ? url : 'https://' + url; return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || 'open') + ' ↗</a>'; }
function voList(v) { return Array.isArray(v) ? v.join('\n') : (v || ''); }
function voLines(s) { return String(s || '').split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean); }
async function voCopy(btn, text) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = o; }, 1400); }
  catch (e) { alert('Could not copy, select the text and copy it by hand.'); }
}
function voToast(msg) { const t = $('vo-toast') || (function () { const d = document.createElement('div'); d.id = 'vo-toast'; d.className = 'vo-toast'; document.body.appendChild(d); return d; })(); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

// ---- Campaigns (5.1) ----
async function voLoadCampaigns() {
  try { const d = await voApi('campaigns'); VO.campaigns = d.campaigns || []; VO.enums = d.enums; VO.profile = d.profile; VO.placeholder = d.placeholder || VO.placeholder; } catch (e) { VO.campaigns = []; }
  voRenderCampaigns();
}
function voRenderCampaigns() {
  const el = $('vo-pane-campaigns'); if (!el) return;
  const rows = VO.campaigns.map((c) => '<tr data-id="' + c.id + '">' +
    '<td><b>' + esc(c.name) + '</b><div class="muted vo-small">' + esc(c.industry || '') + '</div></td>' +
    '<td>' + esc((c.countries || []).join(', ')) + '</td>' +
    '<td>' + esc(c.schedule) + (c.schedule !== 'One-off' ? '<div class="muted vo-small">scheduler arrives in Phase 3</div>' : '') + '</td>' +
    '<td><span class="vo-status st-' + esc(c.status) + '">' + esc(c.status) + '</span></td>' +
    '<td class="num">' + (c.prospects_found || 0) + '</td><td class="num">' + (c.connected || 0) + '</td><td class="num">' + (c.replied || 0) + '</td>' +
    '<td class="num">£' + Number(c.cost_to_date || 0).toFixed(2) + '</td>' +
    '<td class="vo-acts"><button class="ghost sm" data-act="prospects">Prospects</button><button class="ghost sm" data-act="edit">Edit</button><button class="ghost sm" data-act="dup">Duplicate</button>' +
      (c.status === 'Paused' ? '<button class="ghost sm" data-act="resume">Resume</button>' : '<button class="ghost sm" data-act="pause">Pause</button>') +
      '<button class="ghost sm" data-act="run" title="Sourcing runs arrive in Phase 3. Use Import for now." disabled>Run now</button></td></tr>').join('');
  el.innerHTML = '<div class="vo-bar"><p class="muted view-sub" style="margin:0">A campaign is a saved set of criteria. Phase 1 fills it by importing the v12 tracker; automated sourcing arrives in Phase 3.</p>' +
    '<div><button class="primary" id="vo-new">＋ New campaign</button> <button class="ghost" id="vo-seed" title="Create a campaign and import the 74-row v12 tracker into it">📥 Import v12 tracker</button></div></div>' +
    (VO.campaigns.length ? '<div class="tgt-scroll"><table class="cust-table vo-table"><thead><tr><th>Name</th><th>Country</th><th>Schedule</th><th>Status</th><th>Prospects</th><th>Connected</th><th>Replied</th><th>Cost</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="muted" style="padding:14px 0">No campaigns yet. Click <b>Import v12 tracker</b> to seed the first one with the 74 researched brands (59 qualified, 15 disqualified), or <b>New campaign</b>.</p>');
  $('vo-new').addEventListener('click', () => voEditCampaign(null));
  $('vo-seed').addEventListener('click', () => voImport(null));
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async (e) => {
    const id = Number(b.closest('tr').dataset.id); const act = b.dataset.act;
    if (act === 'prospects') return voOpenProspects(id);
    if (act === 'edit') return voEditCampaign(id);
    if (act === 'dup') { await voApi('duplicateCampaign', { id: id }); voToast('Duplicated'); return voLoadCampaigns(); }
    if (act === 'pause' || act === 'resume') { await voApi('setCampaignStatus', { id: id, status: act === 'pause' ? 'Paused' : 'Active' }); return voLoadCampaigns(); }
  }));
}

// ---- Campaign edit (5.2), Phase 1 subset of the 2.1 form, as table rows ----
async function voEditCampaign(id) {
  let c = null, runs = [];
  if (id) { try { const d = await voApi('campaign', { id: id }); c = d.campaign; runs = d.runs || []; } catch (e) { alert(e.message); return; } }
  VO.campaign = c;
  const sp = Object.assign({}, VO.profile || {}, (c && c.service_profile) || {});
  const v = (k, dflt) => (c && c[k] != null ? c[k] : dflt);
  const row = (label, input, hint) => '<tr><th>' + label + (hint ? '<div class="muted vo-small">' + hint + '</div>' : '') + '</th><td>' + input + '</td></tr>';
  const sec = (t) => '<tr class="vo-sec"><th colspan="2">' + t + '</th></tr>';
  const txt = (k, dflt, ph) => '<input type="text" data-f="' + k + '" value="' + esc(v(k, dflt)) + '" placeholder="' + esc(ph || '') + '" />';
  const num = (k, dflt) => '<input type="number" data-f="' + k + '" value="' + esc(v(k, dflt)) + '" style="width:120px" />';
  const chk = (k, dflt) => '<input type="checkbox" data-f="' + k + '"' + (v(k, dflt) ? ' checked' : '') + ' />';
  const ta = (k, dflt, ph) => '<textarea data-f="' + k + '" rows="3" placeholder="' + esc(ph || '') + '">' + esc(voList(v(k, dflt))) + '</textarea>';
  const sel = (k, opts, dflt) => '<select data-f="' + k + '">' + opts.map((o) => '<option' + (v(k, dflt) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  const bands = ['1-10', '11-50', '51-100', '101-200']; const curBands = v('size_bands', ['1-10', '11-50']);
  const chans = ['LinkedIn', 'Email', 'Instagram']; const curCh = v('channels', ['LinkedIn', 'Email']);
  const html = '<div class="vo-bar"><h3 style="margin:0">' + (c ? 'Edit campaign' : 'New campaign') + '</h3><div><button class="ghost" id="vo-back">← Campaigns</button> ' + (c ? '<button class="ghost" id="vo-goprospects">Prospects →</button> ' : '') + '<button class="primary" id="vo-save">Save</button></div></div>' +
    '<table class="vo-form"><tbody>' +
    sec('Basics') + row('Name', txt('name', '', 'e.g. US Face Creams Sep 26')) + row('Status', sel('status', ['Draft', 'Active', 'Paused', 'Finished'], 'Draft')) + row('Owner', txt('owner_email', '', 'you@company.com')) + row('Notes', ta('notes', '')) +
    sec('Who to find') + row('Industry', txt('industry', '', 'e.g. Vitamins and supplements'), 'Keyword suggester arrives in Phase 3') + row('Search keywords', ta('keywords', [], 'one per line, e.g. creatine gummies'), 'Keywords, not the label, drive sourcing') +
    row('Country', txt('countries', ['US'], 'US, UK'), 'comma separated') + row('Language of outreach', txt('language', 'English')) +
    row('Company size band', bands.map((b) => '<label class="vo-chk"><input type="checkbox" data-band="' + b + '"' + (curBands.includes(b) ? ' checked' : '') + '/> ' + b + '</label>').join(' ')) +
    row('Store platform', sel('store_platform', ['Shopify only', 'Any'], 'Shopify only')) + row('Meta advertisers only', chk('meta_only', true) + ' &nbsp; minimum active Meta ads ' + num('min_meta_ads', 10)) +
    row('Video advertisers only', chk('video_only', false) + ' &nbsp; minimum video share % ' + num('min_video_share', 20)) +
    row('Exclusion list', ta('exclusions', [], 'household names, one per line'), 'seeded list arrives with sourcing in Phase 3') + row('Exclude brands already in any campaign', chk('exclude_in_any_campaign', true)) +
    row('Exclude my clients and competitors', ta('exclude_domains', [], 'domains, one per line')) + row('Seed brands (up to 10)', ta('seed_brands', [], 'domains, one per line')) +
    sec('How many and how often') + row('Target prospects per run', num('target_per_run', 20), 'new qualified prospects, score at or above the minimum') + row('Raw candidate cap per run', num('raw_cap', 400)) + row('Cost cap per run (£)', num('cost_cap', 10)) +
    row('Minimum prospect score to keep', num('min_score', 55)) + row('Schedule', sel('schedule', ['One-off', 'Daily', 'Weekly', 'Monthly'], 'One-off'), 'Phase 1 runs One-off only; Daily, Weekly and Monthly run from Phase 3') + row('Run time', txt('run_time', '06:00')) + row('Re-check cadence (days)', num('recheck_days', 30)) +
    sec('Who to contact') + row('Founder/CEO if employees below', num('role_rule_employees', 20), 'else Growth / Performance / Paid Social lead first') + row('Accepted titles', ta('accepted_titles', [], 'one per line')) +
    row('Channels', chans.map((b) => '<label class="vo-chk"><input type="checkbox" data-chan="' + b + '"' + (curCh.includes(b) ? ' checked' : '') + '/> ' + b + '</label>').join(' ')) + row('Fetch emails for', sel('fetch_emails_for', ['priority_number <= 3', 'All'], 'priority_number <= 3')) +
    sec('What to say (service profile)') + row('I run …', '<input type="text" data-sp="service_name" value="' + esc(sp.service_name || '') + '" />') + row('Service description', '<input type="text" data-sp="service_desc" value="' + esc(sp.service_desc || '') + '" />') +
    row('Sender first name', '<input type="text" data-sp="sender_first" value="' + esc(sp.sender_first || '') + '" />') + row('Sign-off', '<input type="text" data-sp="signoff" value="' + esc(sp.signoff || '') + '" />') +
    row('Offer line', '<input type="text" data-sp="offer_line" value="' + esc(sp.offer_line || '') + '" />') + row('Pilot line', '<input type="text" data-sp="pilot_line" value="' + esc(sp.pilot_line || '') + '" />') + row('Free sample is', '<input type="text" data-sp="sample_what" value="' + esc(sp.sample_what || '') + '" />') +
    row('Default variant', sel('default_variant', ['A video sent', 'B permission', 'Split test 50:50'], 'A video sent')) +
    '</tbody></table>' +
    (c ? '<div class="vo-bar" style="margin-top:16px"><h3 style="margin:0">Import prospects</h3><div><button class="ghost" id="vo-import-fix">📥 Import v12 tracker</button> <label class="ghost vo-file">📄 Import CSV <input type="file" id="vo-import-file" accept=".csv,text/csv" hidden /></label></div></div>' +
      '<h3>Runs</h3>' + (runs.length ? '<div class="tgt-scroll"><table class="cust-table vo-table"><thead><tr><th>Started</th><th>Kind</th><th>Status</th><th>Counts</th><th>Cost</th><th>Errors</th></tr></thead><tbody>' +
        runs.map((r) => '<tr><td>' + esc(voStamp(r.started_at)) + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.status) + '</td><td class="vo-small">' + esc(JSON.stringify(r.counts || {})) + '</td><td>£' + Number(r.actual_cost || 0).toFixed(2) + '</td><td class="vo-small">' + esc((r.errors || []).slice(0, 3).join('; ')) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No runs yet.</p>') : '');
  const el = $('vo-pane-edit'); el.innerHTML = html; voPane('edit');
  $('vo-back').addEventListener('click', () => voPane('campaigns'));
  if ($('vo-goprospects')) $('vo-goprospects').addEventListener('click', () => voOpenProspects(c.id));
  if ($('vo-import-fix')) $('vo-import-fix').addEventListener('click', () => voImport(c.id));
  if ($('vo-import-file')) $('vo-import-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) { const rd = new FileReader(); rd.onload = () => voImport(c.id, String(rd.result || '')); rd.readAsText(f); } });
  $('vo-save').addEventListener('click', async () => {
    const data = { id: c ? c.id : undefined };
    el.querySelectorAll('[data-f]').forEach((inp) => {
      const k = inp.dataset.f;
      if (inp.type === 'checkbox') data[k] = inp.checked;
      else if (inp.tagName === 'TEXTAREA' || k === 'countries') data[k] = (k === 'notes') ? inp.value : voLines(inp.value);
      else data[k] = inp.value;
    });
    data.size_bands = Array.from(el.querySelectorAll('[data-band]')).filter((x) => x.checked).map((x) => x.dataset.band);
    data.channels = Array.from(el.querySelectorAll('[data-chan]')).filter((x) => x.checked).map((x) => x.dataset.chan);
    const prof = {}; el.querySelectorAll('[data-sp]').forEach((inp) => { prof[inp.dataset.sp] = inp.value; }); data.service_profile = prof;
    if (!data.name) { alert('Give the campaign a name.'); return; }
    try { const d = await voApi('saveCampaign', { campaign: data }); VO.campaign = d.campaign; voToast('Saved'); await voLoadCampaigns(); if (!c) voEditCampaign(d.campaign.id); } catch (e) { alert(e.message); }
  });
}

// ---- Import (Appendix D) ----
async function voImport(campaignId, csvText) {
  const what = csvText ? 'this CSV' : 'the v12 tracker (74 rows)';
  if (!confirm('Import ' + what + (campaignId ? ' into this campaign' : ' into a new campaign') + '? Brands already in any campaign are skipped.')) return;
  try {
    const d = await voApi('importCsv', { id: campaignId || 0, csvText: csvText || undefined });
    const c = d.counts || {};
    alert('Imported ' + (c.imported || 0) + ' prospect(s)' + (c.disqualified ? ' (' + c.disqualified + ' disqualified, hidden by default)' : '') + (c.skipped_duplicate ? ', ' + c.skipped_duplicate + ' already existed' : '') + (c.failed ? ', ' + c.failed + ' failed' : '') + '.');
    await voLoadCampaigns();
    voOpenProspects(d.campaign.id);
  } catch (e) { alert(e.message); }
}

// ---- Prospects (5.3) ----
async function voOpenProspects(campaignId) {
  VO.filters.campaignId = campaignId || '';
  await voLoadProspects();
  voPane('prospects');
}
async function voLoadProspects() {
  try { const d = await voApi('prospects', { campaignId: VO.filters.campaignId || undefined, filters: VO.filters }); VO.prospects = d.prospects || []; VO.enums = d.enums || VO.enums; } catch (e) { VO.prospects = []; alert(e.message); }
  voRenderProspects();
}
function voRenderProspects() {
  const el = $('vo-pane-prospects'); if (!el) return;
  const f = VO.filters; const E = VO.enums || {};
  const camp = VO.campaigns.find((c) => String(c.id) === String(f.campaignId));
  const opt = (list, cur, allLabel) => '<option value="">' + allLabel + '</option>' + list.filter(Boolean).map((o) => '<option' + (cur === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
  const runs = Array.from(new Set(VO.prospects.map((p) => p.run_id).filter(Boolean)));
  const filters = '<div class="vo-filters">' +
    '<select id="vo-f-camp"><option value="">All campaigns</option>' + VO.campaigns.map((c) => '<option value="' + c.id + '"' + (String(c.id) === String(f.campaignId) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>' +
    '<select id="vo-f-run"><option value="">All runs</option>' + runs.map((r) => '<option value="' + r + '"' + (String(r) === String(f.run) ? ' selected' : '') + '>Run ' + r + '</option>').join('') + '</select>' +
    '<select id="vo-f-prio">' + opt(E.priority || [], f.priority, 'Any priority') + '</select>' +
    '<select id="vo-f-conn"><option value="">Any connection</option><option value="none"' + (f.connection === 'none' ? ' selected' : '') + '>Not requested</option>' + ['Applied', 'Pending', 'Connected'].map((o) => '<option' + (f.connection === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>' +
    '<select id="vo-f-style">' + opt(E.creative_style || [], f.creativeStyle, 'Any creative style') + '</select>' +
    '<select id="vo-f-stage">' + opt(E.outreach_stage || [], f.stage, 'Any stage') + '</select>' +
    '<input id="vo-f-q" type="search" placeholder="Search brand or domain" value="' + esc(f.q) + '" />' +
    '<label class="vo-chk"><input type="checkbox" id="vo-f-disq"' + (f.includeDisqualified ? ' checked' : '') + '/> Show disqualified</label></div>';
  const rows = VO.prospects.map((p) => '<tr data-id="' + p.id + '" class="vo-row">' +
    '<td><b>' + esc(p.brand) + '</b><div class="muted vo-small">' + esc(p.domain || '') + '</div></td>' +
    '<td>' + voPrio(p) + '</td><td class="num"><b>' + (p.priority_number == null ? '–' : p.priority_number) + '</b></td><td class="num">' + (p.score_total == null ? '–' : p.score_total) + '</td><td>' + esc(p.tier || '–') + '</td>' +
    '<td>' + voLink(p.dm_linkedin, 'LinkedIn') + '</td><td>' + voLink(p.brand_instagram, 'Instagram') + '</td>' +
    '<td>' + (p.linkedin_connection_state === 'Connected' ? '<span class="vo-yes">✓ Connected</span>' : esc(p.linkedin_connection_state || '–')) + '</td>' +
    '<td>' + esc(p.creative_style || '–') + '</td><td class="vo-small">' + esc(p.product_photo_check || '–') + '</td>' +
    '<td>' + voLink(p.suggested_product_url, p.suggested_product_name || 'product') + '</td>' +
    '<td>' + esc(p.dm_name || '–') + '<div class="muted vo-small">' + esc(p.dm_title || '') + '</div></td>' +
    '<td>' + esc(p.outreach_stage || 'Not contacted') + '</td><td class="vo-small">' + (p.last_event ? esc(p.last_event) + '<div class="muted">' + esc(voStamp(p.last_event_at)) + '</div>' : '<span class="muted">–</span>') + '</td></tr>').join('');
  el.innerHTML = '<div class="vo-bar"><div><h3 style="margin:0">' + (camp ? esc(camp.name) + ' · prospects' : 'All prospects') + '</h3><p class="muted view-sub" style="margin:2px 0 0">Sorted by Priority Number, then score. ' + VO.prospects.length + ' shown' + (f.includeDisqualified ? '' : ', disqualified hidden') + '. Click a row to open it.</p></div>' +
    '<div>' + (camp ? '<button class="ghost" id="vo-p-edit">Edit campaign</button> ' : '') + '<button class="ghost" id="vo-p-back">← Campaigns</button></div></div>' + filters +
    '<div class="tgt-scroll"><table class="cust-table vo-table vo-prospects"><thead><tr><th>Brand</th><th>Priority</th><th>Priority No.</th><th>Score</th><th>Tier</th><th>DM LinkedIn</th><th>Instagram</th><th>Connected?</th><th>Creative style</th><th>Product photo check</th><th>Suggested product</th><th>Decision maker</th><th>Outreach stage</th><th>Last event</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="14" class="muted" style="padding:16px">Nobody here yet. Import the v12 tracker from the campaign, or clear the filters.</td></tr>') + '</tbody></table></div>';
  $('vo-p-back').addEventListener('click', () => voPane('campaigns'));
  if ($('vo-p-edit')) $('vo-p-edit').addEventListener('click', () => voEditCampaign(camp.id));
  const rebind = (id, key, ev) => { const x = $(id); if (x) x.addEventListener(ev || 'change', () => { VO.filters[key] = x.type === 'checkbox' ? x.checked : x.value; voLoadProspects(); }); };
  rebind('vo-f-camp', 'campaignId'); rebind('vo-f-run', 'run'); rebind('vo-f-prio', 'priority'); rebind('vo-f-conn', 'connection'); rebind('vo-f-style', 'creativeStyle'); rebind('vo-f-stage', 'stage'); rebind('vo-f-disq', 'includeDisqualified');
  { const qEl = $('vo-f-q'); let t = null; if (qEl) qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { VO.filters.q = qEl.value; voLoadProspects(); }, 350); }); }
  el.querySelectorAll('tr.vo-row').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('a')) return; voOpenProspect(Number(tr.dataset.id)); }));
}

// ---- Prospect detail (5.3b), full-width pane ----
async function voOpenProspect(id) {
  let d; try { d = await voApi('prospect', { id: id }); } catch (e) { alert(e.message); return; }
  VO.prospect = d.prospect; VO.enums = d.enums || VO.enums; VO.placeholder = d.placeholder || VO.placeholder;
  voRenderDetail(d);
  voPane('detail');
}
function voSignalRows(group, labels) {
  if (!group) return '<tr><td colspan="3" class="muted">Unscored</td></tr>';
  return Object.entries(group).map(([k, v]) => { const val = v && typeof v.value === 'object' && v.value !== null ? JSON.stringify(v.value) : String(v && v.value != null ? v.value : '–'); return '<tr><td>' + esc(labels[k] || k) + '</td><td class="vo-small">' + esc(val === 'true' ? 'yes' : (val === 'false' ? 'no' : val)) + '</td><td class="num"><b>' + (v ? v.points : 0) + '</b></td></tr>'; }).join('');
}
function voRenderDetail(d) {
  const p = d.prospect; const E = VO.enums || {}; const bd = p.score_breakdown || null;
  const L = { active_meta_ads: 'Active Meta ads', video_share: 'Video share', new_ads_30d: 'New ads last 30d', other_paid_channels: 'Other paid channels', skus: 'SKUs', employees: 'Employees', traffic_proxy: 'Traffic proxy', growth: 'Growth signals', pays_for_creative: 'Pays for creative', creative_gap: 'Creative gap', video_sourcing: 'Video sourcing', trigger_event: 'Trigger event', dm_active_90d: 'DM active 90d', second_contact_with_email: '2nd contact with email', no_gatekeeper: 'No gatekeeper' };
  const scoreBox = (t, max, g, pts) => '<div class="vo-scorebox"><div class="vo-scorebox-h"><b>' + t + '</b><span>' + (pts == null ? '–' : pts) + ' / ' + max + '</span></div><table class="vo-mini"><tbody>' + voSignalRows(g, L) + '</tbody></table></div>';
  const msg = (label, key, text, kind) => '<div class="vo-msg"><div class="vo-msg-h"><b>' + label + '</b><div><button class="ghost sm vo-copy" data-copy="' + key + '">📋 Copy</button> <button class="ghost sm" disabled title="Email sending arrives in Phase 2">✉️ Send by email</button></div></div><textarea class="vo-msgtext" data-msg="' + key + '" rows="' + (kind === 'note' ? 3 : 7) + '">' + esc(text || '') + '</textarea></div>';
  const inp = (k, type, extra) => '<input type="' + (type || 'text') + '" data-e="' + k + '" value="' + esc(p[k] == null ? '' : p[k]) + '"' + (extra || '') + ' />';
  const yn = (k) => '<select data-e="' + k + '"><option value=""' + (p[k] == null ? ' selected' : '') + '>–</option><option value="Y"' + (p[k] === true ? ' selected' : '') + '>Y</option><option value="N"' + (p[k] === false ? ' selected' : '') + '>N</option></select>';
  const sel = (k, opts) => '<select data-e="' + k + '">' + opts.map((o) => '<option value="' + esc(o) + '"' + (String(p[k] == null ? '' : p[k]) === String(o) ? ' selected' : '') + '>' + esc(o || '–') + '</option>').join('') + '</select>';
  const r = (label, control) => '<tr><th>' + label + '</th><td>' + control + '</td></tr>';
  const stageNext = (d.stageNext && d.stageNext[p.outreach_stage]) || [];
  const stageOpts = [p.outreach_stage].concat(stageNext, ['Replied', 'Dead']).filter((x, i, a) => x && a.indexOf(x) === i);
  const conn = p.linkedin_connection_state || null;
  const connOpts = conn === null ? ['', 'Applied'] : (conn === 'Applied' ? ['Applied', 'Pending', 'Connected', ''] : (conn === 'Pending' ? ['Pending', 'Connected', ''] : ['Connected']));
  const html = '<div class="vo-bar"><div><h3 style="margin:0">' + esc(p.brand) + ' ' + voPrio(p) + ' <span class="muted">No. ' + (p.priority_number == null ? '–' : p.priority_number) + ' · score ' + (p.score_total == null ? '–' : p.score_total) + ' · ' + esc(p.tier || 'Unscored') + '</span></h3>' +
      '<p class="muted view-sub" style="margin:2px 0 0">' + esc(p.category || '') + ' · ' + esc(p.country || '') + ' · ' + voLink(p.website || p.domain, p.domain) + (p.disqualified_reason ? ' · <span class="vo-disq">Disqualified: ' + esc(p.disqualified_reason) + '</span>' : '') + '</p></div>' +
      '<div><button class="ghost" id="vo-d-back">← Prospects</button> ' + (p.dm_linkedin ? '<a class="ghost btn" href="' + esc(/^https?:/i.test(p.dm_linkedin) ? p.dm_linkedin : 'https://' + p.dm_linkedin) + '" target="_blank" rel="noopener">in LinkedIn profile ↗</a> ' : '<button class="ghost" disabled>No LinkedIn on file</button> ') +
      (p.brand_instagram ? '<a class="ghost btn" href="' + esc(p.brand_instagram) + '" target="_blank" rel="noopener">📸 Instagram ↗</a>' : '<button class="ghost" disabled title="Add the brand Instagram in the editable fields">📸 No Instagram yet</button>') + '</div></div>' +
    '<div class="vo-grid">' +
      '<div class="vo-col">' +
        '<h4>Score breakdown <span class="muted vo-small">' + esc(p.score_version || '') + '</span></h4>' +
        scoreBox('A. Need for video volume', 40, bd && bd.A, p.score_a) + scoreBox('B. Ability to pay', 25, bd && bd.B, p.score_b) + scoreBox('C. Opportunity fit', 20, bd && bd.C, p.score_c) + scoreBox('D. Accessibility', 15, bd && bd.D, p.score_d) +
        '<h4>Sample ads</h4><p class="muted vo-small">Ad samples with thumbnails arrive with Meta Ad Library sourcing in Phase 3.</p>' +
        '<h4>Tracking</h4><table class="vo-form"><tbody>' +
          r('LinkedIn connection', '<select id="vo-conn">' + connOpts.map((o) => '<option value="' + o + '"' + ((conn || '') === o ? ' selected' : '') + '>' + (o || 'Not requested') + '</option>').join('') + '</select> <button class="ghost sm" id="vo-conn-save">Set</button>' + (p.linkedin_request_sent_at ? '<div class="muted vo-small">requested ' + esc(voStamp(p.linkedin_request_sent_at)) + '</div>' : '') + (p.linkedin_connected_at ? '<div class="muted vo-small">connected ' + esc(voStamp(p.linkedin_connected_at)) + '</div>' : '')) +
          r('Outreach stage', '<select id="vo-stage">' + stageOpts.map((o) => '<option' + (o === p.outreach_stage ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select> <select id="vo-variant"><option value="">variant…</option>' + (E.variant_used || []).map((o) => '<option' + (p.variant_used === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select> <button class="ghost sm" id="vo-stage-save">Set</button><div class="muted vo-small">Only the allowed next steps are listed.</div>') +
          r('Outcome', '<select id="vo-outcome">' + (E.outcome || [null]).map((o) => '<option value="' + (o || '') + '"' + ((p.outcome || '') === (o || '') ? ' selected' : '') + '>' + (o || '–') + '</option>').join('') + '</select> <button class="ghost sm" id="vo-outcome-save">Set</button>') +
          r('Add a note', '<input type="text" id="vo-note" placeholder="what happened" /> <button class="ghost sm" id="vo-note-save">Add</button>') +
        '</tbody></table>' +
        '<h4>Events</h4>' + ((p.events || []).length ? '<table class="vo-mini"><tbody>' + p.events.map((e) => '<tr><td class="vo-small muted">' + esc(voStamp(e.at)) + '</td><td><b>' + esc(e.step) + '</b>' + (e.channel ? ' <span class="muted">' + esc(e.channel) + '</span>' : '') + (e.detail ? '<div class="vo-small">' + esc(e.detail) + '</div>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted vo-small">No events yet.</p>') +
      '</div>' +
      '<div class="vo-col">' +
        '<h4>Suggested product</h4><div class="vo-product">' + (p.suggested_product_url ? voLink(p.suggested_product_url, p.suggested_product_name || p.suggested_product_url) : '<span class="muted">none yet</span>') + '<div class="vo-small">Photo check: <b>' + esc(p.product_photo_check || 'Unverified') + '</b></div>' + (p.why_this_product ? '<div class="vo-small muted">' + esc(p.why_this_product) + '</div>' : '') + '<p class="muted vo-small">Gallery thumbnails arrive with the Shopify products fetch in Phase 2.</p></div>' +
        '<h4>Video URL</h4><div class="vo-video"><input type="url" id="vo-video" placeholder="https://… paste the finished video link" value="' + esc(p.video_url || '') + '" /> <button class="primary sm" id="vo-video-save">Save</button><div class="muted vo-small">Replaces <code>' + esc(VO.placeholder) + '</code> in Message A.</div></div>' +
        '<h4>Messages <span class="muted vo-small">signed off as ' + esc((VO.profile && VO.profile.sender_first) || 'AJ') + '</span></h4>' +
        msg('Connection note (max 300, no link)', 'connection_note', p.connection_note, 'note') + msg('Message A (video sent)', 'message_a', p.message_a) + msg('Message B (permission-led)', 'message_b', p.message_b) +
        '<details class="vo-details"><summary>Follow-ups (3 to 4 days, then 7 days)</summary>' + (d.followups ? msg('Follow-up 1', 'followup_1', d.followups.followup_1) + msg('Follow-up 2', 'followup_2', d.followups.followup_2) : '') + '</details>' +
        '<div class="vo-msgacts"><button class="ghost sm" id="vo-msg-save">Save edited message text</button> <button class="ghost sm" id="vo-msg-regen" title="Rebuild the three messages from the templates">↻ Regenerate from templates</button></div>' +
        '<h4>Editable fields <span class="muted vo-small">saving recalculates the score</span></h4>' +
        '<table class="vo-form vo-edit"><tbody>' +
          r('Brand', inp('brand')) + r('Website', inp('website')) + r('Category', inp('category')) + r('Country', inp('country')) +
          r('Active Meta ads', inp('active_meta_ads', 'number')) + r('Video ads', inp('video_ads', 'number')) + r('New ads last 30d', inp('new_ads_30d', 'number')) + r('Other paid channels (0-3)', inp('other_paid_channels', 'number')) + r('Creative style', sel('creative_style', [''].concat(E.creative_style || []))) +
          r('SKUs', inp('skus', 'number')) + r('Employees', inp('employees', 'number')) + r('Monthly visits', inp('monthly_visits', 'number')) + r('Amazon reviews (hero)', inp('amazon_reviews_hero', 'number')) + r('Shopify Plus', yn('shopify_plus')) + r('Growth signals (0-3)', inp('growth_signals', 'number')) + r('Pays for creative', yn('pays_for_creative')) + r('Video sourcing', sel('video_sourcing', E.video_sourcing || [])) +
          r('Creative gap (0, 4, 8)', sel('creative_gap', ['0', '4', '8'])) + r('Trigger event', yn('trigger_event')) + r('Trigger note', inp('trigger_note')) +
          r('DM name', inp('dm_name')) + r('DM title', inp('dm_title')) + r('DM LinkedIn', inp('dm_linkedin')) + r('DM active 90d', sel('dm_active_90d', E.dm_active_90d || [])) + r('DM email', inp('dm_email', 'email')) + r('2nd contact name', inp('second_contact_name')) + r('2nd contact email', inp('second_contact_email', 'email')) + r('2nd contact has email', yn('second_contact_has_email')) + r('Gatekeeper', yn('gatekeeper')) +
          r('Brand Instagram', inp('brand_instagram', 'url')) + r('Suggested product URL', inp('suggested_product_url', 'url')) + r('Suggested product name', inp('suggested_product_name')) + r('Product photo check', inp('product_photo_check')) + r('Why this product', inp('why_this_product')) + r('Observation (for the message)', inp('observation')) +
          r('Disqualified reason', inp('disqualified_reason')) + r('Notes', inp('notes')) +
        '</tbody></table><div class="vo-msgacts"><button class="primary" id="vo-edit-save">Save and recalculate</button></div>' +
      '</div></div>';
  const el = $('vo-pane-detail'); el.innerHTML = html;
  $('vo-d-back').addEventListener('click', () => { voLoadProspects().then(() => voPane('prospects')); });
  el.querySelectorAll('.vo-copy').forEach((b) => b.addEventListener('click', () => { const ta = el.querySelector('textarea[data-msg="' + b.dataset.copy + '"]'); voCopy(b, ta ? ta.value : ''); }));
  const refresh = async (d2) => { VO.prospect = d2.prospect; const full = await voApi('prospect', { id: p.id }); voRenderDetail(full); };
  $('vo-video-save').addEventListener('click', async () => { try { const d2 = await voApi('setVideoUrl', { id: p.id, url: $('vo-video').value }); voToast('Video URL saved, Message A updated'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-conn-save').addEventListener('click', async () => { try { const d2 = await voApi('setConnectionState', { id: p.id, state: $('vo-conn').value || null }); voToast('Connection state set'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-stage-save').addEventListener('click', async () => { try { const d2 = await voApi('setStage', { id: p.id, stage: $('vo-stage').value, variant_used: $('vo-variant').value || undefined }); voToast('Stage set'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-outcome-save').addEventListener('click', async () => { try { const d2 = await voApi('setOutcome', { id: p.id, outcome: $('vo-outcome').value || null }); voToast('Outcome set'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-note-save').addEventListener('click', async () => { const n = $('vo-note').value.trim(); if (!n) return; try { const d2 = await voApi('addNote', { id: p.id, note: n }); voToast('Note added'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-msg-save').addEventListener('click', async () => { const fields = {}; el.querySelectorAll('textarea[data-msg]').forEach((t) => { if (['connection_note', 'message_a', 'message_b'].includes(t.dataset.msg)) fields[t.dataset.msg] = t.value; }); try { const d2 = await voApi('updateProspect', { id: p.id, fields: fields }); voToast('Messages saved'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-msg-regen').addEventListener('click', async () => { try { const d2 = await voApi('updateProspect', { id: p.id, fields: { observation: p.observation || '' } }); voToast('Messages rebuilt'); refresh(d2); } catch (e) { alert(e.message); } });
  $('vo-edit-save').addEventListener('click', async () => {
    const fields = {}; el.querySelectorAll('[data-e]').forEach((x) => { fields[x.dataset.e] = x.value === '' ? null : x.value; });
    try { const d2 = await voApi('updateProspect', { id: p.id, fields: fields }); voToast('Saved, score recalculated'); refresh(d2); } catch (e) { alert(e.message); }
  });
}
