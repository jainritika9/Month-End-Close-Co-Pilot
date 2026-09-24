// Dashboard rendering shared by the Chrome extension (dashboard.js) and the local web dashboard
// (web/app.js). Pure DOM work on a snapshot; how the snapshot is obtained is up to the caller.

import { GRIR_BUCKETS } from '../lib/processing.js';
import { donut, hbars, progress } from '../lib/charts.js';

const $ = (id) => document.getElementById(id);

const COLORS = {
  done: 'var(--ok)', open: 'var(--info)', overdue: 'var(--warn)', error: 'var(--bad)',
  missing: 'var(--bad)', variance: 'var(--warn)', ok: 'var(--ok)',
};

// Per-card filter state, so re-renders keep the user's selection.
const filters = { checklist: 'all', grir: 'all', accruals: 'all' };

let snapshot;

// ---------- Formatting ----------

function money(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString()} ${currency ?? ''}`.trim();
  }
}

function date(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function pill(text, kind) {
  const span = document.createElement('span');
  span.className = `pill pill-${kind}`;
  span.textContent = text;
  return span;
}

// ---------- Generic table / drawer ----------

/** columns: [{ label, value(row) → string|Node, num? }] */
function table(columns, rows, { onRow, rowClass } = {}) {
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing to show.';
    return p;
  }
  const t = document.createElement('table');
  const head = t.createTHead().insertRow();
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.num) th.className = 'num';
    head.appendChild(th);
  }
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    if (rowClass) tr.className = rowClass(row) ?? '';
    for (const c of columns) {
      const td = tr.insertCell();
      if (c.num) td.className = 'num';
      const v = c.value(row);
      td.append(v instanceof Node ? v : String(v ?? '—'));
    }
    if (onRow) {
      tr.tabIndex = 0;
      tr.addEventListener('click', () => onRow(row));
      tr.addEventListener('keydown', (e) => e.key === 'Enter' && onRow(row));
    }
  }
  return t;
}

function openDrawer(title, fields, raw) {
  $('drawerTitle').textContent = title;
  const body = $('drawerBody');
  body.replaceChildren();
  const addList = (heading, obj) => {
    const h = document.createElement('h3');
    h.textContent = heading;
    const dl = document.createElement('dl');
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !(v instanceof Node)) continue; // skip nested OData metadata
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.append(v instanceof Node ? v : String(v ?? '—'));
      dl.append(dt, dd);
    }
    body.append(h, dl);
  };
  addList('Summary', fields);
  if (raw) addList('SAP fields', raw);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
}

export function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
}

function filterBar(card, key, options) {
  const bar = card.querySelector('.filters');
  bar.replaceChildren();
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'tab';
    b.textContent = label;
    b.setAttribute('aria-selected', String(filters[key] === value));
    b.addEventListener('click', () => {
      filters[key] = value;
      render();
    });
    bar.appendChild(b);
  }
}

function setFilter(key, value) {
  filters[key] = value;
  render();
  $(`card-${key}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Section renderers ----------

function renderChecklist(card, c) {
  const segments = [
    { label: 'Done', value: c.done, color: COLORS.done },
    { label: 'Open', value: c.open, color: COLORS.open },
    { label: 'Overdue', value: c.overdue, color: COLORS.overdue },
    { label: 'Error', value: c.error, color: COLORS.error },
  ];
  card.querySelector('.chart-slot').replaceChildren(
    donut(segments, { centerLabel: `${c.completionPct}%`, centerSub: `${c.done} of ${c.total} done`, onSelect: (l) => setFilter('checklist', l.toLowerCase()) }),
  );
  filterBar(card, 'checklist', [['all', `All (${c.total})`], ['open', 'Open'], ['overdue', 'Overdue'], ['error', 'Error'], ['done', 'Done']]);
  const rows = c.items.filter((t) => filters.checklist === 'all' || t.state === filters.checklist);
  card.querySelector('.table-slot').replaceChildren(
    table(
      [
        { label: 'Task', value: (t) => t.name },
        { label: 'Owner', value: (t) => t.owner },
        { label: 'Due', value: (t) => date(t.dueDate) },
        { label: 'Status', value: (t) => pill(t.state, t.state) },
      ],
      rows,
      {
        onRow: (t) => openDrawer(t.name, {
          Task: t.id, Category: t.category, Owner: t.owner, 'Due date': date(t.dueDate),
          'SAP status': t.status, State: pill(t.state, t.state),
        }, t._raw),
      },
    ),
  );
}

function renderUnposted(card, u) {
  const byAge = [
    ['≤ 2 days', (d) => (d.ageDays ?? 0) <= 2],
    ['3–5 days', (d) => d.ageDays > 2 && d.ageDays <= 5],
    ['> 5 days', (d) => d.ageDays > 5],
  ].map(([label, fn], i) => {
    const items = u.items.filter(fn);
    const value = items.reduce((s, d) => s + Math.abs(d.amount), 0);
    return { label, value, display: `${money(value, u.currency)} · ${items.length}`, color: ['var(--info)', 'var(--warn)', 'var(--bad)'][i] };
  });
  card.querySelector('.chart-slot').replaceChildren(hbars(byAge));
  card.querySelector('.table-slot').replaceChildren(
    table(
      [
        { label: 'Document', value: (d) => d.id },
        { label: 'Type', value: (d) => d.type },
        { label: 'Posting date', value: (d) => date(d.postingDate) },
        { label: 'Age (d)', value: (d) => d.ageDays, num: true },
        { label: 'Amount', value: (d) => money(d.amount, d.currency), num: true },
        { label: 'Created by', value: (d) => d.createdBy },
      ],
      u.items,
      {
        rowClass: (d) => (d.ageDays > 5 ? 'flagged' : ''),
        onRow: (d) => openDrawer(`Document ${d.id}`, {
          Type: d.type, Text: d.text, 'Posting date': date(d.postingDate), 'Age (days)': d.ageDays,
          Amount: money(d.amount, d.currency), 'Created by': d.createdBy,
        }, d._raw),
      },
    ),
  );
}

function renderGrir(card, g) {
  const colors = ['var(--info)', 'var(--warn)', 'var(--bad)', 'var(--bad)'];
  const bars = GRIR_BUCKETS.map((b, i) => ({ label: `${b} days`, value: g.buckets[b], display: money(g.buckets[b], g.currency), color: colors[i] }));
  card.querySelector('.chart-slot').replaceChildren(hbars(bars, { onSelect: (l) => setFilter('grir', l.replace(' days', '')) }));
  filterBar(card, 'grir', [['all', `All (${g.count})`], ['flagged', `Needs clearing (${g.flaggedCount})`], ...GRIR_BUCKETS.map((b) => [b, `${b} d`])]);
  const rows = g.items.filter((i) => filters.grir === 'all' || (filters.grir === 'flagged' ? i.flagged : i.bucket === filters.grir));
  card.querySelector('.table-slot').replaceChildren(
    table(
      [
        { label: 'PO / item', value: (i) => `${i.id} / ${i.item}` },
        { label: 'Supplier', value: (i) => i.supplier },
        { label: 'GR', value: (i) => money(i.grAmount, i.currency), num: true },
        { label: 'IR', value: (i) => money(i.irAmount, i.currency), num: true },
        { label: 'Difference', value: (i) => money(i.difference, i.currency), num: true },
        { label: 'Age (d)', value: (i) => i.ageDays, num: true },
      ],
      rows,
      {
        rowClass: (i) => (i.flagged ? 'flagged' : ''),
        onRow: (i) => openDrawer(`PO ${i.id} / ${i.item}`, {
          Supplier: i.supplier, 'Goods receipt': money(i.grAmount, i.currency), 'Invoice receipt': money(i.irAmount, i.currency),
          Difference: money(i.difference, i.currency),
          Direction: i.difference > 0 ? 'Goods received, not invoiced' : 'Invoiced, goods not received',
          'Last movement': date(i.lastMovementDate), 'Age (days)': i.ageDays,
          'Needs clearing': i.flagged ? pill('yes', 'medium') : 'no',
        }, i._raw),
      },
    ),
  );
}

function renderAccruals(card, a) {
  const count = (s) => a.items.filter((i) => i.state === s).length;
  card.querySelector('.chart-slot').replaceChildren(
    donut(
      [
        { label: 'Posted', value: count('ok'), color: COLORS.ok },
        { label: 'Variance', value: count('variance'), color: COLORS.variance },
        { label: 'Missing', value: count('missing'), color: COLORS.missing },
      ],
      {
        centerLabel: String(a.missingCount), centerSub: 'not posted',
        onSelect: (l) => setFilter('accruals', l === 'Posted' ? 'ok' : l.toLowerCase()),
      },
    ),
  );
  filterBar(card, 'accruals', [['all', `All (${a.total})`], ['missing', 'Missing'], ['variance', 'Variance'], ['ok', 'Posted']]);
  const rows = a.items.filter((i) => filters.accruals === 'all' || i.state === filters.accruals);
  card.querySelector('.table-slot').replaceChildren(
    table(
      [
        { label: 'Accrual', value: (i) => i.description },
        { label: 'Cost center', value: (i) => i.costCenter },
        { label: 'Planned', value: (i) => money(i.expectedAmount, i.currency), num: true },
        { label: 'Posted', value: (i) => money(i.postedAmount, i.currency), num: true },
        { label: 'Due', value: (i) => date(i.dueDate) },
        { label: 'Status', value: (i) => pill(i.state === 'ok' ? 'posted' : i.state, i.state) },
      ],
      rows,
      {
        rowClass: (i) => (i.overdue ? 'flagged' : ''),
        onRow: (i) => openDrawer(i.description, {
          'Accrual object': i.id, 'Cost center': i.costCenter,
          Planned: money(i.expectedAmount, i.currency), Posted: money(i.postedAmount, i.currency),
          Gap: money(i.gap, i.currency), 'Due date': date(i.dueDate),
          Status: pill(i.state === 'ok' ? 'posted' : i.state, i.state), Overdue: i.overdue ? 'yes' : 'no',
        }, i._raw),
      },
    ),
  );
}

const RENDERERS = { checklist: renderChecklist, unposted: renderUnposted, grir: renderGrir, accruals: renderAccruals };

function renderKpis(s) {
  const kpis = [];
  if (s.checklist) {
    const c = s.checklist;
    kpis.push({ key: 'checklist', label: 'Checklist complete', value: `${c.completionPct}%`,
      sub: `${c.overdue} overdue · ${c.error} failed`, status: c.error || c.overdue ? 'bad' : 'ok',
      extra: progress(c.completionPct, c.error ? 'var(--bad)' : 'var(--ok)') });
  }
  if (s.unposted) {
    kpis.push({ key: 'unposted', label: 'Unposted documents', value: s.unposted.count,
      sub: money(s.unposted.totalAmount, s.unposted.currency), status: s.unposted.count ? 'warn' : 'ok' });
  }
  if (s.grir) {
    kpis.push({ key: 'grir', label: 'GR/IR to clear', value: s.grir.flaggedCount,
      sub: `${money(s.grir.grossDifference, s.grir.currency)} open across ${s.grir.count} items`, status: s.grir.flaggedCount ? 'warn' : 'ok' });
  }
  if (s.accruals) {
    kpis.push({ key: 'accruals', label: 'Missing accruals', value: s.accruals.missingCount,
      sub: money(s.accruals.missingAmount, s.accruals.currency), status: s.accruals.missingCount ? 'bad' : 'ok' });
  }
  $('kpis').replaceChildren(
    ...kpis.map((k) => {
      const div = document.createElement('div');
      div.className = `card kpi status-${k.status}`;
      div.tabIndex = 0;
      for (const [cls, text] of [['label', k.label], ['value', k.value], ['sub', k.sub]]) {
        const p = document.createElement('div');
        p.className = cls;
        p.textContent = text;
        div.appendChild(p);
      }
      if (k.extra) div.appendChild(k.extra);
      div.addEventListener('click', () => $(`card-${k.key}`).scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return div;
    }),
  );
}

function renderAlerts(alerts) {
  const list = $('alertList');
  if (!alerts.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'No exceptions — everything is on track.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...alerts.map((a) => {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = a.title;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = a.detail;
      li.append(pill(a.severity, a.severity), title, detail);
      li.addEventListener('click', () => $(`card-${a.category}`).scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return li;
    }),
  );
}

export function render() {
  if (!snapshot) return;
  $('content').hidden = false;
  $('demoBadge').hidden = !snapshot.demo;
  $('syncedAt').textContent = `Synced ${new Date(snapshot.syncedAt).toLocaleString()}`;
  renderAlerts(snapshot.alerts);
  renderKpis(snapshot.summary);
  for (const [key, fn] of Object.entries(RENDERERS)) {
    const card = $(`card-${key}`);
    const err = card.querySelector('.card-error');
    err.hidden = !snapshot.errors?.[key];
    err.textContent = snapshot.errors?.[key] ? `Could not load: ${snapshot.errors[key]}` : '';
    if (snapshot.summary[key]) fn(card, snapshot.summary[key]);
    else {
      card.querySelector('.chart-slot').replaceChildren();
      card.querySelector('.table-slot').replaceChildren();
      card.querySelector('.filters')?.replaceChildren();
    }
  }
}

/** Replaces the snapshot being shown and re-renders (null clears it). */
export function setSnapshot(next) {
  snapshot = next;
  render();
}

export function getShownSnapshot() {
  return snapshot;
}
