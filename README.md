# Month-End Close Co-Pilot (Chrome extension)

This is an implementation of [strategy.txt](strategy.txt). It is a Manifest V3 browser extension that signs in to SAP, calls OData APIs straight from the browser and shows a daily close dashboard. The dashboard covers:

- **Close checklist status**: completion % and overdue items, backed by real EAM inspection-lot data rather than a hand-maintained list — see [abap/README.md](abap/README.md#known-limits-and-design-decisions)
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

## Claude Code plugin

The same repository is also a Claude Code plugin, `close-copilot`. It lets you ask Claude about the close in plain language, e.g. "which GR/IR items over 90 days are with Nordic Steel?". Claude answers from live SAP data using the same OData services, analysis rules and thresholds as the dashboard.

**Install** (in Claude Code, from the folder that contains this repo, or with the full path):

```
/plugin marketplace add ./Agent
/plugin install close-copilot@mwc-finance
```

When you enable it, Claude Code asks for the plugin options: SAP base URL, client, company code, fiscal year, SAP user and password, and demo mode. The password is marked sensitive, so it goes to Claude Code's secure credential storage, not `settings.json`. To change the options later, run `/plugin`, pick close-copilot and choose configure. To reuse data-source paths or thresholds you changed in the Chrome extension, export them from its Settings page and set the export as the plugin's **Config file** option.

**Slash commands**

| Command | What it does |
|---|---|
| `/close-copilot:close-status [cc] [period]` | Overall status, what needs attention now, key numbers |
| `/close-copilot:grir-review [cc] [days] [supplier]` | Open GR/IR, grouped by "received, not invoiced" and "invoiced, not received", with actions |
| `/close-copilot:accrual-check [cc] [period]` | Missing and off-plan accruals, with draft postings to review |
| `/close-copilot:parked-docs [cc] [days] [amount]` | Parked documents per creator |
| `/close-copilot:close-report [cc] [period]` | Management-ready status report |

**MCP tools** (server `sap-close`, [mcp/server.mjs](mcp/server.mjs)). Claude also calls these directly when you ask a free-form question:

- `get_close_status`
- `list_checklist_tasks`
- `list_unposted_documents`
- `list_grir_items`
- `list_accruals`
- `test_sap_connection`

The server has no npm dependencies. It reads SAP with Basic authentication and caches each result for 2 minutes. The tools only read data; none of them post anything in SAP.

### Full dashboard at a localhost URL

This is the same dashboard as the Chrome extension, served as a normal web page from your PC. It has the KPI tiles, charts, filterable tables and drill-down, plus company code, period and year selectors in the header. There are 2 ways to start it:

- **In Claude Code:** run `/close-copilot:dashboard`, or `/dashboard` in this repo. Claude replies with a link like `http://localhost:8787/`. The page stays available while that Claude Code session is open.
- **Standalone:** run `npm run dashboard`, which also opens the browser. It uses the demo mode from `config/default-config.json`. For live SAP data, start it with `SAP_DEMO_MODE=false`; the page then shows an SAP sign-in form.

The server listens on `127.0.0.1` only, so no other computer can open it. The SAP password you enter stays in the server's memory and is never written to disk. SAP is read server-side, so the browser needs no extension and hits no CORS errors. The server is in [web/server.mjs](web/server.mjs). It shares all rendering code with the extension ([src/dashboard/render.js](src/dashboard/render.js)).

This only works in Claude Code **on your PC**. In a claude.ai/code web session, `localhost` is the cloud machine, which your browser can't open.

### Claude Code on the web (claude.ai/code)

Cloud sessions don't install plugins from your machine or from the repo's settings. Instead, the repository provides the same pieces directly, and a cloud session opened on this repo loads them automatically:

- [.mcp.json](.mcp.json) starts the `sap-close` server.
- [.claude/commands/](.claude/commands/) provides the commands without the plugin prefix: `/close-status`, `/grir-review`, `/accrual-check`, `/parked-docs` and `/close-report`.

The plugin and the web setup share these command files.

**Web sessions use demo data by default.** The SAP system resolves only on the corporate network (a private `10.x` address), so Anthropic's cloud machines can't reach it. There are 2 ways to get live data on the web:

1. **A self-hosted environment** running inside the corporate network. Set `CLOSE_COPILOT_DEMO_MODE=false`, `CLOSE_COPILOT_SAP_BASE_URL`, `CLOSE_COPILOT_SAP_USER` and `CLOSE_COPILOT_SAP_PASSWORD` in its environment.
2. **Exposing the 4 OData services publicly** through SAP BTP (Cloud Connector plus API Management), then adding that host under the environment's **Custom** network access.

Don't put the SAP password in a shared cloud environment. Anyone who uses the environment can read its variables.

## Development

```
npm test          # runs the unit tests and the MCP server protocol test (Node 18+)
npm run icons     # regenerates the PNG icons
```

After editing, click the reload icon on the extension card in `chrome://extensions`.

## Moving to a backend later (strategy §6)

All SAP access goes through `sapClient.fetchSource()`, and the data rules are pure functions in `processing.js`. To move to SAP BTP or a backend, either set **Proxy URL** to a service that returns the same OData shape, or move `processing.js` to the server unchanged and have `sync.js` fetch the processed snapshot.
