import { getConfig, saveConfig, resetConfig, deepMerge, loadDefaults, stripSecrets } from '../lib/config.js';

const form = document.getElementById('settings');
const statusEl = document.getElementById('status');

function status(message, kind = 'ok') {
  statusEl.hidden = false;
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function set(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

function fill(config) {
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.name === 'sources') input.value = JSON.stringify(config.sources, null, 2);
    else if (input.type === 'checkbox') input.checked = !!get(config, input.name);
    else input.value = get(config, input.name) ?? '';
  }
  toggleAuth();
}

function read(base) {
  const config = structuredClone(base);
  for (const input of form.elements) {
    if (!input.name) continue;
    if (input.name === 'sources') config.sources = JSON.parse(input.value);
    else if (input.type === 'checkbox') set(config, input.name, input.checked);
    else if (input.type === 'number') set(config, input.name, input.value === '' ? null : Number(input.value));
    else set(config, input.name, input.value.trim());
  }
  return config;
}

function validateSources(sources) {
  for (const key of ['checklist', 'unposted', 'grir', 'accruals']) {
    const s = sources[key];
    if (!s?.path || typeof s.fields !== 'object') throw new Error(`Source "${key}" needs a "path" and a "fields" mapping`);
  }
}

function toggleAuth() {
  const method = form.elements['auth.method'].value;
  for (const fs of form.querySelectorAll('[data-auth]')) fs.hidden = fs.dataset.auth !== method;
}

let current;

async function load() {
  current = await getConfig();
  fill(current);
  document.getElementById('redirectUri').textContent = chrome.identity.getRedirectURL('sap');
}

form.addEventListener('change', (e) => e.target.name === 'auth.method' && toggleAuth());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const next = read(current);
    validateSources(next.sources);
    await saveConfig(next);
    current = next;
    status('Settings saved. Open dashboards will reload with the new configuration.');
  } catch (err) {
    status(err instanceof SyntaxError ? `Data sources is not valid JSON: ${err.message}` : err.message, 'bad');
  }
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset all settings to the bundled defaults?')) return;
  await resetConfig();
  await load();
  status('Settings reset to defaults.');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(stripSecrets(current), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'close-copilot-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const imported = deepMerge(await loadDefaults(), JSON.parse(await file.text()));
    validateSources(imported.sources);
    fill(imported);
    current = imported;
    status('Configuration imported. Review it and click Save to apply.');
  } catch (err) {
    status(`Import failed: ${err.message}`, 'bad');
  }
});

load();
