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

function providerName() { return String(process.env.VO_LINKEDIN_PROVIDER || '').toLowerCase(); }
function enabled() { return ['unipile', 'dryrun'].includes(providerName()); }

// ---- dry run ----
const mem = { invites: new Map(), chats: new Map(), inbox: [], accepted: new Set(), restricted: false };
const dry = {
  name: 'dryrun',
  configured: () => true,
  async lookup(publicIdOrUrl) { const id = 'dry-' + String(publicIdOrUrl).replace(/.*\/in\//, '').replace(/\/$/, ''); return { provider_id: id, public_identifier: id }; },
  async sendInvitation(providerId, message) { if (mem.restricted) return { ok: false, restricted: true, error: 'account restricted (simulated)' }; const id = 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); mem.invites.set(id, { provider_id: providerId, message: message, at: new Date().toISOString() }); return { ok: true, invitation_id: id }; },
  async listAccepted() { return Array.from(mem.accepted).map((pid) => ({ provider_id: pid })); },
  async listPendingInvitations() { return Array.from(mem.invites.entries()).map(([id, v]) => ({ invitation_id: id, provider_id: v.provider_id })); },
  async withdraw(invitationId) { mem.invites.delete(invitationId); return { ok: true }; },
  async sendMessage(providerId, text, chatId) { if (mem.restricted) return { ok: false, restricted: true, error: 'account restricted (simulated)' }; const id = chatId || ('chat-' + providerId); mem.chats.set(id, (mem.chats.get(id) || []).concat([{ text: text, is_sender: true, at: new Date().toISOString() }])); return { ok: true, chat_id: id, message_id: 'm-' + Date.now() }; },
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
    const ident = String(publicIdOrUrl).replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '').replace(/[/?#].*$/, '');
    const d = await uni('GET', '/api/v1/users/' + encodeURIComponent(ident) + '?account_id=' + encodeURIComponent(uniAccount()));
    return { provider_id: d.provider_id || d.id, public_identifier: d.public_identifier || ident, name: [d.first_name, d.last_name].filter(Boolean).join(' ') };
  },
  async sendInvitation(providerId, message) {
    try { const d = await uni('POST', '/api/v1/users/invite', { account_id: uniAccount(), provider_id: providerId, message: String(message || '').slice(0, 300) }); return { ok: true, invitation_id: d.invitation_id || d.id || null }; }
    catch (e) { return { ok: false, restricted: isRestriction(e), error: e.message }; }
  },
  async listAccepted() { const d = await uni('GET', '/api/v1/users/relations?account_id=' + encodeURIComponent(uniAccount()) + '&limit=250'); return (d.items || []).map((x) => ({ provider_id: x.member_id || x.provider_id || x.id, public_identifier: x.public_identifier, at: x.created_at })); },
  async listPendingInvitations() { const d = await uni('GET', '/api/v1/users/invite/sent?account_id=' + encodeURIComponent(uniAccount())); return (d.items || []).map((x) => ({ invitation_id: x.id || x.invitation_id, provider_id: x.invited_user_id || x.provider_id })); },
  async withdraw(invitationId) { try { await uni('DELETE', '/api/v1/users/invite/sent/' + encodeURIComponent(invitationId) + '?account_id=' + encodeURIComponent(uniAccount())); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
  async sendMessage(providerId, text, chatId) {
    try {
      if (chatId) { const d = await uni('POST', '/api/v1/chats/' + encodeURIComponent(chatId) + '/messages', { text: text }); return { ok: true, chat_id: chatId, message_id: d.message_id || d.id }; }
      const d = await uni('POST', '/api/v1/chats', { account_id: uniAccount(), attendees_ids: [providerId], text: text });
      return { ok: true, chat_id: d.chat_id || d.id, message_id: d.message_id || null };
    } catch (e) { return { ok: false, restricted: isRestriction(e), error: e.message }; }
  },
  async fetchNewMessages(sinceIso) {
    const d = await uni('GET', '/api/v1/messages?account_id=' + encodeURIComponent(uniAccount()) + (sinceIso ? '&after=' + encodeURIComponent(sinceIso) : '') + '&limit=100');
    return (d.items || []).filter((m) => !m.is_sender).map((m) => ({ provider_id: m.sender_id || m.sender_attendee_id, chat_id: m.chat_id, text: m.text || '', is_sender: false, at: m.timestamp || m.created_at }));
  },
  async test() { try { const d = await uni('GET', '/api/v1/accounts/' + encodeURIComponent(uniAccount())); return { ok: true, detail: 'Connected as ' + (d.name || d.id || 'account') + ' (' + (d.type || 'LINKEDIN') + ')' }; } catch (e) { return { ok: false, detail: e.message }; } },
};

function provider() { const n = providerName(); if (n === 'unipile') return unipile; if (n === 'dryrun') return dry; return null; }

// Safety limits (4.9), defaults per spec, hard cap 25 requests a day whatever the setting says.
const HARD_DAILY_REQUESTS = 25;
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

module.exports = { providerName, enabled, provider, dry, unipile, limits, inSendWindow, HARD_DAILY_REQUESTS };
