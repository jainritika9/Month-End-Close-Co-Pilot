---
description: Review open GR/IR items and propose clearing actions
argument-hint: "[company code] [min age days] [supplier]"
---

Review open GR/IR for the month-end close. Arguments (optional): $ARGUMENTS
Interpret them as company code, minimum age in days, and/or a supplier name.

1. Call `list_grir_items` (server `sap-close`) with `flagged_only: true` and the matching filters; if it returns no items, call it again without `flagged_only` to show the full picture.
2. Group the result:
   - **Goods received, not invoiced** (difference > 0): likely missing supplier invoices - candidates for an accrual or supplier follow-up.
   - **Invoiced, not received** (difference < 0): likely missing goods receipts - follow up with purchasing / the warehouse.
   - Items older than 90 days: flag as candidates for MR11 (GR/IR account maintenance) review.
3. Show a table per group: PO/item, supplier, difference, age in days - largest first, at most 15 rows each, with group totals.
4. End with the 3 most valuable actions, naming PO numbers.

Use only figures from the tool output, in its currency. Mention it if the data is demo data.
