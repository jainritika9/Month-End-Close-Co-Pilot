import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

process.env.SAP_DEMO_MODE = 'true';
process.env.SAP_COMPANY_CODE = '7827';
const { startDashboard, stopDashboard } = await import('../web/server.mjs');

/** Raw GET so the Host header can be forged (fetch doesn't allow that). */
function rawGet(url, host) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    request({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject).end();
  });
}

test('web dashboard server: page, API and access restrictions', async () => {
  const base = await startDashboard({ port: 0 });
  assert.match(base, /^http:\/\/localhost:\d+\/$/);
  assert.equal(await startDashboard({ port: 0 }), base, 'second start reuses the running server');

  const html = await (await fetch(base)).text();
  assert.match(html, /<base href="\/src\/dashboard\/"/);
  assert.match(html, /src="\/web\/app\.js"/);
  assert.doesNotMatch(html, /src="dashboard\.js"/);

  const state = await (await fetch(new URL('/api/state', base))).json();
  assert.equal(state.demo, true);
  assert.equal(state.signedIn, true);
  assert.equal(state.defaults.companyCode, '7827');

  const snapRes = await fetch(new URL('/api/snapshot?period=8', base));
  assert.equal(snapRes.status, 200);
  const snap = await snapRes.json();
  assert.equal(snap.demo, true);
  assert.equal(snap.context.period, '008');
  assert.deepEqual(Object.keys(snap.summary).sort(), ['accruals', 'checklist', 'grir', 'unposted']);
  assert.ok(snap.summary.grir.items[0]._raw, 'drill-down keeps raw SAP fields');

  assert.equal((await fetch(new URL('/src/dashboard/render.js', base))).status, 200);
  assert.equal((await fetch(new URL('/web/app.js', base))).status, 200);
  // Only UI folders are served: no config, tests, package files or traversal.
  for (const p of ['/config/default-config.json', '/package.json', '/tests/web-server.test.mjs', '/src/../package.json', '/%2e%2e/package.json']) {
    assert.equal((await fetch(new URL(p, base))).status, 404, p);
  }
  assert.equal(await rawGet(base, 'evil.example.com'), 403, 'foreign Host header is rejected');
  assert.equal((await fetch(base, { method: 'DELETE' })).status, 405);

  // Metadata diagnostic endpoint: no service param, invalid name, and demo mode (no real SAP to ask).
  assert.equal((await fetch(new URL('/api/metadata', base))).status, 400);
  const badService = await fetch(new URL('/api/metadata?service=../../etc', base));
  assert.equal(badService.status, 502);
  assert.match((await badService.json()).error, /Invalid service name/);
  const demoService = await fetch(new URL('/api/metadata?service=API_INSPECTIONLOT_SRV', base));
  assert.equal(demoService.status, 502);
  assert.match((await demoService.json()).error, /Demo mode is on/);

  await stopDashboard();
});
