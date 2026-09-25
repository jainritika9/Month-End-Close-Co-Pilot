// Demo data used when demoMode is on. Rows are emitted in raw SAP shape (via the configured field
// mappings, with OData v2 /Date()/ values) so they exercise the same processing path as live data.

const DAY_MS = 24 * 3600 * 1000;

function odataDate(today, offsetDays) {
  return `/Date(${today.getTime() + offsetDays * DAY_MS})/`;
}

function toSap(items, fields) {
  return items.map((item) => {
    const row = {};
    for (const [key, sapField] of Object.entries(fields)) if (key in item) row[sapField] = item[key];
    return row;
  });
}

export function mockRaw(config, today = new Date()) {
  const s = config.sources;
  const d = (off) => odataDate(today, off);

  // Shaped like the standard API_INSPECTIONLOT_SRV data this now reads (see
  // config.sources.checklist): InspectionLotUsageDecisionCode is blank until a decision is made -
  // any non-blank code counts as closed (statusMeansDoneWhenNonBlank), whichever way it went.
  // CreationDate stands in for a due date (dueDateIsAge: overdue = open longer than
  // thresholds.checklistSlaDays, 10). InspectionLotType is a raw 2-digit code here, matching the
  // real API - it has no text lookup, unlike the old custom CDS view's friendly category names.
  const checklist = [
    ['A1', -25, '01'],
    ['A1', -20, '04'],
    ['A2', -18, '08'],
    ['', -15, '08'], // open 15d > SLA -> overdue
    ['', -14, '04'], // overdue
    ['', -3, '01'], // within SLA -> open
    ['', -1, '08'], // open
    ['A1', -8, '01'],
    ['', -12, '08'], // overdue
    ['A1', -6, '04'],
    ['', -2, '01'], // open
    ['A2', -22, '08'],
  ].map(([status, off, category], i) => ({
    id: `${10000231 + i}`, status, dueDate: d(off), category,
  }));

  const unposted = [
    ['1900004411', 'SA', -8, '12500.00', 'JCHEN', 'Rent accrual correction'],
    ['1900004418', 'KR', -2, '3890.50', 'SRAO', 'Vendor invoice – logistics'],
    ['1900004420', 'SA', -1, '48210.00', 'LGARCIA', 'Payroll reclass'],
    ['5100001022', 'KR', -6, '1120.00', 'SRAO', 'Office supplies'],
    ['1900004425', 'SA', 0, '760.25', 'AMEYER', 'Bank charges'],
  ].map(([id, type, off, amount, createdBy, text]) => ({
    id, type, postingDate: d(off), amount, currency: 'EUR', createdBy, text,
  }));

  // Shaped like the standard API_OPLACCTGDOCITEMCUBE_SRV data this now reads (see
  // config.sources.grir): one row per accounting document line item, not a pre-aggregated PO-item
  // balance - a goods receipt posts credit (H, negative) to the GR/IR account, an invoice receipt
  // posts debit (S, positive); groupByPoItem sums these per PO item (aggregateGrirLineItems).
  const grirLines = [
    ['4500017701', '10', 'Nordic Steel AB', 'GR', '84000.00', -95],
    ['4500017755', '20', 'Contoso Logistics', 'GR', '15200.00', -47],
    ['4500017755', '20', 'Contoso Logistics', 'IR', '12800.00', -47],
    ['4500017790', '10', 'Fabrikam Components', 'IR', '9650.00', -62],
    ['4500017812', '30', 'Tailspin Packaging', 'GR', '4300.00', -12],
    ['4500017812', '30', 'Tailspin Packaging', 'IR', '4300.00', -12],
    ['4500017820', '10', 'Litware Chemicals', 'GR', '22750.00', -33],
    ['4500017820', '10', 'Litware Chemicals', 'IR', '18000.00', -33],
    ['4500017833', '10', 'Northwind Traders', 'GR', '640.00', -8],
    ['4500017851', '20', 'Adatum Electronics', 'GR', '31000.00', -18],
  ].map(([poNumber, poItem, supplier, side, amount, off]) => ({
    poNumber, poItem, supplier, currency: 'EUR', postingDate: d(off),
    debitCredit: side === 'GR' ? 'H' : 'S',
    amount: side === 'GR' ? String(-Number(amount)) : amount,
  }));

  const accruals = [
    ['ACR-0001', 'Audit fees', 'CC1000', '18000.00', '18000.00', -1],
    ['ACR-0002', 'Utilities', 'CC2100', '6400.00', '0.00', -1],
    ['ACR-0003', 'Consulting – ERP rollout', 'CC4200', '42000.00', '36500.00', 0],
    ['ACR-0004', 'Bonus provision', 'CC1000', '95000.00', '0.00', 2],
    ['ACR-0005', 'Freight not yet invoiced', 'CC3300', '7800.00', '7650.00', 0],
    ['ACR-0006', 'Software subscriptions', 'CC2100', '3200.00', '0.00', 1],
  ].map(([id, description, costCenter, expectedAmount, postedAmount, off]) => ({
    id, description, costCenter, expectedAmount, postedAmount, currency: 'EUR', dueDate: d(off),
  }));

  return {
    checklist: toSap(checklist, s.checklist.fields),
    unposted: toSap(unposted, s.unposted.fields),
    grir: toSap(grirLines, s.grir.lineItemFields),
    accruals: toSap(accruals, s.accruals.fields),
  };
}
