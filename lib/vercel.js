// Thin wrapper over the Vercel REST API to add/remove a project domain, so the
// app can put a Pounce site live on <subdomain>.aiwebpoint.com (Vercel then
// auto-issues the SSL cert). Needs env: VERCEL_TOKEN, VERCEL_PROJECT_ID (id or
// name), VERCEL_TEAM_ID (team_… id OR the team slug). No-op-safe: throws a clear
// error if not configured so callers can degrade gracefully.
const API = 'https://api.vercel.com';

function cfg() {
  const token = process.env.VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  const team = process.env.VERCEL_TEAM_ID || '';
  if (!token || !project) throw new Error('Vercel API not configured (VERCEL_TOKEN / VERCEL_PROJECT_ID).');
  // teamId param accepts a team_… id; a slug must be passed as ?slug=
  const teamQ = team ? (team.indexOf('team_') === 0 ? 'teamId=' + encodeURIComponent(team) : 'slug=' + encodeURIComponent(team)) : '';
  return { token, project, teamQ };
}

function isConfigured() {
  return !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
}

async function addDomain(name) {
  const { token, project, teamQ } = cfg();
  const url = `${API}/v10/projects/${encodeURIComponent(project)}/domains` + (teamQ ? '?' + teamQ : '');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const d = await r.json().catch(() => ({}));
  // 409 = already added to this project, treat as success
  if (!r.ok && r.status !== 409) {
    throw new Error((d && d.error && d.error.message) || ('Vercel add-domain failed (' + r.status + ')'));
  }
  return d;
}

async function removeDomain(name) {
  const { token, project, teamQ } = cfg();
  const url = `${API}/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(name)}` + (teamQ ? '?' + teamQ : '');
  const r = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  // 404 = not there, fine
  if (!r.ok && r.status !== 404) {
    const d = await r.json().catch(() => ({}));
    throw new Error((d && d.error && d.error.message) || ('Vercel remove-domain failed (' + r.status + ')'));
  }
  return true;
}

module.exports = { isConfigured, addDomain, removeDomain };
