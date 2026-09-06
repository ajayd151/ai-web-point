// App version shown bottom-left in the sidebar (subtle), so Ajay and Claude can talk about "which
// version is live". Bump APP_VERSION on every deploy that changes behaviour. The short git SHA is
// appended automatically from Vercel's VERCEL_GIT_COMMIT_SHA, so a hot fix without a bump still shows.
const APP_VERSION = '1.4.11';
function buildStamp() { const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7); return 'v' + APP_VERSION + (sha ? ' · ' + sha : ''); }
module.exports = { APP_VERSION, buildStamp };
