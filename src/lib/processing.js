// Pure data processing: normalises raw OData rows using the configured field mappings and derives
// the dashboard summary and alerts. No chrome.* APIs here so it can be unit-tested in Node.

const DAY_MS = 24 * 3600 * 1000;

/** Parses OData v2 "/Date(ms)/", ISO strings and yyyymmdd; returns a Date or null. */
export function parseSapDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  const s = String(value);
  const legacy = s.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (legacy) return new Date(Number(legacy[1]));
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Whole days from `date` to `today` (positive when `date` is in the past). */
export function daysBetween(date, today) {
  if (!date) return null;
  const utc = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((utc(today) - utc(date)) / DAY_MS);
}

/**
 * Maps SAP field names to internal names as configured in `fields` ({ internal: sapField }).
 * Trims string values: ABAP CHAR fields (e.g. a blank one cast to abap.char(40)) arrive over
 * OData space-padded to their full length, not as '' - without trimming, a blank field reads as
 * truthy and "empty" checks like `value || fallback` silently fail.
 */
export function normalize(rows, fields) {
  return rows.map((row) => {
    const out = { _raw: row };
    for (const [key, sapField] of Object.entries(fields)) {
      const v = row[sapField];
      out[key] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  });
}

function mainCurrency(items) {
  const counts = {};
  for (const i of items) if (i.currency) counts[i.currency] = (counts[i.currency] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// ---------- Per-source analysis ----------

export function analyzeChecklist(rows, source, today, thresholds = {}) {
  const done = new Set((source.statusValues?.done ?? []).map((s) => s.toUpperCase()));
  const error = new Set((source.statusValues?.error ?? []).map((s) => s.toUpperCase()));
  const slaDays = thresholds.checklistSlaDays ?? 0;
  const tasks = normalize(rows, source.fields).map((t) => {
    const status = String(t.status ?? '').toUpperCase();
    const dueDate = parseSapDate(t.dueDate);
    // Some sources have no fixed set of "done" codes - e.g. API_INSPECTIONLOT_SRV's Usage
    // Decision code is whatever a client's own UD catalog defines, so "any code present" means
    // done, not one of a known list.
    const isDone = source.statusMeansDoneWhenNonBlank ? status !== '' : done.has(status);
    let state = 'open';
    if (isDone) state = 'done';
    else if (error.has(status)) state = 'error';
    else if (dueDate) {
      // Some sources (e.g. EAM inspection lots) have no real due date; dueDateIsAge means the
      // date is really "created on", so overdue = open longer than the SLA, not "past a due date".
      const overdue = source.dueDateIsAge ? daysBetween(dueDate, today) > slaDays : daysBetween(dueDate, today) > 0;
      if (overdue) state = 'overdue';
    }
    // Some sources have no free-text name/title field to display, only an id.
    const name = source.nameFromId ? `Inspection lot ${t.id}` : t.name;
    return { ...t, name, dueDate, state };
  });
  const count = (s) => tasks.filter((t) => t.state === s).length;
  const total = tasks.length;
  return {
    items: tasks,
    total,
    done: count('done'),
    open: count('open'),
    overdue: count('overdue'),
    error: count('error'),
    completionPct: total ? Math.round((count('done') / total) * 100) : 0,
    // Lets the dashboard label the date column "Created" instead of "Due" for sources where
    // dueDate really means "created on" (see the comment above).
    dueDateIsAge: !!source.dueDateIsAge,
  };
}

export function analyzeUnposted(rows, source, thresholds, today) {
  const items = normalize(rows, source.fields)
    .map((d) => {
      const postingDate = parseSapDate(d.postingDate);
      return { ...d, amount: parseAmount(d.amount), postingDate, ageDays: daysBetween(postingDate, today) };
    })
    .filter((d) => Math.abs(d.amount) >= (thresholds.unpostedMinAmount ?? 0))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return {
    items,
    count: items.length,
    totalAmount: items.reduce((s, d) => s + Math.abs(d.amount), 0),
    currency: mainCurrency(items),
  };
}

export const GRIR_BUCKETS = ['0-30', '31-60', '61-90', '90+'];

function agingBucket(days) {
  if (days === null || days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function analyzeGrir(rows, source, thresholds, today) {
  // signedAmounts: the service returns amounts as posted on the GR/IR account (GR = credit,
  // negative), so flip GR to get a positive "goods received" value.
  const grSign = source.signedAmounts ? -1 : 1;
  const items = normalize(rows, source.fields)
    .map((g) => {
      const grAmount = grSign * parseAmount(g.grAmount);
      const irAmount = parseAmount(g.irAmount);
      const lastMovementDate = parseSapDate(g.lastMovementDate);
      const ageDays = daysBetween(lastMovementDate, today);
      const difference = grAmount - irAmount;
      const flagged =
        Math.abs(difference) >= (thresholds.grirMinDifference ?? 0) && (ageDays ?? 0) >= (thresholds.grirAgingDays ?? 0);
      return { ...g, grAmount, irAmount, difference, lastMovementDate, ageDays, bucket: agingBucket(ageDays), flagged };
    })
    .filter((g) => g.difference !== 0)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  const buckets = Object.fromEntries(GRIR_BUCKETS.map((b) => [b, 0]));
  for (const g of items) buckets[g.bucket] += Math.abs(g.difference);

  return {
    items,
    count: items.length,
    flaggedCount: items.filter((g) => g.flagged).length,
    netDifference: items.reduce((s, g) => s + g.difference, 0),
    grossDifference: items.reduce((s, g) => s + Math.abs(g.difference), 0),
    buckets,
    currency: mainCurrency(items),
  };
}

export function analyzeAccruals(rows, source, thresholds, today) {
  const tol = (thresholds.accrualTolerancePct ?? 0) / 100;
  const items = normalize(rows, source.fields).map((a) => {
    const expectedAmount = parseAmount(a.expectedAmount);
    const postedAmount = parseAmount(a.postedAmount);
    const dueDate = parseSapDate(a.dueDate);
    const gap = expectedAmount - postedAmount;
    let state = 'ok';
    if (postedAmount === 0 && expectedAmount !== 0) state = 'missing';
    else if (expectedAmount !== 0 && Math.abs(gap) / Math.abs(expectedAmount) > tol) state = 'variance';
    const overdue = state !== 'ok' && dueDate !== null && daysBetween(dueDate, today) > 0;
    return { ...a, expectedAmount, postedAmount, gap, dueDate, state, overdue };
  });
  const missing = items.filter((a) => a.state === 'missing');
  return {
    items,
    total: items.length,
    missingCount: missing.length,
    varianceCount: items.filter((a) => a.state === 'variance').length,
    missingAmount: missing.reduce((s, a) => s + Math.abs(a.expectedAmount), 0),
    currency: mainCurrency(items),
  };
}

// ---------- Alerts ----------

export function buildAlerts(summary, thresholds) {
  const alerts = [];
  const { checklist, unposted, grir, accruals } = summary;

  if (checklist) {
    // Counts only, deliberately - a real close can have hundreds of open items (e.g. an old,
    // never-closed batch of EAM inspection lots), and naming them all here would make this list
    // unreadable. Open the checklist card and filter by state to see which ones.
    if (checklist.error) {
      alerts.push({ severity: 'high', category: 'checklist', title: `${checklist.error} close task(s) failed`,
        detail: 'Open the checklist and filter by Error to see which ones.' });
    }
    if (checklist.overdue) {
      const detail = checklist.dueDateIsAge
        ? `Open longer than ${thresholds.checklistSlaDays ?? 0} days`
        : 'Past their due date';
      alerts.push({ severity: 'high', category: 'checklist', title: `${checklist.overdue} close task(s) overdue`, detail });
    }
  }
  if (unposted?.count) {
    const old = unposted.items.filter((d) => (d.ageDays ?? 0) > 5).length;
    alerts.push({ severity: old ? 'medium' : 'low', category: 'unposted',
      title: `${unposted.count} unposted document(s) pending`,
      detail: old ? `${old} parked for more than 5 days` : 'All parked within the last 5 days' });
  }
  if (grir?.flaggedCount) {
    alerts.push({ severity: 'medium', category: 'grir',
      title: `${grir.flaggedCount} GR/IR item(s) need clearing`,
      detail: `Difference ≥ ${thresholds.grirMinDifference} and no movement for ≥ ${thresholds.grirAgingDays} days` });
  }
  if (accruals?.missingCount) {
    const overdue = accruals.items.filter((a) => a.state === 'missing' && a.overdue).length;
    alerts.push({ severity: overdue ? 'high' : 'medium', category: 'accruals',
      title: `${accruals.missingCount} accrual(s) not posted`,
      detail: overdue ? `${overdue} past their posting due date` : 'Not yet due' });
  }
  if (accruals?.varianceCount) {
    alerts.push({ severity: 'low', category: 'accruals',
      title: `${accruals.varianceCount} accrual(s) posted with a variance`,
      detail: `Posted amount differs from plan by more than ${thresholds.accrualTolerancePct}%` });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Builds the full dashboard snapshot. `raw` holds rows per source; a source whose value is an
 * Error is reported under `errors` instead of failing the whole sync.
 */
export function buildSnapshot(raw, config, today = new Date()) {
  const { sources, thresholds } = config;
  const summary = {};
  const errors = {};
  const run = (key, fn) => {
    if (raw[key] instanceof Error) errors[key] = raw[key].message;
    else if (raw[key]) summary[key] = fn(raw[key]);
  };
  run('checklist', (r) => analyzeChecklist(r, sources.checklist, today, thresholds));
  run('unposted', (r) => analyzeUnposted(r, sources.unposted, thresholds, today));
  run('grir', (r) => analyzeGrir(r, sources.grir, thresholds, today));
  run('accruals', (r) => analyzeAccruals(r, sources.accruals, thresholds, today));

  return { syncedAt: today.toISOString(), summary, errors, alerts: buildAlerts(summary, thresholds) };
}
