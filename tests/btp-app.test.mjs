import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '../tools/build-btp.mjs';
import { getBrowserSnapshot, SessionExpiredError } from '../btp/browser-snapshot.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const baseConfig = JSON.parse(await readFile(path.join(ROOT, 'config', 'default-config.json'), 'utf8'));
// Explicit demo/live settings, so these tests don't depend on the repo's current demoMode default.
const liveConfig = { ...baseConfig, demoMode: false };
const demoConfig = { ...baseConfig, demoMode: true };
const ORIGIN = 'https://closecopilot-ui.example.com';
const SAP_HOST = 'http://vhc2jq4rci.rise.ccbji.co.jp:8000';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test('BTP bundle: page uses the BTP entry script and ships no extension-only code', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'btp-bundle-'));
  try {
    await buildBundle(out);
    const html = await readFile(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /<base href="\/src\/dashboard\/" \/>/);
    assert.match(html, /<script type="module" src="\/btp\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /src="dashboard\.js"/);
    assert.match(html, /<title>Month End Close Co-Pilot<\/title>/);
    assert.match(html, /<h1>Month End Close Co-Pilot<\/h1>/);
    assert.doesNotMatch(html, /Month-End Close Co-Pilot/);

    const config = JSON.parse(await readFile(path.join(out, 'config', 'default-config.json'), 'utf8'));
    assert.equal(config.sap.baseUrl, '', 'the SAP host name is not shipped in the page bundle');

    await assert.rejects(readFile(path.join(out, 'src', 'dashboard', 'dashboard.js')), 'extension entry is left out');
    for (const f of ['btp/app.js', 'btp/browser-snapshot.js', 'src/lib/sapClient.js', 'src/dashboard/render.js', 'icons/icon32.png']) {
      await readFile(path.join(out, f));
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('browser snapshot, demo data: same sections and period handling as the server version', async () => {
  const snap = await getBrowserSnapshot(demoConfig, {
    origin: ORIGIN, period: '8', today: new Date(2026, 6, 15), fetchImpl: () => assert.fail('no SAP call in demo mode'),
  });
  assert.equal(snap.demo, true);
  assert.equal(snap.context.period, '008');
  assert.deepEqual(Object.keys(snap.summary).sort(),
    ['accruals', 'checklist', 'grir', 'maintenanceOrder', 'productionOrder', 'unposted']);
  assert.equal(snap.context.system, null, 'the page never receives the SAP host name');
});

test('browser snapshot, live: every request goes through the approuter and paging follows __next', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    requested.push(u);
    if (u.searchParams.has('$skiptoken')) return okJson({ d: { results: [] } });
    // SAP builds the next-page link from its own host name, which the browser can't reach.
    const next = new URL(u);
    next.protocol = 'http:';
    next.host = SAP_HOST.replace('http://', '');
    next.searchParams.set('$skiptoken', 'page2');
    return okJson({ d: { results: [], __next: next.href } });
  };

  const snap = await getBrowserSnapshot(liveConfig, { origin: ORIGIN, today: new Date(2026, 6, 15), fetchImpl });

  assert.equal(snap.demo, false);
  assert.ok(requested.length > 0);
  for (const u of requested) {
    assert.equal(u.origin, ORIGIN, `request left the approuter origin: ${u}`);
    assert.match(u.pathname, /^\/sap\/opu\/odata\/sap\//, `not a SAP OData path: ${u.pathname}`);
    assert.equal(u.searchParams.get('sap-client'), liveConfig.sap.client);
  }
  assert.ok(requested.some((u) => u.searchParams.has('$skiptoken')), 'the second page was requested');
  assert.deepEqual(Object.keys(snap.errors), [], 'no section failed');
});

test('browser snapshot, live: one failing section is reported on its own', async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.includes('API_MANUALACCRUALS')) {
      return { ok: false, status: 500, json: async () => ({ error: { message: { value: 'boom' } } }) };
    }
    return okJson({ d: { results: [] } });
  };
  const snap = await getBrowserSnapshot(liveConfig, { origin: ORIGIN, today: new Date(2026, 6, 15), fetchImpl });
  assert.match(snap.errors.accruals, /SAP returned 500: boom/);
  assert.equal(snap.errors.grir, undefined);
});

test('browser snapshot, live: an expired sign-in is reported as SESSION_EXPIRED', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(
    getBrowserSnapshot(liveConfig, { origin: ORIGIN, fetchImpl }),
    (e) => e instanceof SessionExpiredError && e.code === 'SESSION_EXPIRED',
  );
});

test('approuter routes cover every SAP path the dashboard reads, and use only declared scopes', async () => {
  const xsApp = JSON.parse(await readFile(path.join(ROOT, 'btp', 'approuter', 'xs-app.json'), 'utf8'));
  const xsSecurity = JSON.parse(await readFile(path.join(ROOT, 'btp', 'xs-security.json'), 'utf8'));

  const sapRoute = xsApp.routes.find((r) => r.destination);
  assert.equal(sapRoute.destination, 'sap-rise', 'btp/README.md names this destination');
  assert.equal(sapRoute.target, '/sap/$1', 'SAP paths must keep their /sap/ prefix');

  const paths = [];
  for (const source of Object.values(baseConfig.sources)) {
    paths.push(source.path, ...(source.joins ?? []).map((j) => j.path), ...(source.join ? [source.join.path] : []));
  }
  const sapPattern = new RegExp(sapRoute.source);
  for (const p of paths) assert.match(p, sapPattern, `no approuter route for ${p}`);

  const declared = new Set(xsSecurity.scopes.map((s) => s.name));
  for (const route of xsApp.routes) {
    assert.ok(declared.has(route.scope), `route ${route.source} uses undeclared scope ${route.scope}`);
  }
  for (const role of xsSecurity['role-templates']) {
    for (const scope of role['scope-references']) assert.ok(declared.has(scope), `role ${role.name}: ${scope}`);
  }
});
