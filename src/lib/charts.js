// Minimal SVG charts (donut + horizontal bars). Manifest V3 forbids remotely hosted code, so rather
// than vendoring Chart.js/D3 these small helpers cover the dashboard's needs. Colours come from CSS
// custom properties so charts follow light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Donut chart. segments: [{ label, value, color }]. Returns a wrapper element with chart + legend.
 * onSelect(label) is called when a segment or legend entry is clicked.
 */
export function donut(segments, { centerLabel = '', centerSub = '', onSelect } = {}) {
  const size = 160;
  const r = 60;
  const stroke = 22;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);

  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart donut', role: 'img' });
  svg.appendChild(el('title', {}, segments.map((s) => `${s.label}: ${s.value}`).join(', ')));
  svg.appendChild(el('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': stroke }));

  let offset = 0;
  for (const seg of segments) {
    if (!seg.value) continue;
    const len = (seg.value / total) * circumference;
    const arc = el('circle', {
      cx: 80, cy: 80, r, fill: 'none', stroke: seg.color, 'stroke-width': stroke,
      'stroke-dasharray': `${len} ${circumference - len}`,
      'stroke-dashoffset': -offset,
      transform: 'rotate(-90 80 80)',
      class: onSelect ? 'clickable' : '',
    });
    arc.appendChild(el('title', {}, `${seg.label}: ${seg.value}`));
    if (onSelect) arc.addEventListener('click', () => onSelect(seg.label));
    svg.appendChild(arc);
    offset += len;
  }
  svg.appendChild(el('text', { x: 80, y: 80, 'text-anchor': 'middle', class: 'donut-center' }, centerLabel));
  svg.appendChild(el('text', { x: 80, y: 100, 'text-anchor': 'middle', class: 'donut-sub' }, centerSub));

  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  wrap.appendChild(svg);
  wrap.appendChild(legend(segments, onSelect));
  return wrap;
}

function legend(items, onSelect) {
  const ul = document.createElement('ul');
  ul.className = 'legend';
  for (const item of items) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = item.color;
    li.append(sw, `${item.label} `);
    const b = document.createElement('b');
    b.textContent = item.display ?? item.value;
    li.appendChild(b);
    if (onSelect) {
      li.classList.add('clickable');
      li.addEventListener('click', () => onSelect(item.label));
    }
    ul.appendChild(li);
  }
  return ul;
}

/** Horizontal bar chart. bars: [{ label, value, color, display }]. */
export function hbars(bars, { format = String, onSelect } = {}) {
  const rowH = 28;
  const labelW = 110;
  const valueW = 90;
  const width = 460;
  const plotW = width - labelW - valueW;
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const svg = el('svg', { viewBox: `0 0 ${width} ${bars.length * rowH + 4}`, class: 'chart hbars', role: 'img' });

  bars.forEach((b, i) => {
    const y = i * rowH + 4;
    const g = el('g', { class: onSelect ? 'clickable' : '' });
    g.appendChild(el('title', {}, `${b.label}: ${b.display ?? format(b.value)}`));
    g.appendChild(el('text', { x: labelW - 8, y: y + 15, 'text-anchor': 'end', class: 'bar-label' }, b.label));
    g.appendChild(el('rect', { x: labelW, y, width: plotW, height: 20, rx: 3, fill: 'var(--track)' }));
    g.appendChild(el('rect', {
      x: labelW, y, height: 20, rx: 3, fill: b.color ?? 'var(--accent)',
      width: Math.max(Math.abs(b.value) ? 2 : 0, (Math.abs(b.value) / max) * plotW),
    }));
    g.appendChild(el('text', { x: labelW + plotW + 8, y: y + 15, class: 'bar-value' }, b.display ?? format(b.value)));
    if (onSelect) g.addEventListener('click', () => onSelect(b.label));
    svg.appendChild(g);
  });
  return svg;
}

/** Thin progress bar element. */
export function progress(pct, color = 'var(--ok)') {
  const outer = document.createElement('div');
  outer.className = 'progress';
  const inner = document.createElement('div');
  inner.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  inner.style.background = color;
  outer.appendChild(inner);
  return outer;
}
