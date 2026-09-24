import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const SERVER = new URL('../mcp/server.mjs', import.meta.url);

/** Starts the MCP server over stdio and returns a request() helper speaking JSON-RPC to it. */
function startServer(env) {
  const child = spawn(process.execPath, [SERVER.pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { request, notify, stop: () => child.kill() };
}

const call = async (srv, name, args = {}) => {
  const res = await srv.request('tools/call', { name, arguments: args });
  const text = res.result.content[0].text;
  return { isError: !!res.result.isError, text, data: res.result.isError ? null : JSON.parse(text) };
};

test('MCP server: handshake, tool list and demo-data tool calls', async () => {
  // Unexpanded ${user_config.*} placeholders must be treated as "not set".
  const srv = startServer({ SAP_DEMO_MODE: 'true', SAP_COMPANY_CODE: '7827', SAP_USER: '${user_config.sap_user}' });
  try {
    const init = await srv.request('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' },
    });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    srv.notify('notifications/initialized');

    const list = await srv.request('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    assert.deepEqual(names, [
      'get_close_status', 'list_checklist_tasks', 'list_unposted_documents',
      'list_grir_items', 'list_accruals', 'open_dashboard', 'test_sap_connection',
    ]);
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

    const status = await call(srv, 'get_close_status');
    assert.equal(status.isError, false);
    assert.equal(status.data.context.companyCode, '7827');
    assert.equal(status.data.context.demoData, true);
    assert.ok(status.data.alerts.length > 0);
    assert.equal(status.data.checklist.items, undefined, 'overview omits item lists');

    const grir = await call(srv, 'list_grir_items', { flagged_only: true, limit: 2 });
    assert.ok(grir.data.items.length <= 2);
    assert.ok(grir.data.items.every((i) => i.flagged && i._raw === undefined));
    assert.match(grir.data.items[0].lastMovementDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(grir.data.items[0].grAmount > 0, 'signed GR amounts are normalised to positive');

    const missing = await call(srv, 'list_accruals', { state: 'missing' });
    assert.ok(missing.data.items.every((i) => i.state === 'missing'));

    const parked = await call(srv, 'list_unposted_documents', { min_age_days: 5 });
    assert.ok(parked.data.items.every((d) => d.ageDays >= 5));

    const unknown = await srv.request('tools/call', { name: 'nope', arguments: {} });
    assert.equal(unknown.error.code, -32602);
    const badMethod = await srv.request('resources/list', {});
    assert.equal(badMethod.error.code, -32601);
  } finally {
    srv.stop();
  }
});

test('MCP server: live mode without credentials reports a clear tool error', async () => {
  const srv = startServer({ SAP_DEMO_MODE: 'false', SAP_USER: '', SAP_PASSWORD: '' });
  try {
    await srv.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const res = await call(srv, 'get_close_status');
    assert.equal(res.isError, true);
    assert.match(res.text, /credentials are not configured/);
    const conn = await call(srv, 'test_sap_connection');
    assert.equal(conn.data.ok, false);
  } finally {
    srv.stop();
  }
});
