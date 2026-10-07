// Deep Dossier pieces that need no network: name tidy-up, the LinkedIn keep rule, and reading Apollo's phone payloads.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const realLoad = Module._load;
Module._load = function (req, parent, isMain) { if (req === '@vercel/blob') return { list: async () => ({ blobs: [] }), put: async () => ({}) }; return realLoad.apply(this, arguments); };
const D = require('../lib/deepdossier');
Module._load = realLoad;

test('a payroll qualification read as a surname is replaced from the LinkedIn slug', () => {
  assert.equal(D.cleanName('Stephen', 'McIpp', 'http://www.linkedin.com/in/stephen-cox-mcipp-87933b2b'), 'Stephen Cox');
  assert.equal(D.cleanName('Alison', 'Godwin', 'x'), 'Alison Godwin');
  assert.equal(D.cleanName('Noreen', 'McIpp', 'http://www.linkedin.com/in/payrollservices'), 'Noreen');
});

test('LinkedIn activity keep rule', () => {
  assert.equal(D.activityVerdict('quiet6', { connections: 309, days: 750 }).keep, true);
  assert.equal(D.activityVerdict('quiet6', { connections: 1672, days: 5 }).keep, false, 'commented 5 days ago');
  assert.equal(D.activityVerdict('quiet6', { connections: 6, days: null }).keep, false, 'empty profile');
  assert.equal(D.activityVerdict('quiet6', { connections: 400, days: null }).keep, true, 'a real profile that never posted is quiet');
  assert.equal(D.activityVerdict('quiet12', { connections: 488, days: 186 }).keep, false);
  assert.equal(D.activityVerdict('active', { connections: 900, days: 20 }).keep, true);
  assert.equal(D.activityVerdict('quiet6', { error: 'Recipient cannot be reached' }).keep, false);
});

test('phones and emails are read from Apollo waterfall payloads, with the do-not-call flag', () => {
  const payload = { webhook_result: { status: 'success', people: [
    { id: '54a61307746869367696bdbf', mobile_phone: [{ raw_number: '+44 781 360 4313', sanitized_number: '+447813604313', dnc_status_cd: 'found' }], direct_phone: [], emails: [{ email: 'robert.lorrimore@payrolloptions.com', email_status_cd: 'Verified' }, { email: 'robert.lorrimore@payrolloptions.com', email_status_cd: 'Verified' }] },
    { id: '694fd415a0da940001104805', mobile_phone: [], direct_phone: [], emails: [] },
  ] } };
  const out = D.parsePhonePayloads([payload]);
  assert.deepEqual(out['54a61307746869367696bdbf'].mobiles, ['+447813604313']);
  assert.deepEqual(out['54a61307746869367696bdbf'].dnc, ['+447813604313']);
  assert.deepEqual(out['54a61307746869367696bdbf'].emails, ['robert.lorrimore@payrolloptions.com'], 'duplicates removed');
  assert.ok(out['694fd415a0da940001104805'], 'a person with nothing found still counts as arrived');
  const legacy = D.parsePhonePayloads([{ people: [{ id: '54a2da3a746869382503f341', phone_numbers: [{ sanitized_number: '+441273897321', type_cd: 'work_direct' }] }] }]);
  assert.deepEqual(legacy['54a2da3a746869382503f341'].directs, ['+441273897321']);
});
