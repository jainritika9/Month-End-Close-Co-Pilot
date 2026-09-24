---
description: Open the full month-end close dashboard (charts, tables, drill-down) in your browser
argument-hint: "[company code] [period] [fiscal year]"
---

Open the visual close dashboard. Arguments (optional, any order): $ARGUMENTS
A 4-character value is a company code, a 1-3 digit number a period, a 4-digit year a fiscal year.

Call the `open_dashboard` tool of the `sap-close` MCP server with those arguments, then reply with only:
- the returned URL as a clickable markdown link, e.g. [Open the close dashboard](http://localhost:8787/)
- one short line saying it runs locally while this session is open.

Do not summarise the close data in text - the user asked for the dashboard itself.
