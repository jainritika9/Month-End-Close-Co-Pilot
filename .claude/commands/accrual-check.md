---
description: Find missing or off-plan accruals for the period
argument-hint: "[company code] [period]"
---

Check accruals for the month-end close. Arguments (optional): $ARGUMENTS (company code and/or period).

1. Call `list_accruals` (server `sap-close`) with those arguments.
2. Report:
   - **Missing** accruals first - overdue ones (past posting due date) at the top - with planned amount, cost center and GL account.
   - **Variances** beyond the tolerance, with planned vs posted and the gap.
   - One line with the total missing amount and how many accruals are fine.
3. For each missing accrual, draft the posting it needs as a short line: debit expense GL + cost center, credit the accrual account, amount, "reverse on first day of next period". Make clear these are proposals to be reviewed, not postings.

Use only figures from the tool output, in its currency. Mention it if the data is demo data.
