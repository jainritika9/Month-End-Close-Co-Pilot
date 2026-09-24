---
description: Write a management-ready month-end close status report
argument-hint: "[company code] [period]"
---

Write a month-end close status report for finance management. Arguments (optional): $ARGUMENTS (company code and/or period).

Gather the data with the `sap-close` MCP server: `get_close_status`, then `list_checklist_tasks` (state `overdue` and `error`), `list_grir_items` (`flagged_only: true`, limit 10), `list_accruals` (state `missing`) and `list_unposted_documents` (limit 10).

Write the report in this structure, concise and factual, figures only from the tools:
1. **Summary** - 3 sentences: where the close stands, the biggest risk, what is needed to finish.
2. **Checklist** - completion %, failed and overdue tasks with owners.
3. **Open items** - parked documents, GR/IR to clear, missing accruals: counts, amounts, top items.
4. **Actions and owners** - numbered list, most important first.

State the company code, period and data timestamp (`context.syncedAt`) at the top. If it is demo data, say so in the first line.
