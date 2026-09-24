# ABAP objects: Close Co-Pilot OData services

These are the read-only OData services that the browser extension reads. They need S/4HANA 2020 or later (on-premise or RISE private cloud).

The 4 exposed views are **classic DDIC-based CDS views with `@OData.publish: true`**, because that annotation doesn't work on view entities. Each exposed view generates its own OData V2 service, so there is no service definition or binding. The helper views are CDS view entities.

> DDIC-based views are deprecated as of S/4HANA 2022. They still activate and run, but ADT shows a warning. If you later switch to a service definition and binding, convert the 4 views back to `define view entity` and remove `sqlViewName`, `compareFilter`, `preserveKey` and `OData.publish`.

## Objects

| File | Object | Type | Purpose |
|---|---|---|---|
| `zmwc_r2r_accpln.tabl.txt` | `ZMWC_R2R_ACCPLN` | Table | Accrual plan: expected accruals per period |
| `ztf_eam_checklist_status` | `ZTF_EAM_CHECKLIST_STATUS` | CDS table function | EAM (Plant Maintenance) quality inspection lots and their Usage Decision status - the close checklist's real data source. From `EAM_Checklist_Status_Table_Function.docx`, plus a `bukrs` (company code) column |
| `zcl_tf_eam_checklist_status.clas.abap` | `ZCL_TF_EAM_CHECKLIST_STATUS` | AMDP class | Implements the table function above (SQLScript over `QALS`/`JEST`/`TJ02T`/`AUFK`/`AFVC`) |
| `zi_r2r_closetask` | `ZI_R2R_CloseTask` | DDIC CDS + DCL | **Published** as `ZI_R2R_CLOSETASK_CDS`. Close checklist, wrapping the table function above |
| `zi_r2r_parkeddocitem` | `ZI_R2R_ParkedDocItem` | View entity (helper) | Union of debit lines from `VBSEGS/K/D/A` |
| `zi_r2r_parkeddocamount` | `ZI_R2R_ParkedDocAmount` | View entity (helper) | Total per parked document |
| `zi_r2r_parkeddocument` | `ZI_R2R_ParkedDocument` | DDIC CDS + DCL | **Published** as `ZI_R2R_PARKEDDOCUMENT_CDS`. Parked FI documents (`BKPF-BSTAT` V/W) |
| `zi_r2r_griraccount` | `ZI_R2R_GRIRAccount` | View entity (helper) | GR/IR accounts read from `T030` / `WRX` (OBYC) |
| `zi_r2r_grirbalance` | `ZI_R2R_GRIRBalance` | View entity (helper) | Uncleared GR/IR balance per PO item, from `I_JournalEntryItem` |
| `zi_r2r_griropenitem` | `ZI_R2R_GRIROpenItem` | DDIC CDS + DCL | **Published** as `ZI_R2R_GRIROPENITEM_CDS`. Open GR/IR items with supplier name |
| `zi_r2r_accrualposted` | `ZI_R2R_AccrualPosted` | View entity (helper) | Posted amounts per GL account, cost center, document type and period |
| `zi_r2r_accrualcheck` | `ZI_R2R_AccrualCheck` | DDIC CDS + DCL | **Published** as `ZI_R2R_ACCRUALCHECK_CDS`. Planned vs posted accruals |

The element names on the published views match the field mappings in `config/default-config.json`, so the extension needs no field changes.

## Activation order (ADT)

Create all objects in one package, e.g. a new `ZMWC_R2R_CLOSE`, on one transport. For each object, create it with the same name, paste the file's content and activate it. Go in this order:

1. The table `ZMWC_R2R_ACCPLN`. Business Function `LOG_EAM_CHECKLIST` must be active for the EAM objects below (per `EAM_Checklist_Status_Table_Function.docx`); confirm with your Basis team if unsure.
2. `ZTF_EAM_CHECKLIST_STATUS` (CDS table function), then `ZCL_TF_EAM_CHECKLIST_STATUS` (its AMDP class) - create the class first in ADT (New > Class), mark **Global class**, then paste the source; the table function references it by name so either order activates, but the class existing first avoids a transient "method not found" warning.
3. The parked-document views: `ZI_R2R_ParkedDocItem`, then `ZI_R2R_ParkedDocAmount`, then `ZI_R2R_ParkedDocument`.
4. The GR/IR views: `ZI_R2R_GRIRAccount`, then `ZI_R2R_GRIRBalance`, then `ZI_R2R_GRIROpenItem`.
5. The accrual views: `ZI_R2R_AccrualPosted`, then `ZI_R2R_AccrualCheck`.
6. `ZI_R2R_CloseTask`.
7. The 4 access controls (the `.dcls` files). Create each with the same name as its view.
8. **Register the 4 generated services.** Activating a view with `@OData.publish: true` generates its service, but the service isn't reachable until it's registered. For each service:
   - Go to `/IWFND/MAINT_SERVICE` → **Add Service**.
   - Enter System Alias `LOCAL` and the technical service name, then click **Get Services**.
   - Click **Add Selected Services** and use your package and transport.

   This creates each service's SICF node. In ADT, the marker next to `@OData.publish` shows whether a service is active.

   | Service | Entity set |
   |---|---|
   | `ZI_R2R_CLOSETASK_CDS` | `ZI_R2R_CloseTask` |
   | `ZI_R2R_PARKEDDOCUMENT_CDS` | `ZI_R2R_ParkedDocument` |
   | `ZI_R2R_GRIROPENITEM_CDS` | `ZI_R2R_GRIROpenItem` |
   | `ZI_R2R_ACCRUALCHECK_CDS` | `ZI_R2R_AccrualCheck` |
9. Optional: in SE54, generate table maintenance for `ZMWC_R2R_ACCPLN` so finance can maintain it in SM30.

## Verify these at activation

I wrote these views without access to your system. Names are based on standard S/4HANA, but press **F2** on anything ADT underlines. These are the points most likely to need a change:

- **`I_JournalEntryItem.ClearingJournalEntry`**: some releases call it `ClearingAccountingDocument` instead. Use whichever one the element list shows.
- **`Ledger = '0L'`**: this assumes your leading ledger is `0L`. It's in 2 views.
- **`VBSEG*.BZKEY`**: this is the parked line number field. If the name differs, it only matters as a key and can be dropped.
- **Case expressions on amounts** in `ZI_R2R_GRIRBalance` are allowed on 2020 and later. If activation rejects `sum( case … )`, tell me the exact error.
- **`AUFK-BUKRS`**: I'm fairly confident this field exists (orders carry a company code for settlement), but check it in SE11 - `ZI_R2R_CloseTask` and its access control both depend on it.
- **`substring`/`concat`/`concat_with_space`/`case` in the classic `ZI_R2R_CloseTask` view**: these are long-standing classic-CDS built-ins, but if activation rejects one, tell me the exact error and I'll adjust.
- **SQL view names** (`ZIR2RCLTASK`, `ZIR2RPARKDOC`, `ZIR2RGRIROPEN`, `ZIR2RACCRCHK`) must be unique in the system and at most 16 characters.
- **Amounts stay as currency amounts (CURR) throughout** instead of being cast to decimals. This means OData applies the right number of decimals for currencies like JPY, which has 0 decimals.

## Authorizations (PFCG)

A user who runs the dashboard needs:

- **`S_SERVICE`**: start authorization for each of the 4 services. In PFCG, go to Menu → Authorization Default → *SAP Gateway: Service Groups Metadata* and add the 4 `ZI_R2R_*_CDS` services. Without it, calls return 403 and `SU53` shows `S_SERVICE`.
- **`F_BKPF_BUK`**, activity `03`, for the company codes they should see. The access controls filter every entity set by this, so users without it get 0 rows rather than an error. This is the same check as FB03 and FBL3N.

## Test URLs (`/IWFND/GW_CLIENT` or a browser)

```
/sap/opu/odata/sap/ZI_R2R_GRIROPENITEM_CDS/$metadata
/sap/opu/odata/sap/ZI_R2R_GRIROPENITEM_CDS/ZI_R2R_GRIROpenItem?$top=5&$format=json
/sap/opu/odata/sap/ZI_R2R_PARKEDDOCUMENT_CDS/ZI_R2R_ParkedDocument?$filter=CompanyCode eq '1000' and FiscalYear eq '2026' and FiscalPeriod eq '009'&$format=json
/sap/opu/odata/sap/ZI_R2R_CLOSETASK_CDS/ZI_R2R_CloseTask?$format=json
/sap/opu/odata/sap/ZI_R2R_ACCRUALCHECK_CDS/ZI_R2R_AccrualCheck?$format=json
```

`ZI_R2R_AccrualCheck` stays empty until rows exist in `ZMWC_R2R_ACCPLN`. `ZI_R2R_CloseTask` returns data as soon as any QM inspection lots exist with an order attached.

## Known limits and design decisions

- **Parked documents cover FI only.** Supplier invoices parked in MM (MIR7) are stored in `RBKP/RSEG`, not `BKPF/VBSEG*`, so they don't appear yet. A fifth published view can be added for them.
- **Direct table access.** The parked-document views read `BKPF`, `VBSEG*` and `T030` directly, because I don't know of a released view that covers parked line amounts or account determination. That's fine on-premise and on RISE, but not under ABAP Cloud (Tier 1). GR/IR and accruals use the released `I_JournalEntryItem`.
- **GR/IR amounts are signed as posted.** GR is a credit (negative), and the extension flips it (`"signedAmounts": true`). Items that net to zero but are still uncleared (waiting for F.13) are returned, and the extension hides them.
- **How accruals are matched.** An accrual counts as posted when there are postings on the same expense GL account, cost center and document type in the period. Use a dedicated accrual document type, so ordinary invoices on the same account don't count as the accrual.
- **The close checklist is EAM inspection-lot status, not a generic finance task list.** Each row is one QM inspection lot; "closed" means a Usage Decision was made (`QALS-VCODE` filled), whichever way it went - there's no separate "rejected/failed" state (see the AMDP class's header comment). There's no owner field at the lot level, so `ResponsiblePerson` is always blank. `PlannedEndDate` is really the lot's *creation* date; the extension (`dueDateIsAge` + `thresholds.checklistSlaDays`, default 10) treats "overdue" as "still open past the SLA" rather than "past a due date" - tune `checklistSlaDays` to match how long your inspections should take.
- **Only inspection lots linked to a maintenance order get a company code**, since company code comes from `AUFK-BUKRS` via the order. A lot with no order (or whose order has no company code) has a blank `CompanyCode` and is filtered out for every user by the access control. If your EAM checklists aren't order-based, this view needs a different source of company code, or the access control needs to key off plant instead.
- **If you'd rather track a generic finance checklist** (post accruals, run FX valuation, lock the period, ...) instead of or alongside this EAM one, that's the manually maintained approach from before - see this file's git history for `ZMWC_R2R_CLTASK` and the earlier `ZI_R2R_CloseTask`.
