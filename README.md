# Month-End Close Co-Pilot (Chrome extension)

This is an implementation of [strategy.txt](strategy.txt). It is a Manifest V3 browser extension that signs in to SAP, calls OData APIs straight from the browser and shows a daily close dashboard. The dashboard covers:

- **Close checklist status**: completion %, overdue and failed tasks
- **Unposted/parked documents**: amounts and how long they've been waiting
- **Open GR/IR items**: GR vs IR difference and aging buckets, with items that need clearing flagged
- **Missing accruals**: planned vs posted amounts, with missing, variance and overdue items flagged

It also has an exceptions list, KPI tiles, charts, filters, a drill-down drawer that shows the raw SAP fields, per-section refresh, background sync, a toolbar badge and desktop notifications.

## Try it (demo mode)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Click the toolbar icon. The dashboard opens with built-in sample data.

## Connect to SAP

Open **Settings** (on the dashboard, or via right-click on the icon → Options):

1. Untick **Demo mode**. Set the base URL, `sap-client`, company code and fiscal year start month.
2. Pick an authentication method:
   - **OAuth 2.0 (recommended)**: authorization code with PKCE, through `chrome.identity.launchWebAuthFlow`. Register the redirect URI shown on the settings page on your OAuth client (SOAUTH2 on-premise, or BTP / Communication Arrangement in the cloud). No client secret is needed or stored.
   - **Basic**: for on-premise Gateway. The user enters their user name and password on the dashboard. The password is used only to build an in-memory session.
3. Under **Data sources**, point each section at an OData entity set and map its fields. The default `ZFI_*` paths are **placeholders**. Replace them with the standard APIs or custom CDS/OData services in your system. Filters can use `{fiscalYear}`, `{period}` and `{companyCode}`. OData v2 (`d.results`, `__next`) and v4 (`value`, `@odata.nextLink`) are both supported, including paging.
4. Click **Refresh all** on the dashboard. Chrome asks you once to grant access to the SAP host. The extension requests host access only for the host you configured.

You can use **Export/Import JSON** to share one configuration across a team without secrets. The export strips secrets.

## Security design (strategy §5)

| Concern | How it's handled |
|---|---|
| Credential storage | Nothing sensitive goes to disk. Tokens and Basic headers live in `chrome.storage.session`, which is memory-only, cleared when the browser closes and not readable by content scripts. `saveConfig`/export strip any password or secret fields. |
| Token lifetime | OAuth tokens are refreshed shortly before they expire. Basic sessions are capped at 8 hours. Any `401` signs the user out and asks them to sign in again. |
| Scope | You configure the OAuth scope. Use a dedicated, read-only scope. |
| CORS | Extension pages that have host permission aren't subject to CORS, so no server-side change is needed. An optional **Proxy URL** covers networks where the SAP host can't be reached directly. |
| Financial data at rest | Snapshots are kept in session storage only. |
| Code injection | The CSP allows only bundled scripts, and all SAP values are rendered through `textContent`, never `innerHTML`. |
| Least privilege | Host access is optional and requested at runtime, and there are no content scripts. |

## Project layout

```
manifest.json              MV3 manifest
config/default-config.json default settings, OData paths and field mappings (no secrets)
src/background.js          scheduled sync (chrome.alarms), badge, notifications
src/lib/config.js          config load/merge/save, fiscal period helpers
src/lib/auth.js            OAuth2 + PKCE and Basic auth, session-only token storage
src/lib/sapClient.js       OData v2/v4 client with paging, timeouts and error handling
src/lib/processing.js      normalisation, analysis and alert rules (pure functions, unit-tested)
src/lib/mockData.js        demo data in raw SAP shape
src/lib/sync.js            full or per-section sync that stores the snapshot
src/lib/charts.js          dependency-free SVG donut and bar charts
src/dashboard/             dashboard UI
src/options/               settings UI
tests/                     node:test unit tests (npm test)
tools/make-icons.mjs       regenerates the icons
```

**Why no Chart.js/D3:** Manifest V3 doesn't allow remotely hosted scripts, and vendoring a library would add a build step. The dashboard only needs donuts and bars, so `charts.js` draws them as themed SVG (light and dark) in about 100 lines. If you need richer charts later, you can put a copy of `chart.umd.min.js` in the extension folder and import it.

## Development

```
npm test          # runs the unit tests (Node 18+)
npm run icons     # regenerates the PNG icons
```

After editing, click the reload icon on the extension card in `chrome://extensions`.

## Moving to a backend later (strategy §6)

All SAP access goes through `sapClient.fetchSource()`, and the data rules are pure functions in `processing.js`. To move to SAP BTP or a backend, either set **Proxy URL** to a service that returns the same OData shape, or move `processing.js` to the server unchanged and have `sync.js` fetch the processed snapshot.
