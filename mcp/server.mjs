#!/usr/bin/env node
// MCP server (stdio, JSON-RPC 2.0, newline-delimited) exposing the month-end close data to
// Claude Code. Dependency-free on purpose: it only needs initialize, tools/list and tools/call.
// stdout carries protocol messages only - diagnostics go to stderr.

import { createInterface } from 'node:readline';
import { getSnapshot, testConnection, slim } from './closeData.mjs';

const SERVER_INFO = { name: 'sap-close', version: '1.0.0' };

const periodProps = {
  company_code: { type: 'string', description: 'SAP company code, e.g. "7827". Defaults to the configured one.' },
  fiscal_year: { type: 'string', description: 'Fiscal year, e.g. "2026". Defaults to the configured/current one.' },
  period: { type: 'string', description: 'Fiscal period, e.g. "9" or "009". Defaults to the current month.' },
  refresh: { type: 'boolean', description: 'Bypass the 2-minute cache and re-read SAP.' },
};

const limitProp = { type: 'integer', minimum: 1, maximum: 500, description: 'Max rows to return (default 50).' };

function snapArgs(a) {
  return { companyCode: a.company_code, fiscalYear: a.fiscal_year, period: a.period, refresh: a.refresh };
}

function sectionOrError(snap, key) {
  if (snap.errors?.[key]) throw new Error(`Could not load ${key} from SAP: ${snap.errors[key]}`);
  return snap.summary[key];
}

const TOOLS = [
  {
    name: 'get_close_status',
    description:
      'Month-end close overview for a company code and period: checklist completion, counts and amounts of ' +
      'unposted/parked documents, open GR/IR, missing accruals, plus the ranked list of exceptions (alerts). ' +
      'Start here for any "how is the close going" question.',
    inputSchema: { type: 'object', properties: { ...periodProps }, additionalProperties: false },
    async run(a) {
      const snap = await getSnapshot(snapArgs(a));
      const s = snap.summary;
      return {
        context: snap.context,
        checklist: s.checklist && (({ items, ...rest }) => rest)(s.checklist),
        unposted: s.unposted && { count: s.unposted.count, totalAmount: s.unposted.totalAmount, currency: s.unposted.currency },
        grir: s.grir && (({ items, ...rest }) => rest)(s.grir),
        accruals: s.accruals && (({ items, ...rest }) => rest)(s.accruals),
        alerts: snap.alerts,
        sourceErrors: snap.errors,
      };
    },
  },
  {
    name: 'list_checklist_tasks',
    description: 'Close checklist tasks with owner, due date and state (done, open, overdue, error).',
    inputSchema: {
      type: 'object',
      properties: {
        ...periodProps,
        state: { type: 'string', enum: ['all', 'open', 'overdue', 'error', 'done'], description: 'Filter by state (default all).' },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    async run(a) {
      const snap = await getSnapshot(snapArgs(a));
      const c = sectionOrError(snap, 'checklist');
      const items = c.items.filter((t) => !a.state || a.state === 'all' || t.state === a.state);
      return { context: snap.context, completionPct: c.completionPct, total: items.length, items: items.slice(0, a.limit ?? 50).map(slim) };
    },
  },
  {
    name: 'list_unposted_documents',
    description: 'Parked / unposted FI documents, largest first, with age in days since posting date.',
    inputSchema: {
      type: 'object',
      properties: {
        ...periodProps,
        min_age_days: { type: 'integer', minimum: 0, description: 'Only documents parked at least this many days.' },
        min_amount: { type: 'number', minimum: 0, description: 'Only documents with |amount| at least this.' },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    async run(a) {
      const snap = await getSnapshot(snapArgs(a));
      const u = sectionOrError(snap, 'unposted');
      const items = u.items.filter(
        (d) => (d.ageDays ?? 0) >= (a.min_age_days ?? 0) && Math.abs(d.amount) >= (a.min_amount ?? 0),
      );
      return {
        context: snap.context,
        currency: u.currency,
        total: items.length,
        totalAmount: items.reduce((s, d) => s + Math.abs(d.amount), 0),
        items: items.slice(0, a.limit ?? 50).map(slim),
      };
    },
  },
  {
    name: 'list_grir_items',
    description:
      'Open GR/IR items per purchase order item: goods receipt vs invoice amount, difference ' +
      '(positive = received not invoiced, negative = invoiced not received), days since last movement, ' +
      'aging bucket and whether it breaches the clearing thresholds. Largest difference first.',
    inputSchema: {
      type: 'object',
      properties: {
        ...periodProps,
        flagged_only: { type: 'boolean', description: 'Only items breaching the aging + amount thresholds.' },
        min_age_days: { type: 'integer', minimum: 0, description: 'Only items with no movement for at least this many days.' },
        min_difference: { type: 'number', minimum: 0, description: 'Only items with |difference| at least this.' },
        supplier: { type: 'string', description: 'Case-insensitive match on supplier name.' },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    async run(a) {
      const snap = await getSnapshot(snapArgs(a));
      const g = sectionOrError(snap, 'grir');
      const items = g.items.filter(
        (i) =>
          (!a.flagged_only || i.flagged) &&
          (i.ageDays ?? 0) >= (a.min_age_days ?? 0) &&
          Math.abs(i.difference) >= (a.min_difference ?? 0) &&
          (!a.supplier || String(i.supplier ?? '').toLowerCase().includes(a.supplier.toLowerCase())),
      );
      return {
        context: snap.context,
        currency: g.currency,
        thresholds: { agingDays: snap.thresholds.grirAgingDays, minDifference: snap.thresholds.grirMinDifference },
        buckets: g.buckets,
        total: items.length,
        grossDifference: items.reduce((s, i) => s + Math.abs(i.difference), 0),
        items: items.slice(0, a.limit ?? 50).map(slim),
      };
    },
  },
  {
    name: 'list_accruals',
    description:
      'Expected accruals for the period with planned vs posted amount and state: missing (nothing posted), ' +
      'variance (posted but off plan beyond tolerance) or ok; overdue when past the posting due date.',
    inputSchema: {
      type: 'object',
      properties: {
        ...periodProps,
        state: { type: 'string', enum: ['all', 'missing', 'variance', 'ok'], description: 'Filter by state (default all).' },
        limit: limitProp,
      },
      additionalProperties: false,
    },
    async run(a) {
      const snap = await getSnapshot(snapArgs(a));
      const acc = sectionOrError(snap, 'accruals');
      const items = acc.items.filter((i) => !a.state || a.state === 'all' || i.state === a.state);
      return {
        context: snap.context,
        currency: acc.currency,
        tolerancePct: snap.thresholds.accrualTolerancePct,
        missingAmount: acc.missingAmount,
        total: items.length,
        items: items.slice(0, a.limit ?? 50).map(slim),
      };
    },
  },
  {
    name: 'open_dashboard',
    description:
      'Starts the full visual close dashboard (KPI tiles, charts, filterable tables, drill-down) as a local web ' +
      'page and returns its http://localhost URL. Use when the user wants to see or open the dashboard rather ' +
      'than a text answer. The page stays available while this Claude Code session is running.',
    inputSchema: {
      type: 'object',
      properties: {
        company_code: periodProps.company_code,
        fiscal_year: periodProps.fiscal_year,
        period: periodProps.period,
      },
      additionalProperties: false,
    },
    async run(a) {
      // Loaded on demand so plain tool calls never open a port.
      const { startDashboard } = await import('../web/server.mjs');
      const url = new URL(await startDashboard());
      if (a.company_code) url.searchParams.set('company_code', a.company_code);
      if (a.period) url.searchParams.set('period', String(a.period).padStart(3, '0'));
      if (a.fiscal_year) url.searchParams.set('fiscal_year', a.fiscal_year);
      return {
        url: url.href,
        note: 'Local page on this computer only (127.0.0.1). It stops when this Claude Code session ends; for a standalone server run "npm run dashboard" in the co-pilot folder.',
      };
    },
  },
  {
    name: 'test_sap_connection',
    description: 'Checks that the configured SAP system is reachable and the credentials work. Use when other tools fail.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => testConnection(),
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = byName.get(msg.params?.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${msg.params?.name}`), { code: -32602 });
      try {
        const result = await tool.run(msg.params.arguments ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] };
      } catch (e) {
        // Tool failures go back to the model as results, not protocol errors, so it can react.
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // notification (e.g. notifications/initialized)
  try {
    send({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) });
  } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});
rl.on('close', () => process.exit(0));
