---
description: List parked / unposted documents that block the close
argument-hint: "[company code] [min age days] [min amount]"
---

List parked (unposted) documents for the month-end close. Arguments (optional): $ARGUMENTS
Interpret them as company code, minimum age in days, and/or minimum amount.

1. Call `list_unposted_documents` (server `sap-close`) with those filters.
2. Show a table: document, type, posting date, age (days), amount, created by, header text - largest amount first, at most 20 rows, then the total count and amount.
3. Group by `createdBy` underneath so each person sees what they need to post or delete, and call out anything parked more than 5 days.

Use only figures from the tool output, in its currency. Mention it if the data is demo data.
