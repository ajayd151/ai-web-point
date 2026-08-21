// Twilio delivery receipt webhook. One tiny job: record whether each text was actually
// delivered, so "sent" never quietly means "vanished". No auth cookie (Twilio calls it); the
// worst a forged call can do is mislabel a delivery status, so it is deliberately simple.
const { setDeliveryBySid, setFunnelDeliveryBySid } = require('../lib/smsdb');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  let p = req.body;
  if (typeof p === 'string') {
    const u = new URLSearchParams(p); p = {};
    for (const [k, v] of u.entries()) p[k] = v;
  }
  p = p || {};
  const sid = String(p.MessageSid || p.SmsSid || '');
  const status = String(p.MessageStatus || p.SmsStatus || '').toLowerCase();
  if (sid && status) {
    const s = status.slice(0, 20);
    await setDeliveryBySid(sid, s);            // opener/nudge/link sends (item.sid)
    await setFunnelDeliveryBySid(sid, s);      // auto-built-site sends (funnel_site_sid); one of the two matches
  }
  res.status(200).send('ok');
};
