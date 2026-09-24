// LinkedIn provider interface (spec v4 section 4.9, Phase 5). Two implementations behind one shape:
//   dryrun   : records everything in memory, accepts invitations when asked, never touches LinkedIn
//   unipile  : Unipile's hosted LinkedIn API. Endpoints per developer.unipile.com (checked 5 Sep 2026):
//              POST /api/v1/users/invite { account_id, provider_id, message }
//              POST /api/v1/chats/{chat_id}/messages and POST /api/v1/chats { account_id, attendees_ids, text }
//              GET  /api/v1/users/{identifier}?account_id=  (profile lookup, gives provider_id)
//              GET  /api/v1/users/relations?account_id=      (accepted connections)
//              GET  /api/v1/users/invite/sent?account_id=    (pending invitations, DELETE .../{id} withdraws)
//              GET  /api/v1/messages?account_id=&after=      (inbox)
//              Test with Settings > "Test LinkedIn connection" before trusting any of it.
// Feature flag: VO_LINKEDIN_PROVIDER = 'unipile' | 'dryrun' | unset (automation hidden).
// The app NEVER sends Message A on its own: sending needs a pasted video URL and a click (4.8).
const { fetchRetry } = require('./backoff');

// A connection request needs a PERSON. Company pages (linkedin.com/company/...) and bare domains cannot be invited,
// and Apollo sometimes hands back the company page when it has no person. Both providers refuse them with one clear reason.
function personProfile(url) { return /(^|\/)in\/[^/?#]+/i.test(String(url || '')); }
function assertPerson(url) { if (!personProfile(url)) throw new Error('not a personal LinkedIn profile (' + String(url || 'empty').slice(0, 80) + '); it needs a linkedin.com/in/... link'); }

function providerName() { return String(process.env.VO_LINKEDIN_PROVIDER || '').toLowerCase(); }
function enabled() { return ['unipile', 'dryrun'].includes(providerName()); }

// ---- dry run ----
const mem = { invites: new Map(), chats: new Map(), inbox: [], accepted: new Set(), restricted: false };
const dry = {
  name: 'dryrun',
  configured: () => true,
  async lookup(publicIdOrUrl) { assertPerson(publicIdOrUrl); const id = 'dry-' + String(publicIdOrUrl).replace(/.*\/in\//, '').replace(/\/$/, ''); return { provider_id: id, public_identifier: id }; },
  async sendInvitation(providerId, message) { if (mem.restricted) return { ok: false, restricted: true, error: 'account restricted (simulated)' }; const id = 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); mem.invites.set(id, { provider_id: providerId, message: message, at: new Date().toISOString() }); return { ok: true, invitation_id: id }; },
  async listAccepted() { return Array.from(mem.accepted).map((pid) => ({ provider_id: pid })); },
  async activity(providerId) { return { last_at: mem.inactive && mem.inactive.has(providerId) ? null : new Date().toISOString(), kind: 'post' }; },
  async currentJobs(providerId) { return ((mem.jobs || {})[providerId] || []); },
  async latestPost(providerId) { return mem.inactive && mem.inactive.has(providerId) ? null : { social_id: 'post-' + providerId, at: new Date().toISOString() }; },
  async likePost(socialId) { mem.likes = (mem.likes || []).concat([socialId]); return { ok: true }; },
  async searchPeople(keywords) { return (mem.people || []).filter((x) => String(x.headline || '').toLowerCase().includes(String(keywords || '').toLowerCase())).map(personItem); },
  async profileStatus(providerId) { return { connected: mem.accepted.has(providerId), distance: mem.accepted.has(providerId) ? 'FIRST_DEGREE' : 'SECOND_DEGREE', invitation: mem.accepted.has(providerId) ? null : 'PENDING' }; },
  async listPendingInvitations() { return Array.from(mem.invites.entries()).map(([id, v]) => ({ invitation_id: id, provider_id: v.provider_id })); },
  async withdraw(invitationId) { mem.invites.delete(invitationId); return { ok: true }; },
  async sendMessage(providerId, text, chatId, attachment) { if (mem.restricted) return { ok: false, restricted: true, error: 'account restricted (simulated)' }; const id = chatId || ('chat-' + providerId); mem.chats.set(id, (mem.chats.get(id) || []).concat([{ text: text, is_sender: true, at: new Date().toISOString(), attachment: attachment ? { filename: attachment.filename, bytes: attachment.buffer ? attachment.buffer.length : 0 } : null }])); return { ok: true, chat_id: id, message_id: 'm-' + Date.now(), attached: !!attachment }; },
  async fetchNewMessages(sinceIso) { return mem.inbox.filter((m) => !sinceIso || m.at > sinceIso); },
  async test() { return { ok: true, detail: 'dry-run provider, nothing is sent' }; },
  // test hooks (used by the tests and the "Simulate" buttons)
  _simulateAccept(providerId) { mem.accepted.add(providerId); for (const [id, v] of mem.invites) if (v.provider_id === providerId) mem.invites.delete(id); },
  _simulateReply(providerId, text) { mem.inbox.push({ provider_id: providerId, chat_id: 'chat-' + providerId, text: text, is_sender: false, at: new Date().toISOString() }); },
  _simulateRestriction(on) { mem.restricted = !!on; },
  _reset() { mem.invites.clear(); mem.chats.clear(); mem.inbox.length = 0; mem.accepted.clear(); mem.restricted = false; },
};

// ---- Unipile ----
function uniBase() { return String(process.env.UNIPILE_DSN || '').replace(/\/$/, ''); }
function uniHeaders() { return { 'X-API-KEY': process.env.UNIPILE_API_KEY || '', Accept: 'application/json', 'Content-Type': 'application/json' }; }
function uniAccount() { return process.env.UNIPILE_ACCOUNT_ID || ''; }
async function uni(method, p, body) {
  const r = await fetchRetry(uniBase() + p, { method: method, headers: uniHeaders(), body: body ? JSON.stringify(body) : undefined }, { retries: 1, timeoutMs: 15000 });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error('Unipile HTTP ' + r.status + ' ' + (d.title || d.message || d.type || '')); err.status = r.status; err.body = d; throw err; }
  return d;
}
function isRestriction(e) { const s = String((e && (e.message + ' ' + JSON.stringify(e.body || {}))) || ''); return /restrict|checkpoint|captcha|disconnected|credentials|429/i.test(s); }
const unipile = {
  name: 'unipile',
  configured: () => !!(uniBase() && process.env.UNIPILE_API_KEY && uniAccount()),
  async lookup(publicIdOrUrl) {
    assertPerson(publicIdOrUrl);
    const ident = String(publicIdOrUrl).replace(/^.*\/in\//i, '').replace(/[/?#].*$/, '');
    const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(ident) + '?account_id=' + encodeURIComponent(uniAccount()));
    return { provider_id: d.provider_id || d.id, public_identifier: d.public_identifier || ident, name: [d.first_name, d.last_name].filter(Boolean).join(' ') };
  },
  async sendInvitation(providerId, message) {
    try { const body = { account_id: uniAccount(), provider_id: providerId }; if (String(message || '').trim()) body.message = String(message).slice(0, 300); const d = await uni('POST', '/api/v1/users/invite', body); return { ok: true, invitation_id: d.invitation_id || d.id || null }; }
    catch (e) { return { ok: false, restricted: isRestriction(e), error: e.message }; }
  },
  // Every relation, paged (Unipile: limit up to 1000 plus a cursor; the order is not documented, so never trust one page).
  async listAccepted() {
    const out = []; let cursor = null;
    for (let page = 0; page < 8; page++) {
      const d = await uni('GET', '/api/v1/users/relations?account_id=' + encodeURIComponent(uniAccount()) + '&limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      for (const x of d.items || []) out.push({ provider_id: x.member_id || x.provider_id || x.id, public_identifier: x.public_identifier, at: x.created_at });
      cursor = d.cursor || null; if (!cursor || !(d.items || []).length) break;
    }
    return out;
  },
  // Is this person active on LinkedIn? Newest post, then newest comment. People who never open LinkedIn never accept.
  async activity(providerId) {
    const q = '?account_id=' + encodeURIComponent(uniAccount()) + '&limit=5';
    const newest = (items) => (items || []).map((x) => new Date(x.parsed_datetime || x.date || 0)).filter((d) => !isNaN(d)).sort((a, b) => b - a)[0] || null;
    let last = null, kind = null;
    try { const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(providerId) + '/posts' + q); last = newest(d.items); if (last) kind = 'post'; } catch (e) {}
    if (!last) { try { const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(providerId) + '/comments' + q); last = newest(d.items); if (last) kind = 'comment'; } catch (e) {} }
    return { last_at: last ? last.toISOString() : null, kind: kind };
  },
  // Newest post by this person, for the warm-up like: { social_id, at } or null
  async latestPost(providerId) {
    const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(providerId) + '/posts?account_id=' + encodeURIComponent(uniAccount()) + '&limit=5');
    const posts = (d.items || []).map((x) => ({ social_id: x.social_id || x.id || null, at: new Date(x.parsed_datetime || x.date || 0), reposted: !!(x.is_repost || x.reposted) })).filter((x) => x.social_id && !isNaN(x.at)).sort((a, b) => b.at - a.at);
    const own = posts.find((x) => !x.reposted) || posts[0];
    return own ? { social_id: own.social_id, at: own.at.toISOString() } : null;
  },
  async likePost(socialId) {
    try { await uni('POST', '/api/v1/posts/reaction', { account_id: uniAccount(), post_id: socialId, reaction_type: 'like' }); return { ok: true }; }
    catch (e) { return { ok: false, restricted: isRestriction(e), error: e.message }; }
  },
  // Current jobs for one person (profile with the experience preview section): [{ company, position, current }]
  async currentJobs(providerId) {
    const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(providerId) + '?account_id=' + encodeURIComponent(uniAccount()) + '&linkedin_sections=experience_preview');
    const list = d.work_experience || d.experience || [];
    return list.map((w) => ({ company: String(w.company || w.company_name || ''), position: String(w.position || w.title || ''), current: w.current === true || !w.end })).filter((w) => w.current);
  },
  // LinkedIn classic people search (Unipile POST /api/v1/linkedin/search, 10 a page). Used when Apollo finds nobody.
  async searchPeople(keywords, title) {
    const body = { api: 'classic', category: 'people', keywords: String(keywords || '').slice(0, 100) };
    if (title) body.advanced_keywords = { title: String(title).slice(0, 200) };
    const d = await uni('POST', '/api/v1/linkedin/search?account_id=' + encodeURIComponent(uniAccount()) + '&limit=10', body);
    lastSearch = { body: body, keys: Object.keys(d || {}), count: (d.items || []).length, first: d.items && d.items[0] ? Object.keys(d.items[0]).slice(0, 25) : null, paging: d.paging || d.cursor || null, sample: JSON.stringify(d).slice(0, 400) };
    return (d.items || []).map(personItem);
  },
  // The definitive answer for one person: are we connected now, and what happened to our invitation.
  async profileStatus(providerId) {
    const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(providerId) + '?account_id=' + encodeURIComponent(uniAccount()));
    const inv = d.invitation && typeof d.invitation === 'object' ? d.invitation : null;
    return { connected: d.network_distance === 'FIRST_DEGREE' || d.is_relationship === true, distance: d.network_distance || null, invitation: inv ? String(inv.status || inv.state || '') : null, name: [d.first_name, d.last_name].filter(Boolean).join(' ') };
  },
  async listPendingInvitations() { const d = await uni('GET', '/api/v1/users/invite/sent?account_id=' + encodeURIComponent(uniAccount())); return (d.items || []).map((x) => ({ invitation_id: x.id || x.invitation_id, provider_id: x.invited_user_id || x.provider_id })); },
  async withdraw(invitationId) { try { await uni('DELETE', '/api/v1/users/invite/sent/' + encodeURIComponent(invitationId) + '?account_id=' + encodeURIComponent(uniAccount())); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
  // attachment: { buffer, filename, content_type } sends the file with the text (Unipile: multipart, field "attachments").
  async sendMessage(providerId, text, chatId, attachment) {
    try {
      if (attachment && attachment.buffer) {
        const form = new FormData();
        if (!chatId) { form.append('account_id', uniAccount()); form.append('attendees_ids', providerId); }
        form.append('text', String(text || ''));
        form.append('attachments', new Blob([attachment.buffer], { type: attachment.content_type || 'video/mp4' }), attachment.filename || 'video.mp4');
        const path = chatId ? '/api/v1/chats/' + encodeURIComponent(chatId) + '/messages' : '/api/v1/chats';
        const r = await fetchRetry(uniBase() + path, { method: 'POST', headers: { 'X-API-KEY': process.env.UNIPILE_API_KEY || '', Accept: 'application/json' }, body: form }, { retries: 0, timeoutMs: 55000 });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { const err = new Error('Unipile HTTP ' + r.status + ' ' + (d.title || d.message || d.type || '')); err.status = r.status; err.body = d; throw err; }
        return { ok: true, chat_id: chatId || d.chat_id || d.id, message_id: d.message_id || d.id || null, attached: true };
      }
      if (chatId) { const d = await uni('POST', '/api/v1/chats/' + encodeURIComponent(chatId) + '/messages', { text: text }); return { ok: true, chat_id: chatId, message_id: d.message_id || d.id }; }
      const d = await uni('POST', '/api/v1/chats', { account_id: uniAccount(), attendees_ids: [providerId], text: text });
      return { ok: true, chat_id: d.chat_id || d.id, message_id: d.message_id || null };
    } catch (e) { return { ok: false, restricted: isRestriction(e), error: e.message }; }
  },
  async fetchNewMessages(sinceIso) {
    const d = await uni('GET', '/api/v1/messages?account_id=' + encodeURIComponent(uniAccount()) + (sinceIso ? '&after=' + encodeURIComponent(sinceIso) : '') + '&limit=100');
    return (d.items || []).filter((m) => !m.is_sender).map((m) => ({ provider_id: m.sender_id || m.sender_attendee_id, chat_id: m.chat_id, text: m.text || '', is_sender: false, at: m.timestamp || m.created_at }));
  },
  async test() {
    try {
      const d = await uni('GET', '/api/v1/accounts/' + encodeURIComponent(uniAccount()));
      let extra = '';
      try { const inv = await this.listPendingInvitations(); const rel = await this.listAccepted(); extra = '. LinkedIn holds ' + inv.length + ' pending sent invitation(s) and returned ' + rel.length + ' recent connection(s)'; } catch (e) { extra = '. Could not list invitations: ' + e.message; }
      return { ok: true, detail: 'Connected as ' + (d.name || d.id || 'account') + ' (' + (d.type || 'LINKEDIN') + ')' + extra, status: d.status || d.connection_params && d.connection_params.status || null };
    } catch (e) { return { ok: false, detail: e.message }; }
  },
};

function provider() { const n = providerName(); if (n === 'unipile') return unipile; if (n === 'dryrun') return dry; return null; }

// Safety limits (4.9), defaults per spec, hard cap 25 requests a day whatever the setting says.
const HARD_DAILY_REQUESTS = 25;
let lastSearch = null; function lastSearchDebug() { return lastSearch; }
function personItem(x) {
  const pid = x.public_identifier || '';
  return { provider_id: x.id || x.provider_id || x.member_id || null, name: x.name || [x.first_name, x.last_name].filter(Boolean).join(' '), headline: String(x.headline || ''), public_identifier: pid,
    url: String(x.public_profile_url || x.profile_url || (pid ? 'https://www.linkedin.com/in/' + pid : '')), distance: x.network_distance || '' };
}
// Brand name as a person would type it on LinkedIn: no bracketed extras, no Inc/LLC/Official.
function cleanBrand(b) { return String(b || '').replace(/\([^)]*\)/g, ' ').replace(/\b(inc|llc|ltd|co|corp|official|store|shop|us|usa|uk)\b\.?/gi, ' ').replace(/[^\p{L}\p{N}\s&'-]/gu, ' ').replace(/\s+/g, ' ').trim(); }
const PERSON_TITLE_RE = /\b(founder|co-?founder|ceo|chief executive|owner|president|cmo|chief marketing|head of (marketing|growth|brand|ecommerce|e-commerce|digital|performance)|vp,? (of )?(marketing|growth)|marketing director|director of (marketing|growth|brand)|growth (lead|manager|marketing))\b/i;
function companyMatches(company, brand, domain) {
  const c = cleanBrand(company).toLowerCase().replace(/[^a-z0-9]/g, ''); if (c.length < 3) return false;
  const b = cleanBrand(brand).toLowerCase().replace(/[^a-z0-9]/g, ''); const dom = String(domain || '').replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return (b.length >= 3 && (c === b || c.startsWith(b) || b.startsWith(c) && c.length >= 4)) || (dom.length >= 4 && (c === dom || c.startsWith(dom) || dom.startsWith(c) && c.length >= 4));
}
// The best decision maker in a search page: works at this brand (named in the headline) and holds a founder or marketing lead title.
function pickFromSearch(items, brand, domain) {
  const b = cleanBrand(brand).toLowerCase(); const dom = String(domain || '').replace(/^www\./, '').split('.')[0].toLowerCase();
  const worksThere = (h) => { const x = String(h || '').toLowerCase(); const flat = x.replace(/[^a-z0-9]/g, ''); return (b.length >= 3 && x.includes(b)) || (dom.length >= 4 && flat.includes(dom)) || (b.length >= 4 && flat.includes(b.replace(/[^a-z0-9]/g, ''))); };
  const rank = (h) => (/founder|ceo|chief executive|owner|president/i.test(h) ? 0 : (/cmo|chief marketing|head of|vp|director/i.test(h) ? 1 : 2));
  const cands = (items || []).filter((x) => /\/in\//.test(x.url || '') && worksThere(x.headline) && PERSON_TITLE_RE.test(x.headline));
  cands.sort((a, c) => rank(a.headline) - rank(c.headline));
  return cands[0] || null;
}
const ACTIVE_DAYS = 90;
function activeSince(lastAt, now) { if (!lastAt) return false; return ((now || Date.now()) - new Date(lastAt)) / 86400000 <= ACTIVE_DAYS; }
function limits(cfg) {
  const c = cfg || {};
  return { daily_requests: Math.min(HARD_DAILY_REQUESTS, Math.max(1, Number(c.daily_requests) || 20)), daily_messages: Math.max(1, Number(c.daily_messages) || 40), weekly_requests: Math.max(1, Number(c.weekly_requests) || 100), max_priority: Math.max(1, Math.min(6, Number(c.max_priority) || 3)) };
}
// Weekday, 8am to 6pm in the prospect's US time zone (US Eastern by default, a setting per campaign later).
function inSendWindow(now, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now || new Date());
    const hour = Number((parts.find((p) => p.type === 'hour') || {}).value); const wd = (parts.find((p) => p.type === 'weekday') || {}).value;
    return !['Sat', 'Sun'].includes(wd) && hour >= 8 && hour < 18;
  } catch (e) { return false; }
}

module.exports = { providerName, enabled, provider, dry, unipile, limits, inSendWindow, personProfile, activeSince, ACTIVE_DAYS, cleanBrand, pickFromSearch, companyMatches, PERSON_TITLE_RE, lastSearchDebug, HARD_DAILY_REQUESTS };
