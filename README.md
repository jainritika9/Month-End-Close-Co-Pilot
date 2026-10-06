# Month-End Close Co-Pilot

This is an implementation of [strategy.txt](strategy.txt). It reads the month-end close from SAP through standard OData APIs and shows it in three ways:

- **A Claude Code plugin** (`close-copilot`): ask Claude about the close in plain language, e.g. "which GR/IR items over 90 days are with Nordic Steel?".
- **A localhost dashboard**: the same dashboard as a web page on your PC.
- **A SAP BTP app** for a Fiori launchpad tile: see [btp/README.md](btp/README.md).

The dashboard covers:

- **Close checklist status**: 3 tabs for EAM/QM inspection lots (`API_INSPECTIONLOT_SRV`), production orders (`API_PRODUCTION_ORDER_2_SRV`) and maintenance orders (`API_MAINTENANCEORDER`). Each shows completion % and overdue items. All are standard SAP APIs with no custom ABAP; see [abap/README.md](abap/README.md#close-checklist-standard-apis-no-custom-abap).
- **Unposted/parked documents**: amounts and how long they've been waiting.
- **Open GR/IR items**: GR vs IR difference and aging buckets, with items that need clearing flagged. Read from `API_OPLACCTGDOCITEMCUBE_SRV`; see [abap/README.md](abap/README.md#open-grir-items-standard-api-no-custom-abap).
- **Missing accruals**: planned vs posted amounts, with missing, variance and overdue items flagged. Read from `API_MANUALACCRUALS`; this system has no data in that API yet, see [abap/README.md](abap/README.md#accruals-standard-api-no-custom-abap---but-no-data-to-verify-it-against).

It also has an exceptions list, KPI tiles, charts, filters and a drill-down drawer that shows the raw SAP fields.

The earlier Chrome extension was removed. Its code is still in git history.

## Configuration

[config/default-config.json](config/default-config.json) holds the SAP base URL, client, company code, fiscal year, OData paths, field mappings and alert thresholds. It holds no secrets. Live SAP data is the default. For sample data, set `SAP_DEMO_MODE=true` (the MCP server and localhost dashboard) or pick demo mode in the plugin options.

Sources use OData v2 (`d.results`, `__next`) and v4 (`value`, `@odata.nextLink`), including paging. Filters can use `{fiscalYear}`, `{period}` and `{companyCode}`.

## Claude Code plugin

**Install** (in Claude Code, from the folder that contains this repo, or with the full path):

```
/plugin marketplace add ./Agent
/plugin install close-copilot@mwc-finance
```

When you enable it, Claude Code asks for the plugin options: SAP base URL, client, company code, plant, GR/IR account, fiscal year, SAP user and password, demo mode, and an optional config file. The password is marked sensitive, so it goes to Claude Code's secure credential storage, not `settings.json`. To change the options later, run `/plugin`, pick close-copilot and choose configure. To reuse data-source paths or thresholds, set a JSON file of the same shape as `config/default-config.json` as the plugin's **Config file** option.

**Slash commands**

| Command | What it does |
|---|---|
| `/close-copilot:close-status [cc] [period]` | Overall status, what needs attention now, key numbers |
| `/close-copilot:grir-review [cc] [days] [supplier]` | Open GR/IR, grouped by "received, not invoiced" and "invoiced, not received", with actions |
| `/close-copilot:accrual-check [cc] [period]` | Missing and off-plan accruals, with draft postings to review |
| `/close-copilot:parked-docs [cc] [days] [amount]` | Parked documents per creator |
| `/close-copilot:close-report [cc] [period]` | Management-ready status report |
| `/close-copilot:dashboard` | Starts the localhost dashboard (below) |

**MCP tools** (server `sap-close`, [mcp/server.mjs](mcp/server.mjs)). Claude also calls these directly when you ask a free-form question:

- `get_close_status`
- `list_checklist_tasks` (`category`: `inspection_lot` default, `production_order` or `maintenance_order`)
- `list_unposted_documents`
- `list_grir_items`
- `list_accruals`
- `test_sap_connection`

The server has no npm dependencies. It reads SAP with Basic authentication and caches each result for 2 minutes. The tools only read data; none of them post anything in SAP.

## Localhost dashboard

This is the dashboard served as a normal web page from your PC. It has the KPI tiles, charts, filterable tables and drill-down, plus company code, period and year selectors. There are 2 ways to start it:

- **In Claude Code:** run `/close-copilot:dashboard`, or `/dashboard` in this repo. Claude replies with a link like `http://localhost:8787/`. The page stays available while that Claude Code session is open.
- **Standalone:** run `npm run dashboard`, which also opens the browser. It shows a SAP sign-in form. For sample data, start it with `SAP_DEMO_MODE=true`.

The server listens on `127.0.0.1` only, so no other computer can open it. The SAP password you enter stays in the server's memory and is never written to disk. SAP is read server-side, so the browser hits no CORS errors. The server is in [web/server.mjs](web/server.mjs) and shares all rendering code with the BTP app ([src/dashboard/render.js](src/dashboard/render.js)).

**Diagnostics:** once signed in on the page:
- `GET http://localhost:8787/api/catalog?keyword=<TEXT>` searches SAP Gateway's service catalog for registered services whose technical name contains `<TEXT>`.
- `GET http://localhost:8787/api/metadata?service=<API_NAME>` returns that service's real `$metadata` XML, to confirm field and entity names.
- `GET http://localhost:8787/api/sample?service=<API_NAME>&entity=<EntitySet>&top=5&filter=<$filter>` returns a few real rows, to check that fields are populated.

None of the three are linked from the UI.

This only works in Claude Code **on your PC**. In a claude.ai/code web session, `localhost` is the cloud machine, which your browser can't open.

## Claude Code on the web (claude.ai/code)

Cloud sessions don't install plugins from your machine or from the repo's settings. Instead, the repository provides the same pieces directly, and a cloud session opened on this repo loads them automatically:

- [.mcp.json](.mcp.json) starts the `sap-close` server.
- [.claude/commands/](.claude/commands/) provides the commands without the plugin prefix: `/close-status`, `/grir-review`, `/accrual-check`, `/parked-docs` and `/close-report`.

**Web sessions use demo data by default** (`.mcp.json` sets `SAP_DEMO_MODE` to `true` unless `CLOSE_COPILOT_DEMO_MODE` says otherwise). The SAP system resolves only on the corporate network (a private `10.x` address), so Anthropic's cloud machines can't reach it. There are 2 ways to get live data on the web:

1. **A self-hosted environment** inside the corporate network. Set `CLOSE_COPILOT_DEMO_MODE=false`, `CLOSE_COPILOT_SAP_BASE_URL`, `CLOSE_COPILOT_SAP_USER` and `CLOSE_COPILOT_SAP_PASSWORD` in its environment.
2. **Exposing the OData services publicly** through SAP BTP (Cloud Connector plus API Management), then adding that host under the environment's **Custom** network access.

Don't put the SAP password in a shared cloud environment. Anyone who uses the environment can read its variables.

## SAP BTP app (Fiori launchpad tile)

The same dashboard as a BTP HTML5 app behind an approuter, launched from a Fiori launchpad tile. The browser reads the OData services through the approuter, so SAP sees each user's identity. See [btp/README.md](btp/README.md) for the deployment runbook.

## Project layout

```
.claude-plugin/          plugin manifest and marketplace entry
.claude/commands/        slash commands (plugin and claude.ai/code)
.mcp.json                MCP server for claude.ai/code
mcp/                     MCP server (server.mjs) and its data layer (closeData.mjs)
web/                     localhost dashboard: server.mjs and its browser script app.js
btp/                     SAP BTP app: browser entry and data layer, mta.yaml, approuter, runbook
config/default-config.json  default settings, OData paths and field mappings (no secrets)
src/lib/                 shared pure modules: config, sapClient (OData URLs), processing (rules), charts, mockData
src/dashboard/           shared dashboard markup, styles and renderer
abap/                    ABAP CDS views for the parked-document source, and the setup notes
tools/                   build-btp.mjs (BTP bundle) and make-icons.mjs (icons)
tests/                   node:test unit and protocol tests (npm test)
```

## Security design

| Concern | How it's handled |
|---|---|
| Credentials on the localhost dashboard | The SAP password stays in the server's memory and is never written to disk. |
| Credentials in the plugin | Stored by Claude Code's secure credential storage, not in `settings.json`. |
| Credentials in the BTP app | None. The approuter signs users in, and SAP sees their identity. The destination holds any SAP login (see [btp/README.md](btp/README.md)). |
| Localhost exposure | The server listens on `127.0.0.1` only and rejects other `Host` headers. |
| Scope | The MCP tools and dashboard only read. Use a dedicated, read-only SAP user. |
| Data in the repo | `config/default-config.json` holds no secrets. The BTP bundle omits the SAP host name. |

## Development

```
npm test          # unit tests and the MCP server protocol test (Node 20+)
npm run icons     # regenerates the PNG icons
npm run dashboard # starts the localhost dashboard
npm run build:btp # builds the BTP app into btp/dist/
```

## Moving to a backend later (strategy §6)

All OData URL building is in `src/lib/sapClient.js`, and the data rules are pure functions in `src/lib/processing.js`. To move the data to a server, keep those modules and have the server return the processed snapshot.
