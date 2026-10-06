# ABAP objects: Close Co-Pilot OData services

These are the read-only OData services that the dashboard reads. They need S/4HANA 2020 or later (on-premise or RISE private cloud).

**Only unposted/parked documents still need custom ABAP.** Everything else reads a standard SAP API: the close checklist is 3 tabs, each its own standard API - EAM/QM inspection lots (`API_INSPECTIONLOT_SRV`), production orders (`API_PRODUCTION_ORDER_2_SRV`) and maintenance orders (`API_MAINTENANCEORDER`) - see "Close checklist: standard APIs" below. GR/IR reads `API_OPLACCTGDOCITEMCUBE_SRV` - see "Open GR/IR items" below. Accruals reads `API_MANUALACCRUALS` - see "Accruals" below (with a significant caveat: this system has no data in that API at all).

The 1 exposed view is a **classic DDIC-based CDS view with `@OData.publish: true`**, because that annotation doesn't work on view entities. It generates its own OData V2 service, so there is no service definition or binding. The helper views are CDS view entities.

> DDIC-based views are deprecated as of S/4HANA 2022. They still activate and run, but ADT shows a warning. If you later switch to a service definition and binding, convert the views back to `define view entity` and remove `sqlViewName`, `compareFilter`, `preserveKey` and `OData.publish`.

## Objects

| File | Object | Type | Purpose |
|---|---|---|---|
| `zi_r2r_parkeddocitem` | `ZI_R2R_ParkedDocItem` | View entity (helper) | Union of debit lines from `VBSEGS/K/D/A` |
| `zi_r2r_parkeddocamount` | `ZI_R2R_ParkedDocAmount` | View entity (helper) | Total per parked document |
| `zi_r2r_parkeddocument` | `ZI_R2R_ParkedDocument` | DDIC CDS + DCL | **Published** as `ZI_R2R_PARKEDDOCUMENT_CDS`. Parked FI documents (`BKPF-BSTAT` V/W) |

The element names on the published view match the field mappings in `config/default-config.json`, so the dashboard needs no field changes.

## Activation order (ADT)

Create all objects in one package, e.g. a new `ZMWC_R2R_CLOSE`, on one transport. For each object, create it with the same name, paste the file's content and activate it. Go in this order:

1. The parked-document views: `ZI_R2R_ParkedDocItem`, then `ZI_R2R_ParkedDocAmount`, then `ZI_R2R_ParkedDocument`.
2. The access control (`zi_r2r_parkeddocument.dcls.asdcls`).
3. **Register the generated service.** Activating a view with `@OData.publish: true` generates its service, but the service isn't reachable until it's registered:
   - Go to `/IWFND/MAINT_SERVICE` → **Add Service**.
   - Enter System Alias `LOCAL` and the technical service name (`ZI_R2R_PARKEDDOCUMENT_CDS`), then click **Get Services**.
   - Click **Add Selected Services** and use your package and transport.

   This creates the service's SICF node. In ADT, the marker next to `@OData.publish` shows whether it's active.
4. Also register the 5 standard APIs the same way (they're SAP-delivered, so only registration is needed, not creation) - `API_INSPECTIONLOT_SRV`, `API_PRODUCTION_ORDER_2_SRV`, `API_MAINTENANCEORDER`, `API_OPLACCTGDOCITEMCUBE_SRV`, `API_MANUALACCRUALS` - see their sections below.

## Close checklist: standard APIs, no custom ABAP

The close checklist is 3 tabs on the dashboard, each its own independently-fetched standard API and its own donut/table: inspection lots, production orders and maintenance orders (`CHECKLIST_CATEGORIES` in `src/lib/processing.js`; the tab bar is `renderChecklistCard` in `src/dashboard/render.js`). All 3 feed the same `analyzeChecklist` logic and the same alert-building code, parameterised by source config - see the 3 sub-sections below.

### Inspection lots

`config/default-config.json`'s `sources.checklist` points straight at `API_INSPECTIONLOT_SRV` (`A_InspectionLot`), SAP's standard Quality Management API for inspection lots - confirmed present in this system. Two things make this different from the other 3 sources:

- **No single entity carries both "lot exists" and "is it closed".** The Usage Decision (what closes a lot) lives in a separate entity set, `A_InspLotUsageDecision`, keyed by `InspectionLot`. The config's `join` block tells the dashboard to fetch both and merge them client-side by that key (`mergeJoinedRows` in `src/lib/sapClient.js`) - a lot with no matching Usage Decision row is simply open.
- **No company code.** An inspection lot isn't tied to a company code the way an FI document is; the closest scoping field is `Plant`. Set **Plant** in Settings, then add `Plant eq '{plant}'` to this source's `$filter` (it isn't filtered by default, so every user sees the same unscoped `$top=500` most-recent lots until you do).

**Field names verified against this system's real `$metadata`** (fetched live via the web dashboard's `/api/metadata?service=...` diagnostic endpoint - see `web/server.mjs`), not just SAP's public documentation. One name from the docs turned out wrong and was corrected: the creation date field is `InspectionLotCreatedOn`, not `CreationDate`. If the checklist section ever shows "Could not load", re-check with that same endpoint - a wrong field name in the `fields` mapping just shows up blank (harmless), but a wrong one in `$filter`/`$orderby` causes a real error.

Two fields this API doesn't have are made up for in `processing.js`:
- **No free-text name** - `nameFromId: true` displays "Inspection lot `<id>`" instead.
- **No fixed "done" code list** - Usage Decision codes are whatever a client's own UD catalog defines, so `statusMeansDoneWhenNonBlank: true` treats *any* code as closed, rather than checking against a specific list like the other sources' `statusValues.done`.

There's still no owner field, same limitation as before.

**Known caveat, found by checking real data:** in this system, sorting all accessible inspection lots by `InspectionLotCreatedOn` descending, the *newest* one is from 2015-05-06 - nothing more recent exists (or is visible to this user) at all. This isn't a bug in the query; it reflects either that QM inspection lots aren't part of this company's live process any more, or that this user's authorization/plant scope only covers old data. Until that's resolved, this section may show stale 2015 data rather than the current period's real state - worth confirming with your QM/Basis team before relying on it for an actual close decision.

### Production orders

`config/default-config.json`'s `sources.productionOrder` points at `API_PRODUCTION_ORDER_2_SRV` (`A_ProductionOrder_2`), SAP's standard discrete-manufacturing production order API - confirmed active and its fields verified against real `$metadata`. Unlike inspection lots, this entity has a real company code (`CompanyCode`) and real due dates (`MfgOrderScheduledEndDate`), so `dueDateIsAge` is **not** set here - overdue means literally past due, the same as unposted documents and accruals.

- **"Done" is 2 separate boolean flags, not one status field.** `OrderIsTechnicallyCompleted` and `OrderIsClosed` are each a raw `'X'`/`''` flag. `deriveOrderStatus` in `processing.js` (source config: `doneWhenFlagSet: ['OrderIsTechnicallyCompleted', 'OrderIsClosed']`) combines them into one synthetic `_derivedStatus` field ('DONE' or '') before `analyzeChecklist` reads it via the same `statusMeansDoneWhenNonBlank` mechanism the inspection-lot source uses - an order counts as done if *either* flag is set.
- **No free-text order name** - `fields.name` uses `Material` (the product being produced), which is more informative than an order number alone.
- **Filters by CompanyCode + Plant when Plant is set, else CompanyCode alone.** Production orders are naturally scoped by plant (a company code can span several plants), so `$filter` is `{ "when": "plant", "then": "CompanyCode eq '{companyCode}' and Plant eq '{plant}'", "else": "CompanyCode eq '{companyCode}'" }` - `resolveQueryValue` in `src/lib/sapClient.js` picks between the two based on whether `sap.plant` is set. This is the same `Plant` field name the checklist's inspection-lot source uses, not `ProductionPlant` (this entity has both - `Plant` was chosen for consistency, though the live data check below couldn't confirm which one this system actually populates, since both returned 0 rows).
- **Plant has its own selector on this tab**, not just the global Settings field - a text input + Apply button shown only when this tab is active (`renderChecklistCard` in `src/dashboard/render.js`, wired through `setPlantHandler`). Submitting it re-fetches just this source with that plant, transiently (`getSnapshot`'s `plant` override in `mcp/closeData.mjs`, `runSync`'s in `src/lib/sync.js`) - it isn't saved back to Settings, and clearing it reverts to whatever's configured there.

**Known caveat, found by checking real data:** this company code returns **0 rows** from this API, checked with no filter at all, with `CompanyCode eq '7827'` alone, with `Plant eq 'J316'`/`ProductionPlant eq 'J316'` alone, and with the combined `CompanyCode eq '7827' and Plant eq 'J316'` this source actually sends (`J316` is a real plant, seen on maintenance orders for this company code) - there is no discrete production order data anywhere accessible to this user, under any scoping tried. The entity has no `sap:requires-filter` annotation either, so this isn't a missing-mandatory-parameter situation. This is consistent with this being a process-manufacturing (PP-PI, e.g. beverage bottling) site rather than a discrete-manufacturing one; process orders use a different order category and API entirely. A live search of this system's service catalog (`/api/catalog?keyword=...` - see "Unposted/parked documents" below for how that tool works) for `PROCESSORDER`, `PROCESS_ORDER` and `PRODNORD` found nothing registered either, so no process-order API could be verified as a replacement. An authorization-based row filter (like the one this repo's own custom DCLs use deliberately) is also possible - check `SU53` after a GW_CLIENT call, or ask your PP team what's needed for CO03/COOIS. The tab is still wired up - in case any of that changes - but expect it to show "Nothing to show" here.

### Maintenance orders

`config/default-config.json`'s `sources.maintenanceOrder` points at `API_MAINTENANCEORDER` (`MaintenanceOrder`), SAP's standard plant-maintenance order API - confirmed active **with real, current data** for this company code (checked live, ordered by creation date - most recent orders were created within days of this check). Also has a real company code and due date (`MaintOrdBasicEndDate`), so `dueDateIsAge` is not set here either.

- **"Done" is a status-code text, not a boolean.** This API has no boolean completion flag - `SystemStatusText` is a space-separated list of SAP status abbreviations (e.g. `"TECO CNF PRC SETC"`). `deriveOrderStatus`'s `doneWhenTextContains: { field: 'SystemStatusText', tokens: ['TECO', 'CLSD'] }` checks whether either abbreviation appears anywhere in that text - `TECO` (technically completed) or `CLSD` (closed) - feeding the same synthetic `_derivedStatus` field production orders use.
- **Free-text name**: `fields.name` uses `MaintenanceOrderDesc`, a real description field this API has (unlike inspection lots, which have none).
- **`$filter` includes a rolling 365-day window, found necessary by checking real performance, not just real data.** `CompanyCode eq '{companyCode}' and MaintOrdBasicEndDate ge datetime'{recentCutoff}'` (`recentCutoff` in `periodVars()`, `src/lib/config.js`) with `$orderby: MaintOrdBasicEndDate desc`. Without the date filter, sorting this company's full, unfiltered order history (which goes back to 2015) by date took **~49 seconds** live - over the default 30s request timeout - while the exact same sort pre-filtered to the last year took **~8 seconds**. Filtering by `CompanyCode` alone didn't help (confirmed: `$top=100` was just as slow as `$top=500`, so the cost was the sort itself, not the row count); filtering by a date range on the same field being sorted did. **Trade-off**: an order overdue by more than 365 days won't appear here at all - a real, deliberate limitation (analogous to the checklist's 2015-data caveat, but a design choice made for performance here, not a data gap found by accident).

## Open GR/IR items: standard API, no custom ABAP

`config/default-config.json`'s `sources.grir` points at `API_OPLACCTGDOCITEMCUBE_SRV` (`A_OperationalAcctgDocItemCube`), SAP's standard operational accounting document item (universal journal) API - confirmed present and active in this system. This replaced 3 custom CDS views (`ZI_R2R_GRIRAccount`, `ZI_R2R_GRIRBalance`, `ZI_R2R_GRIROpenItem`) that used to read `T030`/`WRX` and `I_JournalEntryItem` directly - see this file's git history if you need them back.

- **No PO-item balance, only individual line items.** Unlike the old CDS view (which summed GR vs IR amounts per PO item in SQL), this API returns one row per accounting document line item. `groupByPoItem: true` on the source tells the dashboard to sum them client-side, grouped by `PurchasingDocument`/`PurchasingDocumentItem` (`aggregateGrirLineItems` in `src/lib/processing.js`). On the GR/IR clearing account, a goods receipt always posts credit (`DebitCreditCode = 'H'`) and an invoice receipt always posts debit (`'S'`) - that's the accounting mechanism that lets the two net to zero once matched, and it's what tells a GR line from an IR line, not a separate field.
- **No "is this GR/IR" flag - only the account.** The API has no concept of "GR/IR posting"; it's filtered to the specific G/L account the postings land on, via `GLAccount eq '{grirAccount}'`. `sap.grirAccount` in Settings holds that account number. **This system's account was found by checking real data, not guessed**: every one of the 3,489 open items the old CDS view returns carries `GLAccount = '241101001'` (`GLAccountLongName: "Goods Receipt / Invoice Receipt Clearing"`, `TransactionTypeDetermination: "WRX"` - the same OBYC transaction key the old `ZI_R2R_GRIRAccount` view read from `T030`). If your system uses more than one GR/IR account (e.g. one per valuation class), change the `$filter` to an `or` of each account.
- **`IsCleared eq false`** in the `$filter` keeps the request to open items only - an original line's `IsCleared` flips to `true` once a clearing document matches it, so this is equivalent to the old view's "uncleared" condition without needing `T030`/OBYC at all.

**Verified against real data, not just schema**, following the same discipline as the checklist section above: fetched `$metadata` for the entity (all needed fields present: `PurchasingDocument`, `PurchasingDocumentItem`, `GLAccount`, `IsCleared`, `DebitCreditCode`, `PostingDate`, `AmountInCompanyCodeCurrency`, `SupplierName`), then pulled real open rows filtered to `GLAccount = '241101001'` and confirmed current dates (2026, not stale) and populated PO references - see `/api/sample?service=API_OPLACCTGDOCITEMCUBE_SRV&entity=A_OperationalAcctgDocItemCube` in `web/server.mjs`, the same credential-safe diagnostic pattern as `/api/metadata`.

Two API names that looked plausible were checked and rejected before landing on this one: `API_JOURNALENTRYITEM_SRV` isn't registered in this system (`/IWFND/MED/170`), and `API_JOURNALENTRYITEMBASIC_SRV` is registered but its entity has no posting date, document number, PO reference or clearing indicator - a controlling/cost-center reporting shape, not a GR/IR-capable one.

## Accruals: standard API, no custom ABAP - but no data to verify it against

`config/default-config.json`'s `sources.accruals` points at `API_MANUALACCRUALS`, SAP's standard Accrual Engine / Manual Accruals app - confirmed active, and its field names verified against real `$metadata`. This replaced 2 custom objects (`ZMWC_R2R_ACCPLN`, the manually-maintained accrual plan table, and the `ZI_R2R_AccrualPosted`/`ZI_R2R_AccrualCheck` views built on it) - see this file's git history if you need them back.

**Every entity in this API returns 0 rows in this system, checked with no filter at all** across the header and all 3 joins below - not scoped to company code 7827, genuinely empty system-wide for this user, the same pattern found for production orders. This means the design below is verified for field *names* only, not for real data - unlike everything else in this file. It was implemented anyway, by explicit choice, to keep this source on a standard API rather than custom ABAP even though this system doesn't currently use the SAP application behind it (most likely `ZMWC_R2R_ACCPLN` existed precisely because it didn't).

- **Needs 4 entities, not 1 or 2.** Unlike GR/IR (one entity) or the checklist (one entity + one join), an accrual object's description, target amount, cost center and period-by-period amount each live in a separate entity: `MnlAccrsAccrualSubobject` (header - `AccrualObjectDescription`), `MnlAccrsAccrSubobjItem` (`TotalAccrAmountInTransCrcy`, `TransactionCurrency`), `MnlAccrsAccrSubobjAssgmt` (`CostCenter`), `MnlAccrsAccrPerdcAmounts` (`AccrualAmtInTransCrcy`, `AccrualPeriodEndDate`). All 4 correlate by `(AccrualObject, AccrualSubobject)` - a **composite key**, since neither field alone is unique. `mergeJoinedRows` and `fetchSource` (`src/lib/sapClient.js`, `mcp/closeData.mjs`) were generalized from one optional `join` to a `joins` array, and `mergeJoinedRows`'s `key` parameter now accepts an array of field names for exactly this case.
- **No field for "actually posted to GL".** This API models a proposal → review → approval workflow (`AccrualAmountIsReviewed`, `AccrualAmountIsApproved`, both real booleans), not a posted-vs-planned GL comparison. `fields.postedAmount` uses `AccrualAmtInTransCrcy` (the period's recorded/adjusted accrual amount) as the closest available proxy - it confirms a value was *set* for the period, not that a posting run actually happened. This is a modeling approximation that a real accrual object would be needed to validate.
- **Known simplification**: if a subobject has more than one `MnlAccrsAccrPerdcAmounts` row (multiple periods, item types or ledgers) or more than one `MnlAccrsAccrSubobjItem` row, `mergeJoinedRows` keeps only the last one read for that key - silently, since there's no real data here to reveal whether this matters in practice.

## Verify these at activation

I wrote these views without access to your system. Names are based on standard S/4HANA, but press **F2** on anything ADT underlines. These are the points most likely to need a change:

- **`VBSEG*.BZKEY`**: this is the parked line number field. If the name differs, it only matters as a key and can be dropped.
- **SQL view name** (`ZIR2RPARKDOC`) must be unique in the system and at most 16 characters.
- **Amounts stay as currency amounts (CURR) throughout** instead of being cast to decimals. This means OData applies the right number of decimals for currencies like JPY, which has 0 decimals.

## Authorizations (PFCG)

A user who runs the dashboard needs:

- **`S_SERVICE`**: start authorization for each service, including the 5 standard ones (`API_INSPECTIONLOT_SRV`, `API_PRODUCTION_ORDER_2_SRV`, `API_MAINTENANCEORDER`, `API_OPLACCTGDOCITEMCUBE_SRV`, `API_MANUALACCRUALS`). In PFCG, go to Menu → Authorization Default → *SAP Gateway: Service Groups Metadata* and add all 6. Without it, calls return 403 and `SU53` shows `S_SERVICE`.
- **`F_BKPF_BUK`**, activity `03`, for the company codes they should see. The 1 remaining custom view's access control filters by this, so users without it get 0 rows rather than an error - same check as FB03 and FBL3N. `API_INSPECTIONLOT_SRV` has its own standard QM authorization instead (e.g. `Q_QMEL`/plant-based authorization) - check with your QM team what your users already need for IQS1/IQS21, since this API enforces the same. `API_PRODUCTION_ORDER_2_SRV` and `API_MAINTENANCEORDER` similarly have their own standard PP/PM order-authorization objects, not `F_BKPF_BUK` - I haven't checked their exact names against this system (unlike everything else in this file, which has been checked live), so verify with your PP/PM team what your users need for CO03/IW33 before assuming a new user can see this data. `API_OPLACCTGDOCITEMCUBE_SRV` reads the same universal journal data as `F_BKPF_BUK`-protected FI documents; this session's user returned real data from both of those without a separate PFCG change, but confirm with your Basis team before assuming that holds for every user. `API_MANUALACCRUALS`'s own authorization requirements are unverified here too, on top of returning no data at all for this session's user - check with your FI/controlling team once this system actually has accrual objects to test with.

## Test URLs (`/IWFND/GW_CLIENT` or a browser)

```
/sap/opu/odata/sap/ZI_R2R_PARKEDDOCUMENT_CDS/ZI_R2R_ParkedDocument?$filter=CompanyCode eq '1000' and FiscalYear eq '2026' and FiscalPeriod eq '009'&$format=json
/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/$metadata
/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot?$top=5&$format=json
/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspLotUsageDecision?$top=5&$format=json
/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/$metadata
/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2?$filter=CompanyCode eq '7827'&$top=5&$format=json
/sap/opu/odata/sap/API_MAINTENANCEORDER/$metadata
/sap/opu/odata/sap/API_MAINTENANCEORDER/MaintenanceOrder?$filter=CompanyCode eq '7827'&$top=5&$format=json
/sap/opu/odata/sap/API_OPLACCTGDOCITEMCUBE_SRV/$metadata
/sap/opu/odata/sap/API_OPLACCTGDOCITEMCUBE_SRV/A_OperationalAcctgDocItemCube?$filter=CompanyCode eq '7827' and GLAccount eq '241101001' and IsCleared eq false&$top=5&$format=json
/sap/opu/odata/sap/API_MANUALACCRUALS/$metadata
/sap/opu/odata/sap/API_MANUALACCRUALS/MnlAccrsAccrualSubobject?$filter=CompanyCode eq '7827'&$top=5&$format=json
```

## Unposted/parked documents: checked for a standard API, staying on custom ABAP for now

Searched this system's SAP Gateway service catalog live (`/api/catalog?keyword=...` in `web/server.mjs`, querying `/IWFND/CATALOGSERVICE;v=2`) rather than guessing technical service names one at a time - this finds what's actually *registered*, not just what a given release *could* ship. None of `PARK`, `HELD`, `DRAFT`, `SUSPENSE`, `PRELIM`, `ACCOUNTINGDOC`, `JOURNALENTRY`, `BKPF` turned up anything for FI-side parked documents besides this repo's own `ZI_R2R_PARKEDDOCUMENT_CDS`. This only searches OData V2 services, so it can't see a V4-only service if one exists but isn't registered under a matching name either way - a real gap in this check, not a finding that no such API exists anywhere.

One genuinely well-documented SAP standard API is relevant to a gap this source already has, not a replacement for it: **`API_SUPPLIERINVOICE_PROCESS_SRV`** covers MM-side supplier invoices parked via MIR7 (stored in `RBKP`/`RSEG`, which `ZI_R2R_ParkedDocItem` doesn't read - see the limit below). It isn't registered in this system either, so nothing has been verified or built against it. Given Basis activated the GR/IR candidates once they were identified, it may be worth asking them to register this one the same way - then its fields should be checked against real `$metadata`/data before wiring it up, the same as everything else in this file.

## Known limits and design decisions

- **Parked documents cover FI only.** Supplier invoices parked in MM (MIR7) are stored in `RBKP/RSEG`, not `BKPF/VBSEG*`, so they don't appear yet - see the section above for a possible standard-API candidate.
- **Known caveat, found by checking real data: the current-period filter hides old parked documents.** `sources.unposted`'s `$filter` includes `FiscalYear eq '{fiscalYear}' and FiscalPeriod eq '{period}'`, so this tab only ever shows documents parked *in the current period* - when nothing's been parked this period, the tab (and its aging-bucket chart) is legitimately empty, not broken. But a parked document has no real "period" concept the way an accrual does - it just sits in `BKPF` until someone posts or deletes it, however old. Checked live with just `CompanyCode eq '7827'` (no period filter): this company has parked documents going back to 2015, including two from 2018 - `AmountInCompanyCodeCurrency` ¥5,108,592,959 and ¥6,528,520,733 (`DocumentHeaderText`: "Q2/Q4法人税計上", corporate tax accrual entries) - both still `DocumentStatus: 'V'` (parked), never posted or cleared, years later. The current period-scoped filter would never surface either one. Kept as-is - the period scope was a deliberate choice to keep this tab focused on the *current* close rather than every historically-parked document, but it means a forgotten multi-billion-yen parked document from years ago won't show up here.
- **Direct table access.** The parked-document views read `BKPF`, `VBSEG*` and `T030` directly, because I don't know of a released view that covers parked line amounts or account determination. That's fine on-premise and on RISE, but not under ABAP Cloud (Tier 1). GR/IR and accruals no longer touch custom ABAP at all (see their sections above).
- **GR/IR amounts are signed as posted.** GR is a credit (negative), and the dashboard flips it (`"signedAmounts": true`). Items that net to zero but are still uncleared (waiting for F.13) are returned by the API (since each side is a separate open line until cleared), and `analyzeGrir` hides the ones that net to zero after `aggregateGrirLineItems` sums them per PO item.
- **Accruals has no real data to validate against in this system.** See the Accruals section above - the field mapping and 4-way join are best-effort against real `$metadata` only. If your system does use the Accrual Engine, double-check the join keys and the `postedAmount` proxy against an actual accrual object before relying on this tab.
- **The close checklist is EAM inspection-lot status, not a generic finance task list.** Each row is one QM inspection lot; "closed" means a Usage Decision exists, whichever way it went - there's no separate "rejected/failed" state (see the checklist section above). There's no owner field either.
- **If you'd rather track a generic finance checklist** (post accruals, run FX valuation, lock the period, ...) instead of or alongside this EAM one, that's the manually maintained approach from before, built on a Z table and a custom CDS view - see this file's git history (before the switch to `API_INSPECTIONLOT_SRV`) for `ZMWC_R2R_CLTASK` and `ZI_R2R_CloseTask`.
