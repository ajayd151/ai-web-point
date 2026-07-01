// Tells the front-end who is signed in and whether they have paid access, so the
// UI can show the app (subscribed) or the paywall (signed in, no plan yet). Read-only.
const { account, canDeepDossier } = require('../lib/access');

module.exports = async (req, res) => {
  const a = await account(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    loggedIn: !!a.email,
    email: a.email,
    access: !!a.access,
    plan: a.plan,
    status: a.status,
    deepdossier: canDeepDossier(a.email), // private MVP: gates the hidden DeepDossier nav button
  });
};
