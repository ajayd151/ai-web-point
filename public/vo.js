// Video Outreach UI (spec v4 section 5, Phases 1 to 5). Loaded after app.js and reuses its helpers
// ($, esc, showView). Panes inside the Video Outreach view: Campaigns, Campaign edit, Prospects,
// Prospect detail (full width), Ready to send, Results, Settings. Everything is edited in-app as
// table rows; the v12 tracker CSV is only a one-time seed.
var VO = { campaigns: [], campaign: null, prospects: [], prospect: null, enums: null, profile: null, providers: {}, linkedin: {}, placeholder: '[insert URL here]', pane: 'campaigns',
  filters: { campaignId: '', run: '', priority: '', connection: '', creativeStyle: '', stage: '', q: '', includeDisqualified: false }, loaded: false, poll: null, editTranslated: null };

async function voApi(action, payload) {
  const r = await fetch('/api/vo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: action }, payload || {})) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
function voPane(name) {
  VO.pane = name;
  ['campaigns', 'edit', 'prospects', 'detail', 'ready', 'results', 'settings'].forEach((p) => { const el = $('vo-pane-' + p); if (el) el.classList.toggle('hidden', p !== name); });
  const tab = name === 'edit' ? 'campaigns' : (name === 'detail' ? 'prospects' : name);
  document.querySelectorAll('.vo-tab').forEach((b) => b.classList.toggle('active', b.dataset.vopane === tab));
  try { window.scrollTo({ top: 0 }); } catch (e) {}
}
async function voShow() {
  await voLoadCampaigns();
  if (!VO.loaded) { voPane('campaigns'); VO.loaded = true; }
}
document.querySelectorAll('.vo-tab').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.vopane;
  if (t === 'prospects') { VO.filters.campaignId = ''; voOpenProspects(''); }
  else if (t === 'ready') voOpenReady();
  else if (t === 'results') voOpenResults();
  else if (t === 'settings') voOpenSettings();
  else voPane('campaigns');
}));

// ---- helpers ----
var VO_NOIMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='90'><rect width='100%' height='100%' fill='%23eef2f7'/><text x='50%' y='54%' font-size='11' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif'>no image</text></svg>";
var VO_IMG_FALLBACK = ' onerror="this.onerror=null;this.src=VO_NOIMG"';
var VO_PRIO_CLASS = { 'Must target': 'p1', 'Strong': 'p2', 'Possible': 'p3', 'Later': 'p4', 'Unlikely': 'p5', 'Skip': 'p6' };
function voPrio(p) { return p.priority ? '<span class="vo-prio ' + (VO_PRIO_CLASS[p.priority] || '') + '">' + esc(p.priority) + '</span>' : '<span class="vo-prio p0">Unscored</span>'; }
function voStamp(ts) { if (!ts) return ''; try { return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function voLink(url, label) { if (!url) return '<span class="muted">–</span>'; const u = /^https?:\/\//i.test(url) ? url : 'https://' + url; return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || 'open') + ' ↗</a>'; }
function voList(v) { return Array.isArray(v) ? v.join('\n') : (v || ''); }
function voLines(s) { return String(s || '').split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean); }
function voMoney(n) { return '£' + Number(n || 0).toFixed(2); }
async function voCopy(btn, text) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = o; }, 1400); }
  catch (e) { alert('Could not copy, select the text and copy it by hand.'); }
}
function voToast(msg) { const t = $('vo-toast') || (function () { const d = document.createElement('div'); d.id = 'vo-toast'; d.className = 'vo-toast'; document.body.appendChild(d); return d; })(); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); }
function voBanner() {
  const el = $('vo-banner'); if (!el) return;
  const li = VO.linkedin || {};
  if (li.paused) { el.className = 'vo-banner'; el.innerHTML = '⚠️ <b>LinkedIn automation is paused</b>: ' + esc(li.paused_reason || 'provider reported a problem') + '. Nothing automatic is being sent. Review in Settings, then resume.'; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}
function voOn(id, ev, fn) { const x = $(id); if (x) x.addEventListener(ev, fn); }

// ---- Campaigns (5.1) ----
async function voLoadCampaigns() {
  try { const d = await voApi('campaigns'); VO.campaigns = d.campaigns || []; VO.enums = d.enums; VO.profile = d.profile; VO.placeholder = d.placeholder || VO.placeholder; VO.providers = d.providers || {}; VO.linkedin = d.linkedin || {}; } catch (e) { VO.campaigns = []; }
  voBanner();
  voRenderCampaigns();
}
function voSchedText(c) {
  if (c.schedule === 'One-off') return 'One-off';
  let s = c.schedule; if (c.schedule === 'Weekly' && Array.isArray(c.schedule_days) && c.schedule_days.length) s += ' (' + c.schedule_days.join(', ') + ')';
  return s + ' at ' + (c.run_time || '06:00') + (c.status === 'Active' ? '<div class="muted vo-small">next: ' + (c.schedule === 'Daily' ? 'tomorrow ' : 'next due day ') + (c.run_time || '06:00') + '</div>' : '');
}
function voRenderCampaigns() {
  const el = $('vo-pane-campaigns'); if (!el) return;
  const rows = VO.campaigns.map((c) => '<tr data-id="' + c.id + '">' +
    '<td><b>' + esc(c.name) + '</b><div class="muted vo-small">' + esc(c.industry || '') + (Array.isArray(c.keywords) && c.keywords.length ? ' · ' + c.keywords.length + ' keywords' : '') + '</div></td>' +
    '<td>' + esc((c.countries || []).join(', ')) + '</td>' +
    '<td>' + voSchedText(c) + '</td>' +
    '<td><span class="vo-status st-' + esc(c.status) + '">' + esc(c.status) + '</span>' + (c.last_run_at ? '<div class="muted vo-small">last run ' + esc(voStamp(c.last_run_at)) + '</div>' : '') + '</td>' +
    '<td class="num">' + (c.prospects_found || 0) + '</td><td class="num">' + (c.connected || 0) + '</td><td class="num">' + (c.replied || 0) + '</td>' +
    '<td class="num">' + voMoney(c.cost_to_date) + '</td>' +
    '<td class="vo-acts"><button class="ghost sm" data-act="prospects">Prospects</button><button class="ghost sm" data-act="edit">Edit</button><button class="ghost sm" data-act="dup">Duplicate</button>' +
      (c.status === 'Paused' ? '<button class="ghost sm" data-act="resume">Resume</button>' : '<button class="ghost sm" data-act="pause">Pause</button>') +
      '<button class="primary sm" data-act="run"' + (Array.isArray(c.keywords) && c.keywords.length ? '' : ' disabled title="Add search keywords first"') + '>▶ Run now</button></td></tr>').join('');
  el.innerHTML = '<div class="vo-bar"><p class="muted view-sub" style="margin:0">A campaign is a saved set of criteria. <b>Run now</b> sources brands from the Meta Ad Library and Apollo, scores them and drafts the messages. Without provider keys it runs in dry-run mode on the tracker data.</p>' +
    '<div><button class="primary" id="vo-new">＋ New campaign</button> <button class="ghost" id="vo-seed" title="Create a campaign and import the 74-row v12 tracker into it">📥 Import v12 tracker</button></div></div>' +
    (VO.campaigns.length ? '<div class="tgt-scroll"><table class="cust-table vo-table"><thead><tr><th>Name</th><th>Country</th><th>Schedule</th><th>Status</th><th>Prospects</th><th>Connected</th><th>Replied</th><th>Cost</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="muted" style="padding:14px 0">No campaigns yet. Click <b>Import v12 tracker</b> to seed the first one with the 74 researched brands (59 qualified, 15 disqualified), or <b>New campaign</b>.</p>');
  voOn('vo-new', 'click', () => voEditCampaign(null));
  voOn('vo-seed', 'click', () => voImport(null));
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async (e) => {
    const id = Number(b.closest('tr').dataset.id); const act = b.dataset.act;
    try {
      if (act === 'prospects') return voOpenProspects(id);
      if (act === 'edit') return voEditCampaign(id);
      if (act === 'dup') { await voApi('duplicateCampaign', { id: id }); voToast('Duplicated'); return voLoadCampaigns(); }
      if (act === 'pause' || act === 'resume') { await voApi('setCampaignStatus', { id: id, status: act === 'pause' ? 'Paused' : 'Active' }); return voLoadCampaigns(); }
      if (act === 'run') { await voEditCampaign(id); return voRunNow(id); }
    } catch (err) { alert(err.message); }
  }));
}

// ---- Campaign edit (5.2), the 2.1 form as table rows ----
async function voEditCampaign(id) {
  let c = null, runs = [], est = null, presets = [], templates = {}, running = [];
  if (id) { try { const d = await voApi('campaign', { id: id }); c = d.campaign; runs = d.runs || []; est = d.estimate; presets = d.presets || []; templates = d.templates || {}; VO.providers = d.providers || VO.providers; running = d.running || []; } catch (e) { alert(e.message); return; } }
  else { try { const d = await voApi('presets'); presets = d.presets || []; } catch (e) {} }
  VO.campaign = c; VO.est = est; VO.editTranslated = (c && c.keywords_translated) || null;
  const sp = Object.assign({}, VO.profile || {}, (c && c.service_profile) || {});
  const ts = Object.assign({}, templates, (c && c.template_set) || {});
  const auto = (c && c.automation) || {};
  const end = (c && c.end_condition) || {};
  const v = (k, dflt) => (c && c[k] != null ? c[k] : dflt);
  const row = (label, input, hint) => '<tr><th>' + label + (hint ? '<div class="muted vo-small">' + hint + '</div>' : '') + '</th><td>' + input + '</td></tr>';
  const sec = (t) => '<tr class="vo-sec"><th colspan="2">' + t + '</th></tr>';
  const txt = (k, dflt, ph, extra) => '<input type="text" data-f="' + k + '" value="' + esc(v(k, dflt)) + '" placeholder="' + esc(ph || '') + '"' + (extra || '') + ' />';
  const num = (k, dflt) => '<input type="number" data-f="' + k + '" value="' + esc(v(k, dflt)) + '" style="width:120px" />';
  const chk = (k, dflt) => '<input type="checkbox" data-f="' + k + '"' + (v(k, dflt) ? ' checked' : '') + ' />';
  const ta = (k, dflt, ph, rows) => '<textarea data-f="' + k + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph || '') + '">' + esc(voList(v(k, dflt))) + '</textarea>';
  const sel = (k, opts, dflt) => '<select data-f="' + k + '">' + opts.map((o) => '<option' + (v(k, dflt) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  const bands = ['1-10', '11-50', '51-100', '101-200']; const curBands = v('size_bands', ['1-10', '11-50']);
  const chans = ['LinkedIn', 'Email', 'Instagram']; const curCh = v('channels', ['LinkedIn', 'Email']);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; const curDays = v('schedule_days', ['Mon']);
  const P = VO.providers || {}; const liOn = P.linkedin && P.linkedin !== 'off';
  const html = '<div class="vo-bar"><h3 style="margin:0">' + (c ? 'Edit campaign' : 'New campaign') + '</h3><div><button class="ghost" id="vo-back">← Campaigns</button> ' + (c ? '<button class="ghost" id="vo-goprospects">Prospects →</button> <button class="primary" id="vo-run">▶ Run now</button> ' : '') + '<button class="primary" id="vo-save">Save</button></div></div>' +
    (c ? '<div id="vo-runbox"></div>' : '<p class="muted vo-small">Save the campaign first, then Run now appears here.</p>') +
    '<table class="vo-form"><tbody>' +
    sec('Basics') + row('Name', txt('name', '', 'e.g. US Face Creams Sep 26')) + row('Status', sel('status', ['Draft', 'Active', 'Paused', 'Finished'], 'Draft')) + row('Owner', txt('owner_email', '', 'you@company.com')) + row('Notes', ta('notes', '')) +
    sec('Who to find') +
    row('Industry', txt('industry', '', 'e.g. Face creams') + ' <button class="ghost sm" id="vo-suggest" type="button">✨ Suggest keywords</button>', 'The suggester writes 10 to 20 shopper search terms into the box below. Keywords, not the label, drive sourcing.') +
    row('Search keywords', ta('keywords', [], 'one per line, e.g. creatine gummies', 6) + '<div class="vo-help" id="vo-translated">' + (VO.editTranslated ? 'Translated keywords saved for: ' + esc(Object.keys(VO.editTranslated).join(', ')) : '') + '</div>' +
      '<div>Preset: <select id="vo-preset"><option value="">choose…</option>' + presets.map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' (' + (p.keywords || []).length + ')</option>').join('') + '</select> <button class="ghost sm" id="vo-preset-load" type="button">Load</button> <button class="ghost sm" id="vo-preset-save" type="button">Save keywords as preset</button></div>') +
    row('Country', txt('countries', ['US'], 'US, UK'), 'comma separated; Ad Library and Apollo are queried per country') + row('Language of outreach', txt('language', 'English')) +
    row('Company size band', bands.map((b) => '<label class="vo-chk"><input type="checkbox" data-band="' + b + '"' + (curBands.includes(b) ? ' checked' : '') + '/> ' + b + '</label>').join(' ')) +
    row('Store platform', sel('store_platform', ['Shopify only', 'Any'], 'Shopify only')) + row('Meta advertisers only', chk('meta_only', true) + ' &nbsp; minimum active Meta ads ' + num('min_meta_ads', 10)) +
    row('Video advertisers only', chk('video_only', false) + ' &nbsp; minimum video share % ' + num('min_video_share', 20)) +
    row('Exclusion list (this campaign)', ta('exclusions', [], 'household names, one per line'), 'the global list in Settings always applies too') + row('Exclude brands already in any campaign', chk('exclude_in_any_campaign', true)) +
    row('Exclude my clients and competitors', ta('exclude_domains', [], 'domains, one per line')) + row('Seed brands (up to 10)', ta('seed_brands', [], 'domains, one per line'), 'their brand names are added to the ad search') +
    sec('How many and how often') + row('Target prospects per run', num('target_per_run', 20), 'new qualified prospects, score at or above the minimum') + row('Raw candidate cap per run', num('raw_cap', 400)) + row('Cost cap per run (£)', num('cost_cap', 10)) +
    row('Minimum prospect score to keep', num('min_score', 55), 'below this the brand is stored as Park') +
    row('Schedule', sel('schedule', ['One-off', 'Daily', 'Weekly', 'Monthly'], 'One-off') + ' <span class="vo-small">days: ' + days.map((d) => '<label class="vo-chk"><input type="checkbox" data-day="' + d + '"' + (curDays.includes(d) ? ' checked' : '') + '/> ' + d + '</label>').join(' ') + '</span>', 'Weekly uses the ticked days. The worker checks every 10 minutes and starts the run after the run time.') +
    row('Run time', txt('run_time', '06:00', '06:00', ' style="width:90px"') + ' &nbsp; time zone ' + txt('timezone', 'Europe/London', 'Europe/London', ' style="width:180px"')) +
    row('End condition', 'until date <input type="date" id="vo-end-date" value="' + esc(String(end.until_date || '').slice(0, 10)) + '" /> &nbsp; or until total prospects <input type="number" id="vo-end-total" value="' + esc(end.until_total || '') + '" style="width:100px" />', 'leave both blank to run until paused') +
    row('Re-check cadence (days)', num('recheck_days', 30), 'ad counts are re-pulled and the score refreshed after this many days') +
    sec('Who to contact') + row('Founder/CEO if employees below', num('role_rule_employees', 20), 'else Growth / Performance / Paid Social lead first, founder as second contact') + row('Accepted titles', ta('accepted_titles', [], 'one per line, leave blank for the default list')) +
    row('Channels', chans.map((b) => '<label class="vo-chk"><input type="checkbox" data-chan="' + b + '"' + (curCh.includes(b) ? ' checked' : '') + '/> ' + b + '</label>').join(' ')) + row('Fetch emails for', sel('fetch_emails_for', ['priority_number <= 3', 'All'], 'priority_number <= 3'), 'saves Apollo credits') +
    sec('What to say (service profile, per campaign)') + row('I run …', '<input type="text" data-sp="service_name" value="' + esc(sp.service_name || '') + '" />') + row('Service description', '<input type="text" data-sp="service_desc" value="' + esc(sp.service_desc || '') + '" />') +
    row('Sender first name', '<input type="text" data-sp="sender_first" value="' + esc(sp.sender_first || '') + '" />') + row('Sign-off', '<input type="text" data-sp="signoff" value="' + esc(sp.signoff || '') + '" />') +
    row('Offer line', '<input type="text" data-sp="offer_line" value="' + esc(sp.offer_line || '') + '" />') + row('Pilot line', '<input type="text" data-sp="pilot_line" value="' + esc(sp.pilot_line || '') + '" />') + row('Free sample is', '<input type="text" data-sp="sample_what" value="' + esc(sp.sample_what || '') + '" />') +
    row('Email sender', '<input type="text" data-sp="email_from" value="' + esc(sp.email_from || '') + '" placeholder="aj@shekipro.com (a SendGrid verified sender)" />', 'blank = the VO_EMAIL_FROM env setting') +
    row('Default variant', sel('default_variant', ['A video sent', 'B permission', 'Split test 50:50'], 'A video sent')) +
    sec('Message template set (per campaign)') +
    row('Placeholders', '<span class="vo-small">{first} {service_name} {service_desc} {observation} {product} {video_url} {signoff} {sender_first} {offer_line} {pilot_line} {seasonal_event}. A blank line separates paragraphs. Blank box = the default template.</span>') +
    ['connection_note', 'message_a', 'message_b', 'followup_1', 'followup_2'].map((k) => row(k.replace('_', ' '), '<textarea data-tpl="' + k + '" rows="4">' + esc((c && c.template_set && c.template_set[k]) || '') + '</textarea><div class="vo-help">default: ' + esc(String(templates[k] || '').replace(/\n\n/g, ' / ')) + '</div>')).join('') +
    sec('Automation') +
    row('Auto follow-ups', '<input type="checkbox" data-auto="auto_followups"' + (auto.auto_followups ? ' checked' : '') + ' /> send Follow-up 1 (3 days) and Follow-up 2 (7 days) automatically on the channel Message 1 went out on', 'off = follow-ups wait as drafts in Ready to send') +
    row('Notify me when a run finishes', '<input type="checkbox" data-auto="notify_run_finished"' + (auto.notify_run_finished ? ' checked' : '') + ' /> email') +
    (liOn ? row('Auto-send connection requests', '<input type="checkbox" data-auto="auto_connect"' + (auto.auto_connect ? ' checked' : '') + ' /> only for priority number up to <input type="number" data-auto="max_priority" value="' + esc(auto.max_priority || 2) + '" style="width:70px" />', 'LinkedIn provider: ' + esc(P.linkedin) + (P.linkedin_configured ? ' (configured)' : ' (keys missing)') + '. Global caps live in Settings.') : row('LinkedIn automation', '<span class="muted">hidden until a LinkedIn provider is connected (VO_LINKEDIN_PROVIDER in Vercel)</span>')) +
    '</tbody></table>' +
    (c ? '<div class="vo-bar" style="margin-top:16px"><h3 style="margin:0">Import prospects</h3><div><button class="ghost" id="vo-import-fix">📥 Import v12 tracker</button> <label class="ghost vo-file">📄 Import CSV <input type="file" id="vo-import-file" accept=".csv,text/csv" hidden /></label></div></div>' +
      '<h3>Runs</h3>' + (runs.length ? '<div class="tgt-scroll"><table class="cust-table vo-table"><thead><tr><th>Started</th><th>Kind</th><th>Status</th><th>Raw</th><th>Qualified</th><th>Parked</th><th>Disq.</th><th>Cost</th><th>Stopped because / errors</th><th></th></tr></thead><tbody>' +
        runs.map((r) => { const k = r.counts || {}; return '<tr><td>' + esc(voStamp(r.started_at)) + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.status) + '</td><td class="num">' + (k.raw != null ? k.raw : (k.total || '')) + '</td><td class="num">' + (k.qualified != null ? k.qualified : (k.imported || '')) + '</td><td class="num">' + (k.parked || '') + '</td><td class="num">' + (k.disqualified || '') + '</td><td>' + voMoney(r.actual_cost) + '</td><td class="vo-small">' + esc((r.state && r.state.stop) || '') + (r.errors && r.errors.length ? '<div class="muted">' + esc(r.errors.slice(0, 3).join('; ')) + '</div>' : '') + '</td><td>' + (['Running', 'Queued'].includes(r.status) ? '' : '<button class="ghost sm vo-run-clear" data-run="' + r.id + '" title="Delete every prospect this run created so the campaign can run again">🗑 Clear prospects</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No runs yet.</p>') : '');
  const el = $('vo-pane-edit'); el.innerHTML = html; voPane('edit');
  voOn('vo-back', 'click', () => voPane('campaigns'));
  voOn('vo-goprospects', 'click', () => voOpenProspects(c.id));
  voOn('vo-import-fix', 'click', () => voImport(c.id));
  voOn('vo-run', 'click', () => voRunNow(c.id));
  voOn('vo-import-file', 'change', (e) => { const f = e.target.files && e.target.files[0]; if (f) { const rd = new FileReader(); rd.onload = () => voImport(c.id, String(rd.result || '')); rd.readAsText(f); } });
  voOn('vo-suggest', 'click', async () => {
    const ind = el.querySelector('[data-f="industry"]').value.trim(); if (!ind) { alert('Type the industry first.'); return; }
    const b = $('vo-suggest'); b.disabled = true; b.textContent = 'Thinking…';
    try {
      const countries = voLines(el.querySelector('[data-f="countries"]').value); const lang = el.querySelector('[data-f="language"]').value;
      const r = await voApi('suggestKeywords', { industry: ind, countries: countries, language: lang });
      const box = el.querySelector('[data-f="keywords"]'); const cur = voLines(box.value); r.keywords.forEach((k) => { if (!cur.includes(k)) cur.push(k); }); box.value = cur.join('\n');
      if (r.translated && Object.keys(r.translated).length) { VO.editTranslated = r.translated; $('vo-translated').textContent = 'Translated keywords ready for: ' + Object.keys(r.translated).join(', ') + ' (saved with the campaign)'; }
      voToast((r.dry ? 'AI is off, a basic list was added' : r.keywords.length + ' keywords suggested') + '. Edit, then save.');
    } catch (err) { alert(err.message); } finally { b.disabled = false; b.textContent = '✨ Suggest keywords'; }
  });
  voOn('vo-preset-load', 'click', () => { const p = presets.find((x) => String(x.id) === $('vo-preset').value); if (!p) return; const box = el.querySelector('[data-f="keywords"]'); box.value = (p.keywords || []).join('\n'); if (p.translations) VO.editTranslated = p.translations; if (!el.querySelector('[data-f="industry"]').value) el.querySelector('[data-f="industry"]').value = p.name; voToast('Preset loaded'); });
  voOn('vo-preset-save', 'click', async () => { const kws = voLines(el.querySelector('[data-f="keywords"]').value); if (!kws.length) { alert('No keywords to save.'); return; } const name = prompt('Preset name', el.querySelector('[data-f="industry"]').value || ''); if (!name) return; try { await voApi('savePreset', { name: name, keywords: kws, translations: VO.editTranslated || {} }); voToast('Preset saved'); } catch (err) { alert(err.message); } });
  if (c) { voRenderRunBox(c, running[0] || null, est); }
  el.querySelectorAll('.vo-run-clear').forEach((b) => b.addEventListener('click', async () => { const rid = Number(b.dataset.run); if (!confirm('Delete every prospect created by run ' + rid + '? Their events go too. Use this to redo a test run.')) return; try { const r = await voApi('deleteRunProspects', { id: rid }); alert('Deleted ' + r.deleted + ' prospect(s) (' + r.how + '), ' + r.remaining + ' left on this campaign.'); await voLoadCampaigns(); voEditCampaign(c.id); } catch (e) { alert(e.message); } }));
  voOn('vo-save', 'click', async () => {
    const data = voCollectCampaign(el, c);
    if (!data.name) { alert('Give the campaign a name.'); return; }
    try { const d = await voApi('saveCampaign', { campaign: data }); VO.campaign = d.campaign; voToast('Saved'); await voLoadCampaigns(); voEditCampaign(d.campaign.id); } catch (e) { alert(e.message); }
  });
}
function voCollectCampaign(el, c) {
  const data = { id: c ? c.id : undefined };
  el.querySelectorAll('[data-f]').forEach((inp) => {
    const k = inp.dataset.f;
    if (inp.type === 'checkbox') data[k] = inp.checked;
    else if (inp.tagName === 'TEXTAREA' || k === 'countries') data[k] = (k === 'notes') ? inp.value : voLines(inp.value);
    else data[k] = inp.value;
  });
  data.size_bands = Array.from(el.querySelectorAll('[data-band]')).filter((x) => x.checked).map((x) => x.dataset.band);
  data.channels = Array.from(el.querySelectorAll('[data-chan]')).filter((x) => x.checked).map((x) => x.dataset.chan);
  data.schedule_days = Array.from(el.querySelectorAll('[data-day]')).filter((x) => x.checked).map((x) => x.dataset.day);
  const prof = {}; el.querySelectorAll('[data-sp]').forEach((inp) => { prof[inp.dataset.sp] = inp.value; }); data.service_profile = prof;
  const tpl = {}; el.querySelectorAll('[data-tpl]').forEach((inp) => { if (inp.value.trim()) tpl[inp.dataset.tpl] = inp.value; }); data.template_set = tpl;
  const auto = {}; el.querySelectorAll('[data-auto]').forEach((inp) => { auto[inp.dataset.auto] = inp.type === 'checkbox' ? inp.checked : Number(inp.value) || null; }); data.automation = auto;
  const ed = $('vo-end-date') ? $('vo-end-date').value : ''; const et = $('vo-end-total') ? Number($('vo-end-total').value) : 0;
  data.end_condition = (ed || et) ? { until_date: ed || null, until_total: et || null } : null;
  if (VO.editTranslated) data.keywords_translated = VO.editTranslated;
  return data;
}
// Run box: estimate, Run now, live progress tiles, Stop. Polls runStep until the run reports done.
function voRenderRunBox(c, run, est) {
  const box = $('vo-runbox'); if (!box) return;
  const P = VO.providers || {};
  const dryNote = [P.apify ? '' : 'Apify', P.apollo ? '' : 'Apollo', P.openai ? '' : 'AI'].filter(Boolean);
  let html = '<div class="vo-progress">';
  if (est) html += '<div><span class="vo-est' + (est.over_cap ? ' over' : '') + '">Estimate per run: <b>' + voMoney(est.total) + '</b> (Apify ' + voMoney(est.apify) + ', Apollo ' + voMoney(est.apollo) + ' for ~' + est.apollo_credits + ' credits, AI ' + voMoney(est.ai) + ') for about ' + est.brands + ' brands' + (est.over_cap ? ', OVER the cost cap' : '') + '</span>' + (dryNote.length ? ' <span class="muted vo-small">dry run for ' + dryNote.join(', ') + ' (no key in Vercel), so those cost nothing and answer from the tracker data</span>' : '') + '</div>';
  if (run) {
    const k = (run.counts || (run.state && run.state.counts)) || {}; const live = ['Running', 'Queued'].includes(run.status);
    html += '<div class="vo-tiles"><div class="vo-tile"><b>' + (k.raw || 0) + '</b><span>raw candidates</span></div><div class="vo-tile"><b>' + (k.processed || 0) + '</b><span>processed</span></div><div class="vo-tile q"><b>' + (k.qualified || 0) + '</b><span>qualified</span></div><div class="vo-tile"><b>' + (k.parked || 0) + '</b><span>parked</span></div><div class="vo-tile d"><b>' + (k.disqualified || 0) + '</b><span>disqualified</span></div><div class="vo-tile c"><b>' + voMoney(run.actual_cost) + '</b><span>cost so far</span></div></div>' +
      '<div id="vo-runline" class="vo-small">' + (live ? '⏳ Run ' + run.id + ' in progress…' : '✓ Run ' + run.id + ' ' + esc(run.status) + (run.state && run.state.stop ? ': ' + esc(run.state.stop) : '')) + (run.errors && run.errors.length ? ' <span class="vo-no">' + run.errors.length + ' error(s): ' + esc(run.errors[0]) + '</span>' : '') + '</div>' +
      (live ? '<div style="margin-top:8px"><button class="ghost sm" id="vo-stop">■ Stop run</button></div>' : '<div style="margin-top:8px"><button class="ghost sm" id="vo-run-prospects">See the prospects →</button></div>');
  }
  html += '</div>';
  box.innerHTML = html;
  voOn('vo-stop', 'click', async () => { try { await voApi('stopRun', { id: run.id }); voToast('Stopping'); } catch (e) { alert(e.message); } });
  voOn('vo-run-prospects', 'click', () => voOpenProspects(c.id));
  if (run && ['Running', 'Queued'].includes(run.status)) voPollRun(c, run.id);
}
async function voRunNow(campaignId) {
  const P = VO.providers || {};
  const msg = 'Start a sourcing run for this campaign now?' + (P.apify || P.apollo ? ' Provider credits will be spent up to the cost cap.' : ' No provider keys are set, so this is a dry run on the tracker data.');
  if (!confirm(msg)) return;
  try {
    const d = await voApi('runNow', { id: campaignId });
    const c = VO.campaign && VO.campaign.id === campaignId ? VO.campaign : (VO.campaigns.find((x) => x.id === campaignId) || { id: campaignId });
    if (!$('vo-runbox')) await voEditCampaign(campaignId);
    if (d.done) { voToast('Run ' + d.status); await voLoadCampaigns(); await voEditCampaign(campaignId); voRenderRunBox(c, d.run, VO.est); return; }
    voRenderRunBox(c, d.run, null);
  } catch (e) { alert(e.message); }
}
function voPollRun(c, runId) {
  if (VO.poll) clearTimeout(VO.poll);
  VO.poll = setTimeout(async () => {
    try {
      const d = await voApi('runStep', { id: runId });
      if (VO.pane !== 'edit' || !$('vo-runbox')) return;
      if (d.done) { voToast('Run ' + d.status); await voLoadCampaigns(); await voEditCampaign(c.id); voRenderRunBox(c, d.run, VO.est); return; }
      voRenderRunBox(c, d.run, null);
    } catch (e) { const line = $('vo-runline'); if (line) line.innerHTML = '<span class="vo-no">' + esc(e.message) + '</span>'; }
  }, 1200);
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
    '<td><b>' + esc(p.brand) + '</b><div class="muted vo-small">' + esc(p.domain || '') + (p.source && p.source !== 'import' ? ' · ' + esc(p.source) : '') + '</div></td>' +
    '<td>' + voPrio(p) + '</td><td class="num"><b>' + (p.priority_number == null ? '–' : p.priority_number) + '</b></td><td class="num">' + (p.score_total == null ? '–' : p.score_total) + '</td><td>' + esc(p.tier || '–') + '</td>' +
    '<td>' + voLink(p.dm_linkedin, 'LinkedIn') + '</td><td>' + voLink(p.brand_instagram, 'Instagram') + '</td>' +
    '<td>' + (p.linkedin_connection_state === 'Connected' ? '<span class="vo-yes">✓ Connected</span>' : esc(p.linkedin_connection_state || '–')) + '</td>' +
    '<td>' + esc(p.creative_style || '–') + '</td><td class="vo-small">' + esc(p.product_photo_check || '–') + '</td>' +
    '<td>' + voLink(p.suggested_product_url, p.suggested_product_name || 'product') + '</td>' +
    '<td>' + esc(p.dm_name || '–') + '<div class="muted vo-small">' + esc(p.dm_title || '') + '</div></td>' +
    '<td>' + esc(p.outreach_stage || 'Not contacted') + (p.last_reply_at ? '<div class="vo-yes vo-small">replied ' + esc(voStamp(p.last_reply_at)) + '</div>' : '') + '</td><td class="vo-small">' + (p.last_event ? esc(p.last_event) + '<div class="muted">' + esc(voStamp(p.last_event_at)) + '</div>' : '<span class="muted">–</span>') + '</td></tr>').join('');
  el.innerHTML = '<div class="vo-bar"><div><h3 style="margin:0">' + (camp ? esc(camp.name) + ' · prospects' : 'All prospects') + '</h3><p class="muted view-sub" style="margin:2px 0 0">Sorted by Priority Number, then score. ' + VO.prospects.length + ' shown' + (f.includeDisqualified ? '' : ', disqualified hidden') + '. Click a row to open it.</p></div>' +
    '<div>' + (camp ? '<button class="ghost" id="vo-p-edit">Edit campaign</button> ' : '') + '<button class="ghost" id="vo-p-back">← Campaigns</button></div></div>' + filters +
    '<div class="tgt-scroll"><table class="cust-table vo-table vo-prospects"><thead><tr><th>Brand</th><th>Priority</th><th>Priority No.</th><th>Score</th><th>Tier</th><th>DM LinkedIn</th><th>Instagram</th><th>Connected?</th><th>Creative style</th><th>Product photo check</th><th>Suggested product</th><th>Decision maker</th><th>Outreach stage</th><th>Last event</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="14" class="muted" style="padding:16px">Nobody here yet. Run the campaign, import the v12 tracker, or clear the filters.</td></tr>') + '</tbody></table></div>';
  voOn('vo-p-back', 'click', () => voPane('campaigns'));
  voOn('vo-p-edit', 'click', () => voEditCampaign(camp.id));
  const rebind = (id, key) => { const x = $(id); if (x) x.addEventListener('change', () => { VO.filters[key] = x.type === 'checkbox' ? x.checked : x.value; voLoadProspects(); }); };
  rebind('vo-f-camp', 'campaignId'); rebind('vo-f-run', 'run'); rebind('vo-f-prio', 'priority'); rebind('vo-f-conn', 'connection'); rebind('vo-f-style', 'creativeStyle'); rebind('vo-f-stage', 'stage'); rebind('vo-f-disq', 'includeDisqualified');
  { const qEl = $('vo-f-q'); let t = null; if (qEl) qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { VO.filters.q = qEl.value; voLoadProspects(); }, 350); }); }
  el.querySelectorAll('tr.vo-row').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('a')) return; voOpenProspect(Number(tr.dataset.id)); }));
}

// ---- Prospect detail (5.3b), full-width pane ----
async function voOpenProspect(id) {
  let d; try { d = await voApi('prospect', { id: id }); } catch (e) { alert(e.message); return; }
  VO.prospect = d.prospect; VO.enums = d.enums || VO.enums; VO.placeholder = d.placeholder || VO.placeholder; VO.providers = d.providers || VO.providers;
  voRenderDetail(d);
  voPane('detail');
}
function voSignalRows(group, labels) {
  if (!group) return '<tr><td colspan="3" class="muted">Unscored</td></tr>';
  return Object.entries(group).map(([k, v]) => { const val = v && typeof v.value === 'object' && v.value !== null ? Object.entries(v.value).map(([a, b]) => a.replace(/_/g, ' ') + ' ' + (b == null ? 'blank' : (b === true ? 'yes' : (b === false ? 'no' : b)))).join(', ') : String(v && v.value != null ? v.value : '–'); return '<tr><td>' + esc(labels[k] || k) + '</td><td class="vo-small">' + esc(val === 'true' ? 'yes' : (val === 'false' ? 'no' : val)) + '</td><td class="num"><b>' + (v ? v.points : 0) + '</b></td></tr>'; }).join('');
}
function voAdCards(p) {
  const ads = Array.isArray(p.ad_samples) ? p.ad_samples : [];
  if (!ads.length) return '<p class="muted vo-small">No ad samples on this prospect' + (p.source === 'import' ? ' (imported from the tracker). Samples arrive when a sourcing run finds the brand in the Meta Ad Library.' : '.') + '</p>';
  return '<div class="vo-ads">' + ads.slice(0, 10).map((a) => '<div class="vo-ad">' + (a.thumbnail ? '<img src="' + esc(a.thumbnail) + '" alt="" loading="lazy"' + VO_IMG_FALLBACK + ' />' : '') + '<span class="tag">' + (a.is_video ? '▶ video' : 'image') + '</span>' + (a.start_date ? '<span class="muted">' + esc(a.start_date) + '</span>' : '') + '<div>' + esc(String(a.copy || '').slice(0, 140)) + '</div>' + (a.link_url ? '<div>' + voLink(a.link_url, 'ad link') + '</div>' : '') + '</div>').join('') + '</div>';
}
function voGallery(p) {
  const prods = Array.isArray(p.products) ? p.products : [];
  const prod = prods.find((x) => x.url === p.suggested_product_url) || prods[0];
  if (!prod) return '<p class="muted vo-small">' + (p.products_source === 'unknown' ? 'No Shopify products feed at this domain.' : 'Products arrive with a sourcing run, or click Refresh products.') + '</p>';
  const bad = /facts|ingredient|benefit|certif|testimonial|review|chart|compar|badge|label|slide|how-?to|sfp|nfp|infograph|supplement-facts|nutrition/i;
  return '<div class="vo-gal">' + (prod.images || []).slice(0, 8).map((i) => { const name = String(i.src || '').split('/').pop().split('?')[0]; const isBad = bad.test(i.alt || '') || bad.test(name); return '<div class="g' + (isBad ? ' bad' : '') + '"><img src="' + esc(i.src) + '" alt="" loading="lazy"' + VO_IMG_FALLBACK + ' />' + (isBad ? 'infographic' : 'photo') + '</div>'; }).join('') + '</div><div class="vo-small muted">' + prods.length + ' product(s) in the feed · ' + (prod.images || []).length + ' image(s) on the pick, red outline = counted as an infographic' + (p.products_source === 'shopify' && prods[0] && /\/cdn\//.test(String((prods[0].images || [{}])[0].src || '')) && !/cdn\.shopify/.test(String((prods[0].images || [{}])[0].src || '')) ? '. Dry-run feed: the image links are placeholders until Apollo or Apify keys are set' : '') + '</div>';
}
function voRenderDetail(d) {
  const p = d.prospect; const E = VO.enums || {}; const bd = p.score_breakdown || null; const P = VO.providers || {}; const prof = d.profile || VO.profile || {};
  const L = { active_meta_ads: 'Active Meta ads', video_share: 'Video share', new_ads_30d: 'New ads last 30d', other_paid_channels: 'Other paid channels', skus: 'SKUs', employees: 'Employees', traffic_proxy: 'Traffic proxy', growth: 'Growth signals', pays_for_creative: 'Pays for creative', creative_gap: 'Creative gap', video_sourcing: 'Video sourcing', trigger_event: 'Trigger event', dm_active_90d: 'DM active 90d', second_contact_with_email: '2nd contact with email', no_gatekeeper: 'No gatekeeper' };
  const scoreBox = (t, max, g, pts) => '<div class="vo-scorebox"><div class="vo-scorebox-h"><b>' + t + '</b><span>' + (pts == null ? '–' : pts) + ' / ' + max + '</span></div><table class="vo-mini"><tbody>' + voSignalRows(g, L) + '</tbody></table></div>';
  const canEmail = !!(p.dm_email && P.sendgrid);
  const emailBtn = (key) => '<button class="ghost sm vo-email" data-kind="' + key + '"' + (canEmail ? '' : ' disabled title="' + (p.dm_email ? 'SendGrid key missing in Vercel' : 'No email on this prospect yet') + '"') + (key === 'message_a' && !p.video_url ? ' title="Paste the video URL first"' : '') + '>✉️ Send by email</button>';
  const msg = (label, key, text, kind) => '<div class="vo-msg"><div class="vo-msg-h"><b>' + label + '</b><div><button class="ghost sm vo-copy" data-copy="' + key + '">📋 Copy</button> ' + (kind === 'note' || kind === 'fu' ? '' : emailBtn(key)) + '</div></div><textarea class="vo-msgtext" data-msg="' + key + '" rows="' + (kind === 'note' ? 3 : 7) + '">' + esc(text || '') + '</textarea></div>';
  const inp = (k, type, extra) => '<input type="' + (type || 'text') + '" data-e="' + k + '" value="' + esc(p[k] == null ? '' : p[k]) + '"' + (extra || '') + ' />';
  const yn = (k) => '<select data-e="' + k + '"><option value=""' + (p[k] == null ? ' selected' : '') + '>–</option><option value="Y"' + (p[k] === true ? ' selected' : '') + '>Y</option><option value="N"' + (p[k] === false ? ' selected' : '') + '>N</option></select>';
  const sel = (k, opts) => '<select data-e="' + k + '">' + opts.map((o) => '<option value="' + esc(o) + '"' + (String(p[k] == null ? '' : p[k]) === String(o) ? ' selected' : '') + '>' + esc(o || '–') + '</option>').join('') + '</select>';
  const r = (label, control) => '<tr><th>' + label + '</th><td>' + control + '</td></tr>';
  const stageNext = (d.stageNext && d.stageNext[p.outreach_stage]) || [];
  const stageOpts = [p.outreach_stage].concat(stageNext, ['Replied', 'Dead']).filter((x, i, a) => x && a.indexOf(x) === i);
  const conn = p.linkedin_connection_state || null;
  const connOpts = conn === null ? ['', 'Applied'] : (conn === 'Applied' ? ['Applied', 'Pending', 'Connected', ''] : (conn === 'Pending' ? ['Pending', 'Connected', ''] : ['Connected']));
  const liOn = P.linkedin && P.linkedin !== 'off';
  const html = '<div class="vo-bar"><div><h3 style="margin:0">' + esc(p.brand) + ' ' + voPrio(p) + ' <span class="muted">No. ' + (p.priority_number == null ? '–' : p.priority_number) + ' · score ' + (p.score_total == null ? '–' : p.score_total) + ' · ' + esc(p.tier || 'Unscored') + '</span></h3>' +
      '<p class="muted view-sub" style="margin:2px 0 0">' + esc(p.category || '') + ' · ' + esc(p.country || '') + ' · ' + voLink(p.website || p.domain, p.domain) + (p.disqualified_reason ? ' · <span class="vo-disq">Disqualified: ' + esc(p.disqualified_reason) + '</span>' : '') + (p.email_sent_at ? ' · ✉️ emailed ' + esc(voStamp(p.email_sent_at)) : '') + (p.email_opened_at ? ' · <span class="vo-yes">👀 opened ' + esc(voStamp(p.email_opened_at)) + '</span>' : '') + '</p></div>' +
      '<div><button class="ghost" id="vo-d-back">← Prospects</button> <button class="ghost" id="vo-d-delete" title="Remove this prospect and its events">🗑 Delete</button> ' + (p.dm_linkedin ? '<a class="ghost btn" href="' + esc(/^https?:/i.test(p.dm_linkedin) ? p.dm_linkedin : 'https://' + p.dm_linkedin) + '" target="_blank" rel="noopener">in LinkedIn profile ↗</a> ' : '<button class="ghost" disabled>No LinkedIn on file</button> ') +
      (p.brand_instagram ? '<a class="ghost btn" href="' + esc(p.brand_instagram) + '" target="_blank" rel="noopener">📸 Instagram ↗</a>' : '<button class="ghost" disabled title="Add the brand Instagram in the editable fields">📸 No Instagram yet</button>') + '</div></div>' +
    (p.last_reply_text ? '<div class="vo-banner ok">💬 <b>Reply ' + esc(voStamp(p.last_reply_at)) + ':</b> ' + esc(p.last_reply_text) + '</div>' : '') +
    '<div class="vo-grid">' +
      '<div class="vo-col">' +
        '<h4>Score breakdown <span class="muted vo-small">' + esc(p.score_version || '') + '</span></h4>' +
        scoreBox('A. Need for video volume', 40, bd && bd.A, p.score_a) + scoreBox('B. Ability to pay', 25, bd && bd.B, p.score_b) + scoreBox('C. Opportunity fit', 20, bd && bd.C, p.score_c) + scoreBox('D. Accessibility', 15, bd && bd.D, p.score_d) +
        '<h4>Sample ads' + (p.ad_analysis && p.ad_analysis.style_reason ? ' <span class="muted vo-small">' + esc(p.ad_analysis.style_reason) + '</span>' : '') + '</h4>' + voAdCards(p) +
        '<h4>Tracking</h4><table class="vo-form"><tbody>' +
          r('LinkedIn connection', '<select id="vo-conn">' + connOpts.map((o) => '<option value="' + o + '"' + ((conn || '') === o ? ' selected' : '') + '>' + (o || 'Not requested') + '</option>').join('') + '</select> <button class="ghost sm" id="vo-conn-save">Set</button>' + (p.linkedin_request_sent_at ? '<div class="muted vo-small">requested ' + esc(voStamp(p.linkedin_request_sent_at)) + '</div>' : '') + (p.linkedin_connected_at ? '<div class="muted vo-small">connected ' + esc(voStamp(p.linkedin_connected_at)) + '</div>' : '') +
            (liOn && P.linkedin === 'dryrun' ? '<div class="vo-small" style="margin-top:6px">Dry-run provider: <button class="ghost sm vo-sim" data-what="accept">Simulate acceptance</button> <button class="ghost sm vo-sim" data-what="reply">Simulate reply</button></div>' : '')) +
          r('Outreach stage', '<select id="vo-stage">' + stageOpts.map((o) => '<option' + (o === p.outreach_stage ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select> <select id="vo-variant"><option value="">variant…</option>' + (E.variant_used || []).map((o) => '<option' + (p.variant_used === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select> <button class="ghost sm" id="vo-stage-save">Set</button><div class="muted vo-small">Only the allowed next steps are listed.</div>') +
          r('Outcome', '<select id="vo-outcome">' + (E.outcome || [null]).map((o) => '<option value="' + (o || '') + '"' + ((p.outcome || '') === (o || '') ? ' selected' : '') + '>' + (o || '–') + '</option>').join('') + '</select> <button class="ghost sm" id="vo-outcome-save">Set</button>') +
          r('Add a note', '<input type="text" id="vo-note" placeholder="what happened" /> <button class="ghost sm" id="vo-note-save">Add</button>') +
        '</tbody></table>' +
        '<h4>Events</h4>' + ((p.events || []).length ? '<table class="vo-mini"><tbody>' + p.events.map((e) => '<tr><td class="vo-small muted">' + esc(voStamp(e.at)) + '</td><td><b>' + esc(e.step) + '</b>' + (e.channel ? ' <span class="muted">' + esc(e.channel) + '</span>' : '') + (e.detail ? '<div class="vo-small">' + esc(e.detail) + '</div>' : '') + (e.response ? '<div class="vo-small">' + esc(e.response) + '</div>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted vo-small">No events yet.</p>') +
      '</div>' +
      '<div class="vo-col">' +
        '<h4>Suggested product <button class="ghost sm" id="vo-refresh-products" title="Re-fetch the Shopify feed and re-run the photo rule">↻ Refresh products</button></h4><div class="vo-product">' + (p.suggested_product_url ? voLink(p.suggested_product_url, p.suggested_product_name || p.suggested_product_url) : '<span class="muted">none yet</span>') + '<div class="vo-small">Photo check: <b>' + esc(p.product_photo_check || 'Unverified') + '</b></div>' + (p.why_this_product ? '<div class="vo-small muted">' + esc(p.why_this_product) + '</div>' : '') + voGallery(p) + '</div>' +
        '<h4>Video URL</h4><div class="vo-video"><input type="url" id="vo-video" placeholder="https://… paste the finished video link" value="' + esc(p.video_url || '') + '" /> <button class="primary sm" id="vo-video-save">Save</button><div class="muted vo-small">Replaces <code>' + esc(VO.placeholder) + '</code> in Message A.</div></div>' +
        (liOn && conn === 'Connected' ? '<div class="vo-card" style="margin-top:10px"><b>Send Message A on LinkedIn</b><div class="vo-small muted">Goes through ' + esc(P.linkedin) + ' to the accepted connection. Needs the video URL above. You can edit the text in the Message A box first.</div><div style="margin-top:6px"><button class="primary sm" id="vo-li-send"' + (P.linkedin_configured ? '' : ' disabled title="provider keys missing"') + '>🚀 Send on LinkedIn</button></div></div>' : '') +
        '<h4>Messages <span class="muted vo-small">signed off as ' + esc(prof.sender_first || 'AJ') + '</span></h4>' +
        msg('Connection note (max 300, no link)', 'connection_note', p.connection_note, 'note') + msg('Message A (video sent)', 'message_a', p.message_a) + msg('Message B (permission-led)', 'message_b', p.message_b) +
        '<details class="vo-details"><summary>Follow-ups (3 to 4 days, then 7 days)</summary>' + (d.followups ? msg('Follow-up 1', 'followup_1', d.followups.followup_1, 'fu') + msg('Follow-up 2', 'followup_2', d.followups.followup_2, 'fu') : '') + '</details>' +
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
  voOn('vo-d-back', 'click', () => { voLoadProspects().then(() => voPane('prospects')); });
  voOn('vo-d-delete', 'click', async () => { if (!confirm('Delete ' + p.brand + ' and its events? If a run finds the brand again it will come back.')) return; try { await voApi('deleteProspect', { id: p.id }); voToast('Deleted'); await voLoadProspects(); voPane('prospects'); } catch (e) { alert(e.message); } });
  el.querySelectorAll('.vo-copy').forEach((b) => b.addEventListener('click', () => { const ta = el.querySelector('textarea[data-msg="' + b.dataset.copy + '"]'); voCopy(b, ta ? ta.value : ''); }));
  const refresh = async () => { const full = await voApi('prospect', { id: p.id }); VO.prospect = full.prospect; voRenderDetail(full); };
  const act = (id, fn) => voOn(id, 'click', async () => { try { await fn(); await refresh(); } catch (e) { alert(e.message); } });
  act('vo-video-save', async () => { await voApi('setVideoUrl', { id: p.id, url: $('vo-video').value }); voToast('Video URL saved, Message A updated'); });
  act('vo-conn-save', async () => { await voApi('setConnectionState', { id: p.id, state: $('vo-conn').value || null }); voToast('Connection state set'); });
  act('vo-stage-save', async () => { await voApi('setStage', { id: p.id, stage: $('vo-stage').value, variant_used: $('vo-variant').value || undefined }); voToast('Stage set'); });
  act('vo-outcome-save', async () => { await voApi('setOutcome', { id: p.id, outcome: $('vo-outcome').value || null }); voToast('Outcome set'); });
  act('vo-note-save', async () => { const n = $('vo-note').value.trim(); if (!n) throw new Error('Type a note first'); await voApi('addNote', { id: p.id, note: n }); voToast('Note added'); });
  act('vo-msg-save', async () => { const fields = {}; el.querySelectorAll('textarea[data-msg]').forEach((t) => { if (['connection_note', 'message_a', 'message_b'].includes(t.dataset.msg)) fields[t.dataset.msg] = t.value; }); await voApi('updateProspect', { id: p.id, fields: fields }); voToast('Messages saved'); });
  act('vo-msg-regen', async () => { await voApi('updateProspect', { id: p.id, fields: { observation: p.observation || '' } }); voToast('Messages rebuilt'); });
  act('vo-refresh-products', async () => { const r2 = await voApi('refreshProducts', { id: p.id }); voToast('Products refreshed'); });
  act('vo-edit-save', async () => { const fields = {}; el.querySelectorAll('[data-e]').forEach((x) => { fields[x.dataset.e] = x.value === '' ? null : x.value; }); await voApi('updateProspect', { id: p.id, fields: fields }); voToast('Saved, score recalculated'); });
  act('vo-li-send', async () => {
    const url = $('vo-video').value.trim(); const text = el.querySelector('textarea[data-msg="message_a"]').value;
    if (!/^https:\/\//i.test(url)) throw new Error('Paste an https:// video URL first');
    if (!confirm('Send Message A to ' + (p.dm_name || p.brand) + ' on LinkedIn now?')) return;
    const r2 = await voApi('linkedinSend', { id: p.id, url: url, text: text }); voToast('Sent on LinkedIn');
  });
  el.querySelectorAll('.vo-email').forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.kind; const text = el.querySelector('textarea[data-msg="' + kind + '"]').value;
    if (kind === 'message_a' && !p.video_url) { alert('Paste the video URL first, Message A goes out with the link in it.'); return; }
    if (!confirm('Email ' + (kind === 'message_a' ? 'Message A' : 'Message B') + ' to ' + p.dm_email + ' now?')) return;
    try { await voApi('updateProspect', { id: p.id, fields: { [kind]: text } }); const r2 = await voApi('sendEmail', { id: p.id, kind: kind }); voToast('Sent: ' + r2.subject); await refresh(); } catch (e) { alert(e.message); }
  }));
  el.querySelectorAll('.vo-sim').forEach((b) => b.addEventListener('click', async () => { try { await voApi('simulate', { id: p.id, what: b.dataset.what }); voToast('Simulated ' + b.dataset.what); await refresh(); } catch (e) { alert(e.message); } }));
}

// ---- Ready to send (4.9 step 4) + due follow-ups ----
async function voOpenReady() {
  const el = $('vo-pane-ready'); voPane('ready'); el.innerHTML = '<p class="muted">Loading…</p>';
  let d, f;
  try { d = await voApi('readyToSend'); f = await voApi('dueFollowups'); } catch (e) { el.innerHTML = '<p class="vo-no">' + esc(e.message) + '</p>'; return; }
  VO.providers = d.providers || VO.providers; VO.linkedin = d.linkedin || VO.linkedin; voBanner();
  const P = VO.providers; const liOn = P.linkedin && P.linkedin !== 'off';
  const cards = (d.prospects || []).map((p) => '<div class="vo-card" data-id="' + p.id + '"><div class="vo-bar" style="margin:0 0 6px"><div><b>' + esc(p.brand) + '</b> ' + voPrio(p) + ' <span class="muted vo-small">' + esc(p.dm_name || '') + (p.dm_title ? ', ' + esc(p.dm_title) : '') + ' · ' + esc(p.campaign_name || '') + ' · connected ' + esc(voStamp(p.linkedin_connected_at)) + '</span></div><div>' + voLink(p.dm_linkedin, 'LinkedIn') + ' <button class="ghost sm vo-open">Open</button></div></div>' +
    '<div class="vo-small">Video URL: <input type="url" class="vo-ready-url" value="' + esc(p.video_url || '') + '" placeholder="https://…" style="width:60%;max-width:420px" /></div>' +
    '<textarea class="vo-ready-text" rows="7">' + esc(p.message_a || '') + '</textarea>' +
    '<div style="margin-top:6px">' + (liOn ? '<button class="primary sm vo-ready-send"' + (P.linkedin_configured ? '' : ' disabled title="provider keys missing"') + '>🚀 Send on LinkedIn</button> ' : '') + '<button class="ghost sm vo-ready-copy">📋 Copy</button> <button class="ghost sm vo-ready-mark" title="You sent it by hand on LinkedIn">✓ Mark Msg 1 sent</button></div></div>').join('');
  const tasks = (f.tasks || []).map((t) => '<tr data-eid="' + t.event_id + '" data-id="' + t.id + '"><td><b>' + esc(t.brand) + '</b><div class="muted vo-small">' + esc(t.dm_name || '') + '</div></td><td>' + esc(t.next_action) + '</td><td>' + esc(t.channel || 'LinkedIn') + '</td><td>' + esc(String(t.next_action_date).slice(0, 10)) + '</td><td>' + esc(t.outreach_stage) + '</td><td><button class="primary sm vo-fu-send"' + ((t.channel === 'Email' && !t.dm_email) || (t.channel !== 'Email' && !(liOn && P.linkedin_configured)) ? ' disabled title="' + (t.channel === 'Email' ? 'no email on file' : 'LinkedIn provider not connected, send it by hand and mark the stage') + '"' : '') + '>Send now</button> <button class="ghost sm vo-fu-open">Open</button> <button class="ghost sm vo-fu-skip">Skip</button></td></tr>').join('');
  el.innerHTML = '<div class="vo-bar"><div><h3 style="margin:0">Ready to send</h3><p class="muted view-sub" style="margin:2px 0 0">Accepted connections waiting for Message A. Paste the video URL, check the text, click Send. Nothing here goes out on its own.</p></div>' +
    '<div>' + (liOn ? '<button class="ghost sm" id="vo-li-tick" title="Run the automation checks now (acceptances, replies, one queued request)">↻ Check LinkedIn now</button> ' : '') + '<button class="ghost sm" id="vo-ready-refresh">Refresh</button></div></div>' +
    (liOn ? '' : '<p class="vo-help">LinkedIn automation is off (no VO_LINKEDIN_PROVIDER). Mark connections by hand on each prospect; anyone marked Connected shows here with the draft to copy.</p>') +
    (cards || '<p class="muted">Nobody is waiting. Connections you mark (or the provider detects) as Connected appear here.</p>') +
    '<h3 style="margin-top:20px">Due follow-ups <span class="muted vo-small">(3 days and 7 days after Message 1; drafts until sent)</span></h3>' +
    (tasks ? '<div class="tgt-scroll"><table class="cust-table vo-table"><thead><tr><th>Brand</th><th>Which</th><th>Channel</th><th>Due</th><th>Stage</th><th></th></tr></thead><tbody>' + tasks + '</tbody></table></div>' : '<p class="muted">No follow-ups due today.</p>');
  voOn('vo-ready-refresh', 'click', voOpenReady);
  voOn('vo-li-tick', 'click', async () => { try { const r = await voApi('linkedinTick'); const t = r.tick || {}; alert(t.enabled === false ? 'Provider not configured.' : 'Checked: ' + (t.accepted || 0) + ' accepted, ' + (t.replies || 0) + ' replies, ' + (t.requests || 0) + ' request(s) sent' + (t.skipped ? ' (' + t.skipped + ')' : '') + (t.error_send || t.error_accept || t.error_replies ? '. Error: ' + (t.error_send || t.error_accept || t.error_replies) : '')); voOpenReady(); } catch (e) { alert(e.message); } });
  el.querySelectorAll('.vo-card').forEach((card) => {
    const id = Number(card.dataset.id);
    card.querySelector('.vo-open').addEventListener('click', () => voOpenProspect(id));
    card.querySelector('.vo-ready-copy').addEventListener('click', (e) => voCopy(e.target, card.querySelector('.vo-ready-text').value));
    card.querySelector('.vo-ready-mark').addEventListener('click', async () => { try { const url = card.querySelector('.vo-ready-url').value.trim(); if (url) await voApi('setVideoUrl', { id: id, url: url }); await voApi('updateProspect', { id: id, fields: { message_a: card.querySelector('.vo-ready-text').value } }); await voApi('setStage', { id: id, stage: 'Msg 1', variant_used: 'A video sent', channel: 'LinkedIn' }); voToast('Marked as sent'); voOpenReady(); } catch (e) { alert(e.message); } });
    const s = card.querySelector('.vo-ready-send'); if (s) s.addEventListener('click', async () => { const url = card.querySelector('.vo-ready-url').value.trim(); if (!/^https:\/\//i.test(url)) { alert('Paste an https:// video URL first.'); return; } if (!confirm('Send Message A on LinkedIn now?')) return; try { await voApi('linkedinSend', { id: id, url: url, text: card.querySelector('.vo-ready-text').value }); voToast('Sent'); voOpenReady(); } catch (e) { alert(e.message); } });
  });
  el.querySelectorAll('tr[data-eid]').forEach((tr) => {
    const eid = Number(tr.dataset.eid); const id = Number(tr.dataset.id);
    tr.querySelector('.vo-fu-open').addEventListener('click', () => voOpenProspect(id));
    tr.querySelector('.vo-fu-skip').addEventListener('click', async () => { try { await voApi('skipFollowup', { eventId: eid }); voOpenReady(); } catch (e) { alert(e.message); } });
    tr.querySelector('.vo-fu-send').addEventListener('click', async () => { if (!confirm('Send this follow-up now?')) return; try { const r = await voApi('sendFollowup', { eventId: eid }); voToast(r.stage + ' sent'); voOpenReady(); } catch (e) { alert(e.message); } });
  });
}

// ---- Results (5.5) ----
async function voOpenResults(campaignId) {
  const el = $('vo-pane-results'); voPane('results'); el.innerHTML = '<p class="muted">Loading…</p>';
  let d; try { d = await voApi('results', { campaignId: campaignId || null }); } catch (e) { el.innerHTML = '<p class="vo-no">' + esc(e.message) + '</p>'; return; }
  const rows = d.rows || []; const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 + '%' : '–');
  const agg = (key) => { const m = {}; rows.forEach((r) => { const k = r[key] || '(none)'; m[k] = m[k] || { total: 0, contacted: 0, replied: 0, calls: 0, pilots: 0, won: 0 }; ['total', 'contacted', 'replied', 'calls', 'pilots', 'won'].forEach((f) => { m[k][f] += Number(r[f]) || 0; }); }); return m; };
  const table = (title, m, order) => { const keys = Object.keys(m).sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b))); return '<h4>' + title + '</h4><div class="tgt-scroll"><table class="cust-table vo-table"><thead><tr><th>' + title.split(' by ')[1] + '</th><th>Prospects</th><th>Contacted</th><th>Replied</th><th>Reply rate</th><th>Calls</th><th>Call rate</th><th>Pilots</th><th>Pilot rate</th><th>Won</th></tr></thead><tbody>' + (keys.length ? keys.map((k) => { const x = m[k]; return '<tr><td><b>' + esc(k) + '</b></td><td class="num">' + x.total + '</td><td class="num">' + x.contacted + '</td><td class="num">' + x.replied + '</td><td class="num">' + pct(x.replied, x.contacted) + '</td><td class="num">' + x.calls + '</td><td class="num">' + pct(x.calls, x.contacted) + '</td><td class="num">' + x.pilots + '</td><td class="num">' + pct(x.pilots, x.contacted) + '</td><td class="num">' + x.won + '</td></tr>'; }).join('') : '<tr><td colspan="10" class="muted">No data yet. Rates fill in as stages are set.</td></tr>') + '</tbody></table></div>'; };
  el.innerHTML = '<div class="vo-bar"><div><h3 style="margin:0">Results</h3><p class="muted view-sub" style="margin:2px 0 0">Reply, call and pilot rates by priority band and by message variant, so the weights and the A/B choice can be tuned from data. Rates are against contacted prospects.</p></div>' +
    '<div>Campaign: <select id="vo-res-camp"><option value="">All</option>' + (d.campaigns || []).map((c) => '<option value="' + c.id + '"' + (String(c.id) === String(campaignId || '') ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div></div>' +
    table('Outcomes by priority band', agg('priority'), ['Must target', 'Strong', 'Possible', 'Later', 'Unlikely']) + table('Outcomes by variant', agg('variant'), ['A video sent', 'B permission', '(none)']) +
    '<p class="vo-help">Reading it: if Possible replies as often as Strong, the 65 boundary is too strict; if variant B out-replies A, lead with permission. Change weights in Settings, they re-score every prospect.</p>';
  voOn('vo-res-camp', 'change', () => voOpenResults($('vo-res-camp').value));
}

// ---- Settings (5.4) ----
function voBandsText(arr) { return (arr || []).map((b) => b[0] + ':' + b[1]).join(', '); }
function voParseBands(s) { return String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.split(':'); return [Number(m[0]), Number(m[1])]; }); }
async function voOpenSettings() {
  const el = $('vo-pane-settings'); voPane('settings'); el.innerHTML = '<p class="muted">Loading…</p>';
  let d; try { d = await voApi('settings'); } catch (e) { el.innerHTML = '<p class="vo-no">' + esc(e.message) + '</p>'; return; }
  VO.providers = d.providers || VO.providers; VO.linkedin = d.linkedin || VO.linkedin; voBanner();
  const P = d.providers || {}; const sc = d.scoring || {}; const pr = d.profile || {}; const li = d.linkedin || {};
  const kv = (label, val, hint) => '<tr><th>' + label + (hint ? '<div class="muted vo-small">' + hint + '</div>' : '') + '</th><td>' + val + '</td></tr>';
  const st = (ok, name, env, note) => kv(name, (ok ? '<span class="vo-ok">● set</span>' : '<span class="vo-no">○ not set</span> <span class="muted vo-small">dry run</span>') + ' <span class="muted vo-small">' + env + '</span>', note);
  const pin = (k, v2, w) => '<input type="text" data-p="' + k + '" value="' + esc(v2 == null ? '' : v2) + '"' + (w ? ' style="width:' + w + '"' : '') + ' />';
  const wrow = (label, key, val) => '<tr><th>' + label + '</th><td><input type="text" data-w="' + key + '" value="' + esc(val) + '" /></td></tr>';
  el.innerHTML = '<h3>Settings</h3><p class="muted view-sub">Secrets live only in Vercel environment variables; this screen shows whether each one is set, never the value. Everything else is edited here.</p>' +
    '<div class="vo-card"><h4 style="margin:0 0 8px">Providers</h4><table class="vo-kv"><tbody>' +
      st(P.apify, 'Apify (Meta Ad Library)', 'APIFY_TOKEN', 'actor ' + esc(P.apify_actor || '') + ' (override with APIFY_ACTOR_ID)') + st(P.apollo, 'Apollo (companies, people, emails)', 'APOLLO_API_KEY') + st(P.hunter, 'Hunter (email verification)', 'HUNTER_API_KEY') +
      st(P.openai, 'AI (' + esc(P.ai_model || 'gpt-4o-mini') + ')', 'OPENAI_API_KEY', 'keyword suggester, ad analysis, homepage featured products') + st(P.sendgrid, 'SendGrid (email sends)', 'SENDGRID_API_KEY', 'sender: VO_EMAIL_FROM or the campaign email sender') +
      kv('LinkedIn provider', '<b>' + esc(P.linkedin || 'off') + '</b> ' + (P.linkedin === 'off' ? '<span class="muted vo-small">set VO_LINKEDIN_PROVIDER=unipile (plus UNIPILE_DSN, UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID) or =dryrun to rehearse</span>' : (P.linkedin_configured ? '<span class="vo-ok">configured</span>' : '<span class="vo-no">keys missing</span>')) + ' <button class="ghost sm" id="vo-li-test">Test connection</button>') +
      kv('Plan gating', (P.plan_gate && P.plan_gate.length ? 'subscribers on <b>' + esc(P.plan_gate.join(', ')) + '</b> plus the allow-list' : 'allow-list only (owner + VIDEO_OUTREACH_EMAILS)'), 'set VIDEO_OUTREACH_PLANS=apex in Vercel to open it to Apex subscribers') +
    '</tbody></table></div>' +
    '<div class="vo-card"><h4 style="margin:0 0 8px">Default service profile <span class="muted vo-small">(campaigns can override)</span></h4><table class="vo-kv"><tbody>' +
      kv('I run …', pin('service_name', pr.service_name)) + kv('Service description', pin('service_desc', pr.service_desc)) + kv('Sender first name', pin('sender_first', pr.sender_first, '160px')) + kv('Sign-off', pin('signoff', pr.signoff, '160px')) + kv('Offer line', pin('offer_line', pr.offer_line)) + kv('Pilot line', pin('pilot_line', pr.pilot_line)) + kv('Free sample is', pin('sample_what', pr.sample_what)) + kv('Email sender', pin('email_from', pr.email_from) + '<div class="muted vo-small">a SendGrid verified sender; blank = VO_EMAIL_FROM</div>') + kv('Email sender name', pin('email_from_name', pr.email_from_name)) +
    '</tbody></table><button class="primary sm" id="vo-prof-save" style="margin-top:8px">Save profile</button></div>' +
    '<div class="vo-card"><h4 style="margin:0 0 8px">Global exclusion list</h4><div class="vo-help">Household names and holding groups, one per line. A brand whose name matches is disqualified in every campaign.</div><textarea id="vo-excl" rows="6">' + esc((d.exclusions || []).join('\n')) + '</textarea><div style="margin-top:6px"><button class="primary sm" id="vo-excl-save">Save list</button></div></div>' +
    '<div class="vo-card"><h4 style="margin:0 0 8px">LinkedIn caps <span class="muted vo-small">(hard cap ' + (d.limits ? d.limits.hard_daily_requests : 25) + ' requests a day)</span></h4><table class="vo-kv"><tbody>' +
      kv('Connection requests per day', '<input type="number" data-li="daily_requests" value="' + esc(li.daily_requests) + '" style="width:90px" />') + kv('Messages per day', '<input type="number" data-li="daily_messages" value="' + esc(li.daily_messages) + '" style="width:90px" />') + kv('Requests per week', '<input type="number" data-li="weekly_requests" value="' + esc(li.weekly_requests) + '" style="width:90px" />') + kv('Auto-connect up to priority number', '<input type="number" data-li="max_priority" value="' + esc(li.max_priority) + '" style="width:90px" />') + kv('Send window time zone', '<input type="text" data-li="timezone" value="' + esc(li.timezone || 'America/New_York') + '" style="width:200px" /><div class="muted vo-small">weekdays 8am to 6pm, one request per 10-minute tick</div>') +
      kv('State', li.paused ? '<span class="vo-no">Paused: ' + esc(li.paused_reason || '') + '</span> <button class="ghost sm" id="vo-li-resume">Resume</button>' : '<span class="vo-ok">Running</span>' + (li.last_poll ? ' <span class="muted vo-small">last inbox poll ' + esc(voStamp(li.last_poll)) + '</span>' : '')) +
    '</tbody></table><button class="primary sm" id="vo-li-save" style="margin-top:8px">Save caps</button></div>' +
    '<div class="vo-card vo-weights"><h4 style="margin:0 0 8px">Score weights <span class="muted vo-small">' + esc(sc.version || '') + '</span></h4><div class="vo-help">Bands read "from this value upwards scores this many points", written threshold:points. Preview shows how many of the 74 tracker brands would change priority band; Save re-scores every prospect.</div><table class="vo-kv"><tbody>' +
      '<tr class="vo-sec"><th colspan="2">A. Need for video volume (40)</th></tr>' + ['active_meta_ads', 'video_share', 'new_ads_30d', 'other_paid_channels', 'skus'].map((k) => wrow(k, 'A.' + k, voBandsText(sc.A_need && sc.A_need[k]))).join('') +
      '<tr class="vo-sec"><th colspan="2">B. Ability to pay (25)</th></tr>' + wrow('employees', 'B.employees', voBandsText(sc.B_afford && sc.B_afford.employees)) + ['traffic_cap', 'monthly_visits_30k', 'amazon_reviews_1k', 'shopify_plus', 'growth_per_signal', 'growth_cap', 'pays_for_creative'].map((k) => wrow(k, 'B.' + k, sc.B_afford ? sc.B_afford[k] : '')).join('') +
      '<tr class="vo-sec"><th colspan="2">C. Opportunity fit (20)</th></tr>' + ['UGC creators', 'AI tools', 'In-house', 'Unknown'].map((k) => wrow('video_sourcing ' + k, 'C.vs.' + k, sc.C_fit && sc.C_fit.video_sourcing ? sc.C_fit.video_sourcing[k] : '')).join('') + wrow('trigger_event', 'C.trigger_event', sc.C_fit ? sc.C_fit.trigger_event : '') +
      '<tr class="vo-sec"><th colspan="2">D. Accessibility (15)</th></tr>' + ['Y', 'N', 'Not found'].map((k) => wrow('dm_active_90d ' + k, 'D.dm.' + k, sc.D_access && sc.D_access.dm_active_90d ? sc.D_access.dm_active_90d[k] : '')).join('') + wrow('second_contact_with_email', 'D.second_contact_with_email', sc.D_access ? sc.D_access.second_contact_with_email : '') + wrow('no_gatekeeper', 'D.no_gatekeeper', sc.D_access ? sc.D_access.no_gatekeeper : '') +
      '<tr class="vo-sec"><th colspan="2">Tiers and priority thresholds</th></tr>' + wrow('Tier A from', 'T.A', sc.tiers ? sc.tiers.A : '') + wrow('Tier B from', 'T.B', sc.tiers ? sc.tiers.B : '') + ['Must target', 'Strong', 'Possible', 'Later'].map((k) => wrow(k + ' from', 'P.' + k, sc.priority ? sc.priority[k] : '')).join('') +
    '</tbody></table><div id="vo-w-impact" class="vo-help" style="margin-top:8px"></div><button class="ghost sm" id="vo-w-preview">Preview impact</button> <button class="primary sm" id="vo-w-save">Save and re-score all</button> <button class="ghost sm" id="vo-w-reset">Reset to v1</button></div>' +
    '<div class="vo-card"><h4 style="margin:0 0 8px">Industry presets</h4>' + ((d.presets || []).length ? '<table class="vo-kv"><tbody>' + d.presets.map((p) => '<tr data-pid="' + p.id + '"><th>' + esc(p.name) + '</th><td><span class="vo-small">' + esc((p.keywords || []).join(', ')) + '</span> <button class="ghost sm vo-preset-del">Delete</button></td></tr>').join('') + '</tbody></table>' : '<p class="muted vo-small">None yet. Save keywords as a preset from a campaign.</p>') + '</div>';
  voOn('vo-li-test', 'click', async () => { try { const r = await voApi('linkedinTest'); alert((r.ok ? '✓ ' : '✗ ') + r.detail); } catch (e) { alert(e.message); } });
  voOn('vo-li-resume', 'click', async () => { try { await voApi('linkedinResume'); voToast('Resumed'); voOpenSettings(); } catch (e) { alert(e.message); } });
  voOn('vo-prof-save', 'click', async () => { const prof = {}; el.querySelectorAll('[data-p]').forEach((i) => { prof[i.dataset.p] = i.value; }); try { await voApi('saveProfile', { profile: prof }); voToast('Profile saved'); } catch (e) { alert(e.message); } });
  voOn('vo-excl-save', 'click', async () => { try { await voApi('saveExclusions', { exclusions: voLines($('vo-excl').value) }); voToast('Exclusions saved'); } catch (e) { alert(e.message); } });
  voOn('vo-li-save', 'click', async () => { const o = {}; el.querySelectorAll('[data-li]').forEach((i) => { o[i.dataset.li] = i.value; }); try { await voApi('saveLinkedinSettings', { linkedin: o }); voToast('Caps saved'); voOpenSettings(); } catch (e) { alert(e.message); } });
  const collect = () => {
    const g = (k) => { const x = el.querySelector('[data-w="' + k + '"]'); return x ? x.value : ''; }; const n = (k) => Number(g(k));
    const cfg = { version: sc.version || 'v1', A_need: {}, B_afford: { employees: voParseBands(g('B.employees')) }, C_fit: { creative_gap: 'as_is', video_sourcing: {}, trigger_event: n('C.trigger_event') }, D_access: { dm_active_90d: {}, second_contact_with_email: n('D.second_contact_with_email'), no_gatekeeper: n('D.no_gatekeeper') },
      tiers: { A: n('T.A'), B: n('T.B') }, priority: { 'Must target': n('P.Must target'), 'Strong': n('P.Strong'), 'Possible': n('P.Possible'), 'Later': n('P.Later'), 'Unlikely': 0 }, priority_number: sc.priority_number || { 'Must target': 1, 'Strong': 2, 'Possible': 3, 'Later': 4, 'Unlikely': 5, 'Skip': 6 } };
    ['active_meta_ads', 'video_share', 'new_ads_30d', 'other_paid_channels', 'skus'].forEach((k) => { cfg.A_need[k] = voParseBands(g('A.' + k)); });
    ['traffic_cap', 'monthly_visits_30k', 'amazon_reviews_1k', 'shopify_plus', 'growth_per_signal', 'growth_cap', 'pays_for_creative'].forEach((k) => { cfg.B_afford[k] = n('B.' + k); });
    ['UGC creators', 'AI tools', 'In-house', 'Unknown'].forEach((k) => { cfg.C_fit.video_sourcing[k] = n('C.vs.' + k); });
    ['Y', 'N', 'Not found'].forEach((k) => { cfg.D_access.dm_active_90d[k] = n('D.dm.' + k); });
    return cfg;
  };
  const impactText = (im) => im.changed === 0 ? '✓ No tracker brand changes priority band with these weights.' : im.changed + ' of ' + im.rows + ' tracker brands would change band: ' + im.moves.join('; ') + (im.changed > im.moves.length ? ' …' : '');
  voOn('vo-w-preview', 'click', async () => { try { const r = await voApi('scoringImpact', { scoring: collect() }); $('vo-w-impact').textContent = impactText(r.impact); } catch (e) { alert(e.message); } });
  voOn('vo-w-save', 'click', async () => { if (!confirm('Save these weights and re-score every prospect?')) return; try { const r = await voApi('saveScoring', { scoring: collect(), rescore: true }); alert('Saved as ' + r.config.version + '. ' + impactText(r.impact) + ' Re-scored ' + r.rescored + ' prospect(s).'); voOpenSettings(); } catch (e) { alert(e.message); } });
  voOn('vo-w-reset', 'click', async () => { if (!confirm('Reset the weights to the v1 config and re-score every prospect?')) return; try { const r = await voApi('resetScoring'); voToast('Reset, re-scored ' + r.rescored); voOpenSettings(); } catch (e) { alert(e.message); } });
  el.querySelectorAll('.vo-preset-del').forEach((b) => b.addEventListener('click', async () => { const id = Number(b.closest('tr').dataset.pid); if (!confirm('Delete this preset?')) return; try { await voApi('deletePreset', { id: id }); voOpenSettings(); } catch (e) { alert(e.message); } }));
}
