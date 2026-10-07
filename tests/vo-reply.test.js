// The reply text must reach the model: until 7 Oct 2026 a broken quote sent "+ t.slice(0, 1500) +" instead of the reply.
const test = require('node:test');
const assert = require('node:assert');

test('classifyReply puts the actual reply text in the prompt', async () => {
  const saved = { key: process.env.OPENAI_API_KEY, fetch: global.fetch };
  process.env.OPENAI_API_KEY = 'test-key';
  let sent = '';
  global.fetch = async (url, opts) => { sent = JSON.parse(opts.body).messages[1].content; return { json: async () => ({ choices: [{ message: { content: '{"sentiment":"Positive","summary":"Wants a downloadable copy to show the team"}' } }] }) }; };
  try {
    delete require.cache[require.resolve('../lib/vo-services')];
    const S = require('../lib/vo-services');
    const reply = 'Clever. Can you resend the file in a way I can download it? I want to show my team.';
    const r = await S.classifyReply(reply, { brand: 'Organics Ocean' });
    assert.ok(sent.includes(reply), 'the reply is in the prompt');
    assert.ok(!/t\.slice\(/.test(sent), 'no code leaked into the prompt');
    assert.equal(r.sentiment, 'Positive');
  } finally {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.key;
    global.fetch = saved.fetch;
    delete require.cache[require.resolve('../lib/vo-services')];
  }
});
