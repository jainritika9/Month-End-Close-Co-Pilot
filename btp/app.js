// Entry point for the SAP BTP build (see btp/README.md). Same page and rendering as the localhost
// dashboard. Data is read from the OData services through the approuter, so there is no sign-in
// form here: the BTP sign-in happens before this page loads.

import { setSnapshot, closeDrawer, setPlantHandler } from '../src/dashboard/render.js';
import { periodVars } from '../src/lib/config.js';
import { getBrowserSnapshot } from './browser-snapshot.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// The approuter handles sign-in, so the localhost sign-in form and sign-out controls stay hidden.
for (const id of ['login', 'signOut', 'sessionInfo']) $(id).hidden = true;

function showBanner(message) {
  $('banner').hidden = !message;
  $('banner').textContent = message ?? '';
}

/** Company code / fiscal year / period selectors, kept in the URL so the page can be bookmarked. */
function periodControls(defaults) {
  const form = document.createElement('form');
  form.className = 'period-form';
  const field = (name, label, value, width) => {
    const input = document.createElement('input');
    input.name = name;
    input.value = params.get(name) || value;
    input.setAttribute('aria-label', label);
    input.title = label;
    input.style.width = width;
    return input;
  };
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn';
  submit.textContent = 'Go';
  form.append(
    field('company_code', 'Company code', defaults.companyCode, '5.5em'),
    field('period', 'Period', defaults.period, '3.5em'),
    field('fiscal_year', 'Fiscal year', defaults.fiscalYear, '4.5em'),
    submit,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const input of form.elements) if (input.name) params.set(input.name, input.value.trim());
    history.replaceState(null, '', `?${params}`);
    load();
  });
  document.querySelector('.actions').prepend(form);
}

let config;

async function load() {
  const buttons = [...document.querySelectorAll('[data-refresh], #refreshAll')];
  buttons.forEach((b) => (b.disabled = true));
  showBanner(null);
  try {
    const snapshot = await getBrowserSnapshot(config, {
      origin: location.origin,
      companyCode: params.get('company_code') || undefined,
      fiscalYear: params.get('fiscal_year') || undefined,
      period: params.get('period') || undefined,
      // has(), not ||: an explicitly empty plant means "clear it", not "unset".
      plant: params.has('plant') ? params.get('plant') : undefined,
    });
    const c = snapshot.context;
    $('period').textContent = `Company code ${c.companyCode} · Period ${c.period}/${c.fiscalYear}`;
    setSnapshot(snapshot);
  } catch (e) {
    showBanner(`Could not load data: ${e.message}`);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// The production-order tab's plant selector: persist it in the URL like the other period controls,
// then reload that data.
setPlantHandler((tab, plant) => {
  if (plant) params.set('plant', plant);
  else params.delete('plant');
  history.replaceState(null, '', `?${params}`);
  load();
});

$('refreshAll').addEventListener('click', () => load());
// Per-card refresh buttons reload everything: the sources are fetched in parallel anyway.
document.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', () => load()));
$('drawerClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

async function init() {
  try {
    config = await (await fetch(new URL('../config/default-config.json', import.meta.url))).json();
  } catch (e) {
    showBanner(`Could not load the dashboard settings: ${e.message}`);
    return;
  }
  const d = periodVars(config);
  $('period').textContent = `Company code ${d.companyCode} · Period ${d.period}/${d.fiscalYear}`;
  periodControls(d);
  load();
}

init();
