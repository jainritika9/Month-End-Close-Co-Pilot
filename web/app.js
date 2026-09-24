// Web version of the dashboard page (served by web/server.mjs). Same markup and rendering as the
// Chrome extension; data comes from the local server's /api instead of chrome.* APIs.

import { setSnapshot, closeDrawer } from '/src/dashboard/render.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// Extension-only controls have no meaning here.
$('openSettings').hidden = true;
$('loginOAuth').hidden = true;

function showBanner(message) {
  $('banner').hidden = !message;
  $('banner').textContent = message ?? '';
}

function showLogin(state, error) {
  $('content').hidden = true;
  $('login').hidden = false;
  $('loginBasic').hidden = false;
  $('refreshAll').hidden = true;
  $('signOut').hidden = true;
  $('loginTarget').textContent = `${state.system} · client ${state.client}`;
  $('loginError').hidden = !error;
  $('loginError').textContent = error ?? '';
}

function hideLogin(state, user) {
  $('login').hidden = true;
  $('refreshAll').hidden = false;
  $('signOut').hidden = state.demo;
  $('sessionInfo').textContent = state.demo ? '' : `Signed in${user ? ` as ${user}` : ''}`;
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
    load(false);
  });
  document.querySelector('.actions').prepend(form);
}

let appState;

async function load(refresh) {
  const buttons = [...document.querySelectorAll('[data-refresh], #refreshAll')];
  buttons.forEach((b) => (b.disabled = true));
  showBanner(null);
  const q = new URLSearchParams(params);
  if (refresh) q.set('refresh', '1');
  try {
    const res = await fetch(`/api/snapshot?${q}`);
    const body = await res.json();
    if (res.status === 401) return showLogin(appState, body.error);
    if (!res.ok) throw new Error(body.error);
    const c = body.context;
    $('period').textContent = `Company code ${c.companyCode} · Period ${c.period}/${c.fiscalYear}`;
    setSnapshot(body);
  } catch (e) {
    showBanner(`Could not load data: ${e.message}`);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$('refreshAll').addEventListener('click', () => load(true));
// Per-card refresh buttons reload everything: the server fetches all sources in parallel anyway.
document.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', () => load(true)));
$('drawerClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

$('loginBasic').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('basicUser').value.trim();
  const password = $('basicPassword').value;
  $('basicPassword').value = '';
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });
  const body = await res.json();
  if (!res.ok) return showLogin(appState, body.error);
  appState = body;
  hideLogin(appState, user);
  load(true);
});

$('signOut').addEventListener('click', async () => {
  appState = await (await fetch('/api/logout', { method: 'POST' })).json();
  setSnapshot(null);
  showLogin(appState);
});

async function init() {
  appState = await (await fetch('/api/state')).json();
  const d = appState.defaults;
  $('period').textContent = `Company code ${d.companyCode} · Period ${d.period}/${d.fiscalYear}`;
  periodControls(d);
  if (!appState.signedIn) return showLogin(appState);
  hideLogin(appState);
  load(false);
}

init();
