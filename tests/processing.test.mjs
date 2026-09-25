import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseSapDate, parseAmount, daysBetween, normalize, analyzeChecklist, analyzeUnposted, analyzeGrir,
  analyzeAccruals, buildSnapshot, buildAlerts,
} from '../src/lib/processing.js';
import { parseODataPage, buildUrl, fillPlaceholders, mergeJoinedRows } from '../src/lib/sapClient.js';
import { deepMerge, periodVars, stripSecrets, requiredOrigins } from '../src/lib/config.js';
import { mockRaw } from '../src/lib/mockData.js';

const config = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url)));
// Tests use a fixed host so editing the real system URL in the config doesn't break them.
config.sap.baseUrl = 'https://my-s4-system.example.com';
config.sap.companyCode = '1000';
config.sap.fiscalYear = '';
const today = new Date('2026-09-23T10:00:00Z');
const day = (off) => `/Date(${today.getTime() + off * 86400000})/`;

test('parseSapDate handles OData v2, ISO and yyyymmdd', () => {
  assert.equal(parseSapDate('/Date(1758585600000)/').toISOString(), '2025-09-23T00:00:00.000Z');
  assert.equal(parseSapDate('/Date(1758585600000+0000)/').toISOString(), '2025-09-23T00:00:00.000Z');
  assert.equal(parseSapDate('2026-09-01').toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseSapDate('20260901').toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseSapDate(''), null);
  assert.equal(parseSapDate('garbage'), null);
});

test('parseAmount handles strings, commas and junk', () => {
  assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.equal(parseAmount(-7), -7);
  assert.equal(parseAmount(null), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween(new Date('2026-09-20T23:00:00Z'), today), 3);
  assert.equal(daysBetween(null, today), null);
});

test('normalize trims space-padded ABAP CHAR values but leaves non-strings alone', () => {
  // e.g. cast('' as abap.char(40)) arrives over OData as 40 spaces, not ''.
  const rows = normalize([{ NAME: '  Jane Doe   ', BLANK: '                                        ', AMT: 12.5, NIL: null }],
    { name: 'NAME', owner: 'BLANK', amount: 'AMT', nil: 'NIL' });
  assert.equal(rows[0].name, 'Jane Doe');
  assert.equal(rows[0].owner, '');
  assert.equal(rows[0].amount, 12.5);
  assert.equal(rows[0].nil, null);
});

// A minimal, self-contained field mapping - independent of whatever shape the live config's
// checklist source happens to have (currently API_INSPECTIONLOT_SRV), so these generic tests
// keep testing analyzeChecklist's own logic rather than that source's specifics.
const genericChecklistFields = { id: 'TaskID', name: 'TaskName', status: 'Status', dueDate: 'PlannedEndDate' };

test('checklist states: done, error, overdue, open (generic due-date semantics)', () => {
  const src = { fields: genericChecklistFields, statusValues: { done: ['COMPLETED'], error: ['ERROR'] } };
  const rows = [
    { TaskID: '1', TaskName: 'A', Status: 'COMPLETED', PlannedEndDate: day(-5) },
    { TaskID: '2', TaskName: 'B', Status: 'ERROR', PlannedEndDate: day(1) },
    { TaskID: '3', TaskName: 'C', Status: 'IN_PROCESS', PlannedEndDate: day(-1) },
    { TaskID: '4', TaskName: 'D', Status: 'NOT_STARTED', PlannedEndDate: day(0) },
  ];
  const r = analyzeChecklist(rows, src, today);
  assert.deepEqual(r.items.map((t) => t.state), ['done', 'error', 'overdue', 'open']);
  assert.equal(r.completionPct, 25);
});

test('checklist dueDateIsAge + statusMeansDoneWhenNonBlank: the real config.sources.checklist shape', () => {
  // API_INSPECTIONLOT_SRV: no fixed "done" code list (any Usage Decision code closes a lot) and
  // no due date (InspectionLotCreatedOn stands in for it - overdue = older than the SLA).
  const src = config.sources.checklist;
  assert.equal(src.dueDateIsAge, true);
  assert.equal(src.statusMeansDoneWhenNonBlank, true);
  assert.equal(src.nameFromId, true);
  const rows = [
    { InspectionLot: '1', InspectionLotUsageDecisionCode: '', InspectionLotCreatedOn: day(-15) },
    { InspectionLot: '2', InspectionLotUsageDecisionCode: '', InspectionLotCreatedOn: day(-2) },
    { InspectionLot: '3', InspectionLotUsageDecisionCode: 'A1', InspectionLotCreatedOn: day(-30) },
  ];
  const r = analyzeChecklist(rows, src, today, { checklistSlaDays: 10 });
  assert.deepEqual(r.items.map((t) => t.state), ['overdue', 'open', 'done']);
  assert.deepEqual(r.items.map((t) => t.name), ['Inspection lot 1', 'Inspection lot 2', 'Inspection lot 3']);
});

test('unposted documents are filtered by threshold and sorted by amount', () => {
  const src = config.sources.unposted;
  const rows = [
    { AccountingDocument: 'a', AmountInCompanyCodeCurrency: '10', CompanyCodeCurrency: 'EUR', PostingDate: day(-1) },
    { AccountingDocument: 'b', AmountInCompanyCodeCurrency: '-500', CompanyCodeCurrency: 'EUR', PostingDate: day(-9) },
  ];
  const r = analyzeUnposted(rows, src, { unpostedMinAmount: 100 }, today);
  assert.equal(r.count, 1);
  assert.equal(r.items[0].id, 'b');
  assert.equal(r.items[0].ageDays, 9);
  assert.equal(r.totalAmount, 500);
});

test('GR/IR flags old, material differences and buckets by age', () => {
  const src = { ...config.sources.grir, signedAmounts: false };
  const rows = [
    { PurchaseOrder: '1', GoodsReceiptAmount: '5000', InvoiceReceiptAmount: '0', LastMovementDate: day(-95) },
    { PurchaseOrder: '2', GoodsReceiptAmount: '5000', InvoiceReceiptAmount: '0', LastMovementDate: day(-5) },
    { PurchaseOrder: '3', GoodsReceiptAmount: '100', InvoiceReceiptAmount: '0', LastMovementDate: day(-95) },
    { PurchaseOrder: '4', GoodsReceiptAmount: '200', InvoiceReceiptAmount: '200', LastMovementDate: day(-95) },
  ];
  const r = analyzeGrir(rows, src, { grirAgingDays: 30, grirMinDifference: 1000 }, today);
  assert.equal(r.count, 3, 'fully matched items are excluded');
  assert.deepEqual(r.items.filter((i) => i.flagged).map((i) => i.id), ['1']);
  assert.equal(r.buckets['90+'], 5100);
  assert.equal(r.buckets['0-30'], 5000);
});

test('GR/IR signed amounts (as posted on the GR/IR account) are normalised', () => {
  const src = { ...config.sources.grir, signedAmounts: true };
  const rows = [
    // GR 5000 credited, IR 3000 debited -> 2000 received but not invoiced
    { PurchaseOrder: '1', GoodsReceiptAmount: '-5000.00', InvoiceReceiptAmount: '3000.00', LastMovementDate: day(-40) },
    // No GR yet (null from the CDS sum), invoice 800 -> invoiced but not received
    { PurchaseOrder: '2', GoodsReceiptAmount: null, InvoiceReceiptAmount: '800.00', LastMovementDate: day(-3) },
  ];
  const r = analyzeGrir(rows, src, { grirAgingDays: 30, grirMinDifference: 1000 }, today);
  const byId = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(byId['1'].grAmount, 5000);
  assert.equal(byId['1'].difference, 2000);
  assert.equal(byId['1'].flagged, true);
  assert.equal(byId['2'].difference, -800);
});

test('accruals: missing, variance within/over tolerance, overdue', () => {
  const src = config.sources.accruals;
  const rows = [
    { AccrualObject: 'm', PlannedAmount: '1000', PostedAmount: '0', PostingDueDate: day(-1) },
    { AccrualObject: 'v', PlannedAmount: '1000', PostedAmount: '900', PostingDueDate: day(2) },
    { AccrualObject: 'ok', PlannedAmount: '1000', PostedAmount: '970', PostingDueDate: day(-1) },
  ];
  const r = analyzeAccruals(rows, src, { accrualTolerancePct: 5 }, today);
  assert.deepEqual(r.items.map((a) => a.state), ['missing', 'variance', 'ok']);
  assert.equal(r.items[0].overdue, true);
  assert.equal(r.items[2].overdue, false);
  assert.equal(r.missingAmount, 1000);
});

test('buildAlerts never names individual checklist items, however many there are', () => {
  // A real close can have hundreds of open items (e.g. an old EAM backlog) - the alert must stay
  // a one-line count, not grow into a list of names.
  const items = Array.from({ length: 175 }, (_, i) => ({ state: 'overdue', name: `Inspection lot ${i}`, owner: '' }));
  const alerts = buildAlerts({ checklist: { error: 0, overdue: 175, items, dueDateIsAge: true } }, { checklistSlaDays: 10 });
  const alert = alerts.find((a) => a.title === '175 close task(s) overdue');
  assert.ok(alert, 'the overdue alert fires with the full count in its title');
  assert.doesNotMatch(alert.detail, /Inspection lot/, 'no item names in the detail line');
  assert.equal(alert.detail, 'Open longer than 10 days');
});

test('buildAlerts describes overdue checklist items differently for the two due-date semantics', () => {
  const base = { checklist: { error: 0, overdue: 2, items: [] } };
  const age = buildAlerts({ checklist: { ...base.checklist, dueDateIsAge: true } }, { checklistSlaDays: 7 });
  assert.equal(age[0].detail, 'Open longer than 7 days');
  const literal = buildAlerts({ checklist: { ...base.checklist, dueDateIsAge: false } }, {});
  assert.equal(literal[0].detail, 'Past their due date');
});

test('buildSnapshot on demo data produces all sections and sorted alerts', () => {
  const snap = buildSnapshot(mockRaw(config, today), config, today);
  assert.deepEqual(Object.keys(snap.summary).sort(), ['accruals', 'checklist', 'grir', 'unposted']);
  assert.ok(snap.alerts.length > 0);
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < snap.alerts.length; i++) assert.ok(rank[snap.alerts[i - 1].severity] <= rank[snap.alerts[i].severity]);
  // EAM inspection lots have no "failed" state (see analyzeChecklist's dueDateIsAge comment).
  assert.equal(snap.summary.checklist.error, 0);
  assert.equal(snap.summary.checklist.overdue, 3);
  assert.equal(snap.summary.checklist.completionPct, 50);
  assert.equal(snap.summary.accruals.missingCount, 3);
});

test('buildSnapshot reports per-source errors without failing others', () => {
  const raw = mockRaw(config, today);
  raw.grir = new Error('SAP returned 404');
  const snap = buildSnapshot(raw, config, today);
  assert.equal(snap.errors.grir, 'SAP returned 404');
  assert.equal(snap.summary.grir, undefined);
  assert.ok(snap.summary.checklist);
});

test('parseODataPage handles v2 and v4 payloads', () => {
  assert.deepEqual(parseODataPage({ d: { results: [1, 2], __next: 'n' } }), { rows: [1, 2], next: 'n' });
  assert.deepEqual(parseODataPage({ value: [3], '@odata.nextLink': 'm' }), { rows: [3], next: 'm' });
  assert.deepEqual(parseODataPage({}), { rows: [], next: null });
});

test('mergeJoinedRows left-joins by key, e.g. inspection lots + their Usage Decision', () => {
  const lots = [{ InspectionLot: '1', Plant: '1000' }, { InspectionLot: '2', Plant: '1000' }];
  const decisions = [{ InspectionLot: '1', InspectionLotUsageDecisionCode: 'A1' }];
  const merged = mergeJoinedRows(lots, decisions, 'InspectionLot');
  assert.deepEqual(merged[0], { InspectionLot: '1', Plant: '1000', InspectionLotUsageDecisionCode: 'A1' });
  assert.deepEqual(merged[1], { InspectionLot: '2', Plant: '1000' }, 'no match -> unchanged, not an error');
  assert.equal(mergeJoinedRows(lots, [], 'InspectionLot').length, 2, 'an empty join set still returns every main row');
});

test('buildUrl fills placeholders and escapes quotes', () => {
  assert.equal(fillPlaceholders("X eq '{a}' and {missing}", { a: "O'Neil" }), "X eq 'O''Neil' and {missing}");
  const url = buildUrl(config, config.sources.grir, { companyCode: '1000' });
  assert.equal(url.origin, 'https://my-s4-system.example.com');
  assert.equal(url.searchParams.get('sap-client'), '100');
  assert.equal(url.searchParams.get('$filter'), "CompanyCode eq '1000'");
  const proxied = buildUrl({ ...config, sap: { ...config.sap, proxyUrl: 'https://proxy.local' } }, config.sources.grir, {});
  assert.equal(proxied.origin, 'https://proxy.local');
});

test('config helpers', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [1] }, { a: { c: 3 }, l: [2] }), { a: { b: 1, c: 3 }, l: [2] });
  assert.deepEqual(periodVars(config, today), { fiscalYear: '2026', period: '009', companyCode: '1000', plant: '' });
  const fixedFy = { ...config, sap: { ...config.sap, companyCode: '7827', fiscalYear: '2025', plant: '1000' } };
  assert.deepEqual(periodVars(fixedFy, today), { fiscalYear: '2025', period: '009', companyCode: '7827', plant: '1000' });
  const aprilFy = { ...config, sap: { ...config.sap, fiscalYearStartMonth: 4 } };
  assert.deepEqual(periodVars(aprilFy, today), { fiscalYear: '2027', period: '006', companyCode: '1000', plant: '' });
  const secret = structuredClone(config);
  secret.auth.basic.password = 'x';
  secret.auth.oauth2.clientSecret = 'y';
  const clean = stripSecrets(secret);
  assert.equal(clean.auth.basic.password, undefined);
  assert.equal(clean.auth.oauth2.clientSecret, undefined);
  assert.deepEqual(requiredOrigins(config), ['https://my-s4-system.example.com/*']);
  const onPrem = { ...config, sap: { ...config.sap, baseUrl: 'http://sapgw01.corp.local:8000' }, auth: { ...config.auth, method: 'basic' } };
  assert.deepEqual(requiredOrigins(onPrem), ['http://sapgw01.corp.local/*'], 'http host, port stripped');
});
