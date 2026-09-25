# ABAP objects: Close Co-Pilot OData services

These are the read-only OData services that the browser extension reads. They need S/4HANA 2020 or later (on-premise or RISE private cloud).

**The close checklist needs no custom ABAP at all** - it reads the standard, SAP-delivered `API_INSPECTIONLOT_SRV` (`A_InspectionLot` + `A_InspLotUsageDecision`) directly; see [default-config.json](../config/default-config.json)'s `sources.checklist` and the "Close checklist: standard API" section below. Only the other 3 sections (unposted documents, GR/IR, accruals) still need the custom objects listed here.

The 3 exposed views are **classic DDIC-based CDS views with `@OData.publish: true`**, because that annotation doesn't work on view entities. Each exposed view generates its own OData V2 service, so there is no service definition or binding. The helper views are CDS view entities.

> DDIC-based views are deprecated as of S/4HANA 2022. They still activate and run, but ADT shows a warning. If you later switch to a service definition and binding, convert the views back to `define view entity` and remove `sqlViewName`, `compareFilter`, `preserveKey` and `OData.publish`.

## Objects

| File | Object | Type | Purpose |
|---|---|---|---|
| `zmwc_r2r_accpln.tabl.txt` | `ZMWC_R2R_ACCPLN` | Table | Accrual plan: expected accruals per period |
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

1. The table `ZMWC_R2R_ACCPLN`.
2. The parked-document views: `ZI_R2R_ParkedDocItem`, then `ZI_R2R_ParkedDocAmount`, then `ZI_R2R_ParkedDocument`.
3. The GR/IR views: `ZI_R2R_GRIRAccount`, then `ZI_R2R_GRIRBalance`, then `ZI_R2R_GRIROpenItem`.
4. The accrual views: `ZI_R2R_AccrualPosted`, then `ZI_R2R_AccrualCheck`.
5. The 3 access controls (the `.dcls` files). Create each with the same name as its view.
6. **Register the 3 generated services.** Activating a view with `@OData.publish: true` generates its service, but the service isn't reachable until it's registered. For each service:
   - Go to `/IWFND/MAINT_SERVICE` → **Add Service**.
   - Enter System Alias `LOCAL` and the technical service name, then click **Get Services**.
   - Click **Add Selected Services** and use your package and transport.

   This creates each service's SICF node. In ADT, the marker next to `@OData.publish` shows whether a service is active.

   | Service | Entity set |
   |---|---|
   | `ZI_R2R_PARKEDDOCUMENT_CDS` | `ZI_R2R_ParkedDocument` |
   | `ZI_R2R_GRIROPENITEM_CDS` | `ZI_R2R_GRIROpenItem` |
   | `ZI_R2R_ACCRUALCHECK_CDS` | `ZI_R2R_AccrualCheck` |
7. Also register the standard `API_INSPECTIONLOT_SRV` the same way (it's SAP-delivered, so only registration is needed, not creation) - see the checklist section below.
8. Optional: in SE54, generate table maintenance for `ZMWC_R2R_ACCPLN` so finance can maintain it in SM30.

## Close checklist: standard API, no custom ABAP

`config/default-config.json`'s `sources.checklist` points straight at `API_INSPECTIONLOT_SRV` (`A_InspectionLot`), SAP's standard Quality Management API for inspection lots - confirmed present in this system. Two things make this different from the other 3 sources:

- **No single entity carries both "lot exists" and "is it closed".** The Usage Decision (what closes a lot) lives in a separate entity set, `A_InspLotUsageDecision`, keyed by `InspectionLot`. The config's `join` block tells the extension to fetch both and merge them client-side by that key (`mergeJoinedRows` in `src/lib/sapClient.js`) - a lot with no matching Usage Decision row is simply open.
- **No company code.** An inspection lot isn't tied to a company code the way an FI document is; the closest scoping field is `Plant`. Set **Plant** in Settings, then add `Plant eq '{plant}'` to this source's `$filter` (it isn't filtered by default, so every user sees the same unscoped `$top=500` most-recent lots until you do).

Field names (`InspectionLotUsageDecisionCode`, `CreationDate`, `InspectionLotType`, ...) come from SAP's own API Business Hub / Help Portal documentation, not from testing against this system's `$metadata`. If the checklist section shows "Could not load", check `GET .../API_INSPECTIONLOT_SRV/$metadata` first - a wrong field name in the `fields` mapping just shows up blank (harmless), but a wrong one in `$filter`/`$orderby` causes a real error.

Two fields this API doesn't have are made up for in `processing.js`:
- **No free-text name** - `nameFromId: true` displays "Inspection lot `<id>`" instead.
- **No fixed "done" code list** - Usage Decision codes are whatever a client's own UD catalog defines, so `statusMeansDoneWhenNonBlank: true` treats *any* code as closed, rather than checking against a specific list like the other sources' `statusValues.done`.

There's still no owner field, same limitation as before.

## Verify these at activation

I wrote these views without access to your system. Names are based on standard S/4HANA, but press **F2** on anything ADT underlines. These are the points most likely to need a change:

- **`I_JournalEntryItem.ClearingJournalEntry`**: some releases call it `ClearingAccountingDocument` instead. Use whichever one the element list shows.
- **`Ledger = '0L'`**: this assumes your leading ledger is `0L`. It's in 2 views.
- **`VBSEG*.BZKEY`**: this is the parked line number field. If the name differs, it only matters as a key and can be dropped.
- **Case expressions on amounts** in `ZI_R2R_GRIRBalance` are allowed on 2020 and later. If activation rejects `sum( case … )`, tell me the exact error.
- **SQL view names** (`ZIR2RPARKDOC`, `ZIR2RGRIROPEN`, `ZIR2RACCRCHK`) must be unique in the system and at most 16 characters.
- **Amounts stay as currency amounts (CURR) throughout** instead of being cast to decimals. This means OData applies the right number of decimals for currencies like JPY, which has 0 decimals.

## Authorizations (PFCG)

A user who runs the dashboard needs:

- **`S_SERVICE`**: start authorization for each service, including the standard `API_INSPECTIONLOT_SRV`. In PFCG, go to Menu → Authorization Default → *SAP Gateway: Service Groups Metadata* and add all 4. Without it, calls return 403 and `SU53` shows `S_SERVICE`.
- **`F_BKPF_BUK`**, activity `03`, for the company codes they should see. The 3 custom views' access controls filter by this, so users without it get 0 rows rather than an error - same check as FB03 and FBL3N. `API_INSPECTIONLOT_SRV` has its own standard QM authorization instead (e.g. `Q_QMEL`/plant-based authorization) - check with your QM team what your users already need for IQS1/IQS21, since this API enforces the same.

## Test URLs (`/IWFND/GW_CLIENT` or a browser)

```
/sap/opu/odata/sap/ZI_R2R_GRIROPENITEM_CDS/$metadata
/sap/opu/odata/sap/ZI_R2R_GRIROPENITEM_CDS/ZI_R2R_GRIROpenItem?$top=5&$format=json
/sap/opu/odata/sap/ZI_R2R_PARKEDDOCUMENT_CDS/ZI_R2R_ParkedDocument?$filter=CompanyCode eq '1000' and FiscalYear eq '2026' and FiscalPeriod eq '009'&$format=json
/sap/opu/odata/sap/ZI_R2R_ACCRUALCHECK_CDS/ZI_R2R_AccrualCheck?$format=json
/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/$metadata
/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot?$top=5&$format=json
/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspLotUsageDecision?$top=5&$format=json
```

`ZI_R2R_AccrualCheck` stays empty until rows exist in `ZMWC_R2R_ACCPLN`.

## Known limits and design decisions

- **Parked documents cover FI only.** Supplier invoices parked in MM (MIR7) are stored in `RBKP/RSEG`, not `BKPF/VBSEG*`, so they don't appear yet. A fifth published view can be added for them.
- **Direct table access.** The parked-document views read `BKPF`, `VBSEG*` and `T030` directly, because I don't know of a released view that covers parked line amounts or account determination. That's fine on-premise and on RISE, but not under ABAP Cloud (Tier 1). GR/IR and accruals use the released `I_JournalEntryItem`.
- **GR/IR amounts are signed as posted.** GR is a credit (negative), and the extension flips it (`"signedAmounts": true`). Items that net to zero but are still uncleared (waiting for F.13) are returned, and the extension hides them.
- **How accruals are matched.** An accrual counts as posted when there are postings on the same expense GL account, cost center and document type in the period. Use a dedicated accrual document type, so ordinary invoices on the same account don't count as the accrual.
- **The close checklist is EAM inspection-lot status, not a generic finance task list.** Each row is one QM inspection lot; "closed" means a Usage Decision exists, whichever way it went - there's no separate "rejected/failed" state (see the checklist section above). There's no owner field either.
- **If you'd rather track a generic finance checklist** (post accruals, run FX valuation, lock the period, ...) instead of or alongside this EAM one, that's the manually maintained approach from before, built on a Z table and a custom CDS view - see this file's git history (before the switch to `API_INSPECTIONLOT_SRV`) for `ZMWC_R2R_CLTASK` and `ZI_R2R_CloseTask`.
