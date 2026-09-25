---
description: Month-end close status for a company code and period, with what needs attention first
argument-hint: "[company code] [period] [fiscal year]"
---

Give me the month-end close status. Arguments (all optional, in any order): $ARGUMENTS
A 4-character value is a company code, a 1-3 digit number a period, a 4-digit year a fiscal year; anything missing uses the configured defaults.

1. Call the `get_close_status` tool of the `sap-close` MCP server with those arguments.
2. If it fails, call `test_sap_connection` and explain the problem and the fix in one or two sentences.

Answer in this shape, using the currency from the data and no invented figures:
- One headline line: company code, period/year, overall checklist completion %, and whether the close is on track.
- **Needs attention now**: the high-severity alerts, each with the concrete next step (who/what).
- **Numbers**: a small table covering `checklist` (inspection lots), `productionOrders`, `maintenanceOrders`, unposted documents, GR/IR to clear and missing accruals (count and amount) - skip any of the 3 checklist categories that's missing (e.g. `productionOrders` can be legitimately empty if this system has no discrete production orders).
- If `context.demoData` is true, say clearly that this is sample data. If `sourceErrors` is non-empty, list which sections could not be loaded.
