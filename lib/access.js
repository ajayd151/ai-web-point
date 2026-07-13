// Central PAID-access decision. The Clerk session cookie only proves WHO you are;
// this decides whether you may use the paid tool. Access is granted to:
//   1. the owner (operator), always,
//   2. anyone on the comp allow-list (ALLOWED_EMAILS) - free, no card needed,
//   3. anyone with an active/trialing Stripe subscription (the paying customers).
// Everyone else is signed in but "no plan yet" -> the front-end shows the paywall
// and these guards return 402 from the costly endpoints. Fails CLOSED on any error.
const { identity, parseCookie } = require('./auth');
const { getUserByEmail, getTeamMember } = require('./db');
const { ownerEmail } = require('./tenant');

const ACTIVE_STATUSES = ['active', 'trialing'];

// The permissions a team member can be granted/denied. Owners and paying customers
// implicitly have ALL of them for their own workspace; only TEAM MEMBERS get restricted.
// Action permissions (what they can DO) + tab-visibility permissions (what they can SEE).
const ACTION_PERM_KEYS = ['search', 'mockups', 'sites', 'prowl', 'callList', 'deleteLeads', 'export', 'sms', 'emails', 'block'];
const VIEW_PERM_KEYS = ['viewTemplates', 'viewPerformance', 'viewWarmLeads', 'viewCallList', 'viewAllLeads', 'viewWebsites', 'viewEnquiries'];
const PERM_KEYS = ACTION_PERM_KEYS.concat(VIEW_PERM_KEYS);
// Numeric caps a team member can be given (null/absent = unlimited).
const LIMIT_KEYS = ['searchMax', 'callListMax', 'exportPerDay'];
function cleanLimits(raw) {
  const out = {}; const s = raw || {};
  LIMIT_KEYS.forEach((k) => { const n = Number(s[k]); out[k] = (Number.isFinite(n) && n > 0) ? Math.floor(n) : null; });
  return out;
}
function allPerms() { const o = {}; PERM_KEYS.forEach((k) => { o[k] = true; }); return o; }
// Resolve a stored permission object into every key (true unless explicitly denied).
function resolvePerms(stored) { const o = {}; const s = stored || {}; PERM_KEYS.forEach((k) => { o[k] = s[k] !== false; }); return o; }

function allowList() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Free/comped access (no subscription required): the owner, the legacy operator
// login (APP_USERNAME), and anyone on the explicit allow-list.
function isComped(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (e === ownerEmail()) return true;
  const opUser = String(process.env.APP_USERNAME || '').toLowerCase();
  if (opUser && e === opUser) return true;
  if (!opUser && e === 'user') return true; // legacy password-only login signs identity 'user'
  return allowList().includes(e);
}

// The signed-in email from the session cookie ('' if not logged in).
function sessionEmail(req) {
  const e = identity(parseCookie(req, 'aiwp'), Date.now());
  return e ? String(e).toLowerCase() : '';
}

// ---- DeepDossier (private MVP, Phase 1) ----------------------------------
// Watertight allow-list gate for the DeepDossier module. Only emails on
// DEEPDOSSIER_EMAILS (comma-separated) may see the button or hit the route.
// The owner is always allowed. Kept separate from paid access on purpose:
// this is a hidden internal tool, not a plan feature. Remove the whole block
// (and DEEPDOSSIER_EMAILS) at public launch.
function deepDossierList() {
  return (process.env.DEEPDOSSIER_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function canDeepDossier(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (e === ownerEmail()) return true;
  // The legacy operator login (APP_USERNAME, or 'user' when unset) is also Ajay,
  // so it must see DeepDossier too, however he signs in. NOTE: comped ALLOWED_EMAILS
  // users are deliberately NOT allowed here, only the owner + explicit list.
  const opUser = String(process.env.APP_USERNAME || '').toLowerCase();
  if (opUser && e === opUser) return true;
  if (!opUser && e === 'user') return true;
  return deepDossierList().includes(e);
}

// Guard for the DeepDossier endpoint. If the signed-in user is not on the
// allow-list we return 404 (NOT 401/402/403) so the feature's existence is
// never revealed to anyone else. Returns the account on success, else null.
async function requireDeepDossier(req, res) {
  const email = sessionEmail(req);
  if (!canDeepDossier(email)) { res.status(404).json({ error: 'Not found.' }); return null; }
  return { email };
}

// Full access decision. Returns { email, access, plan, status, reason }.
async function account(req) {
  const email = sessionEmail(req);
  if (!email) return { email: '', access: false, plan: 'none', status: 'anon', reason: 'not_logged_in', member: false, perms: allPerms(), limits: {} };
  if (isComped(email)) return { email, access: true, plan: 'owner', status: 'comped', reason: 'comped', member: false, perms: allPerms(), limits: {} };
  // Team member: free access, riding their account owner's plan (NOT an admin/owner).
  try {
    const tm = await getTeamMember(email);
    if (tm && !tm.suspended) return { email, access: true, plan: 'team', status: 'comped', reason: 'team', member: true, perms: resolvePerms(tm.permissions), limits: cleanLimits(tm.limits) };
  } catch (e) { /* fall through to subscription check */ }
  let plan = 'none', status = 'inactive';
  try {
    const u = await getUserByEmail(email);
    if (u) { plan = u.plan || 'none'; status = u.status || 'inactive'; }
  } catch (e) { /* fail closed: treat as no access */ }
  const access = ACTIVE_STATUSES.includes(status);
  return { email, access, plan, status, reason: access ? 'subscribed' : 'no_subscription', member: false, perms: allPerms(), limits: {} };
}

// Guard for paid endpoints. Sends 401 (not logged in) or 402 (no subscription)
// and returns null; otherwise returns the account. Usage:
//   const acct = await requirePaid(req, res); if (!acct) return;
async function requirePaid(req, res) {
  const a = await account(req);
  if (!a.email) { res.status(401).json({ error: 'Please sign in first.' }); return null; }
  if (!a.access) {
    res.status(402).json({ error: 'subscription_required', message: 'Choose a plan to start using Site Pounce.', plan: a.plan, status: a.status });
    return null;
  }
  return a;
}

// Does this request's user have a given permission? Owners/customers => always yes for
// their own workspace; team members => per their granted permissions.
async function can(req, key) {
  const email = sessionEmail(req);
  if (!email) return false;
  if (isComped(email)) return true;
  let tm = null;
  try { tm = await getTeamMember(email); } catch (e) { /* not a member */ }
  if (!tm || tm.suspended) return true; // not a team member => full rights to own workspace
  return resolvePerms(tm.permissions)[key] !== false;
}
// Guard: 403 if the (team) user lacks the permission. Returns true when allowed.
async function requirePermission(req, res, key) {
  if (await can(req, key)) return true;
  res.status(403).json({ error: 'no_permission', permission: key, message: 'Your team account does not have permission for this. Ask your admin to enable it.' });
  return false;
}

module.exports = { account, requirePaid, isComped, sessionEmail, canDeepDossier, requireDeepDossier, can, requirePermission, PERM_KEYS, ACTION_PERM_KEYS, VIEW_PERM_KEYS, LIMIT_KEYS, cleanLimits };
