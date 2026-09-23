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

  const checklist = [
    ['Open new posting period', 'A. Meyer', 'COMPLETED', -6, 'Preparation'],
    ['Run foreign currency valuation', 'J. Chen', 'COMPLETED', -3, 'Valuation'],
    ['Post depreciation run', 'J. Chen', 'COMPLETED', -2, 'Assets'],
    ['Settle internal orders', 'P. Novak', 'ERROR', -1, 'Controlling'],
    ['GR/IR clearing and reclassification', 'S. Rao', 'IN_PROCESS', -1, 'Payables'],
    ['Post payroll accruals', 'L. Garcia', 'IN_PROCESS', 0, 'Accruals'],
    ['Intercompany reconciliation', 'M. Okafor', 'NOT_STARTED', 1, 'Intercompany'],
    ['Bank reconciliation', 'A. Meyer', 'COMPLETED', -1, 'Cash'],
    ['Run cost allocations', 'P. Novak', 'NOT_STARTED', 2, 'Controlling'],
    ['Close MM period', 'S. Rao', 'COMPLETED', -4, 'Preparation'],
    ['Review balance sheet reconciliations', 'L. Garcia', 'NOT_STARTED', 3, 'Review'],
    ['Lock posting period', 'A. Meyer', 'NOT_STARTED', 4, 'Closing'],
  ].map(([name, owner, status, due, category], i) => ({
    id: `T${String(i + 1).padStart(3, '0')}`, name, owner, status, dueDate: d(due), category,
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

  const grir = [
    ['4500017701', '10', 'Nordic Steel AB', '84000.00', '0.00', -95],
    ['4500017755', '20', 'Contoso Logistics', '15200.00', '12800.00', -47],
    ['4500017790', '10', 'Fabrikam Components', '0.00', '9650.00', -62],
    ['4500017812', '30', 'Tailspin Packaging', '4300.00', '4300.00', -12],
    ['4500017820', '10', 'Litware Chemicals', '22750.00', '18000.00', -33],
    ['4500017833', '10', 'Northwind Traders', '640.00', '0.00', -8],
    ['4500017851', '20', 'Adatum Electronics', '31000.00', '0.00', -18],
  ].map(([id, item, supplier, grAmount, irAmount, off]) => ({
    id, item, supplier, irAmount, currency: 'EUR', lastMovementDate: d(off),
    // Mirror the live service: GR arrives as a (negative) credit when signedAmounts is set.
    grAmount: s.grir.signedAmounts ? String(-Number(grAmount)) : grAmount,
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
    grir: toSap(grir, s.grir.fields),
    accruals: toSap(accruals, s.accruals.fields),
  };
}
