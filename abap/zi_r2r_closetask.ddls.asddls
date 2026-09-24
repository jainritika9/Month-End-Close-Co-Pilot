@AbapCatalog.sqlViewName: 'ZIR2RCLTASK'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'MWC R2R - Close checklist (EAM inspection lots)'
@Metadata.ignorePropagatedAnnotations: true
// DDIC-based view (not a view entity) because @OData.publish only works on these.
// Generates OData V2 service ZI_R2R_CLOSETASK_CDS, entity set ZI_R2R_CloseTask - same service and
// entity set as the old Z-table-backed version, so config/default-config.json's "checklist" path
// is unchanged; only its field mapping changed (see the README's EAM checklist section).
//
// Replaces ZMWC_R2R_CLTASK (manually maintained) with a real process: EAM (Plant Maintenance)
// quality inspection lots and their Usage Decision status, from ZTF_EAM_CHECKLIST_STATUS /
// ZCL_TF_EAM_CHECKLIST_STATUS (see those files - adapted from EAM_Checklist_Status_Table_Function.docx).
// Each row is one inspection lot, not a hand-typed task name.
//
// What does NOT carry over from the old model, by design of this data source:
// - ResponsiblePerson: no owner field exists at the inspection-lot level, so it is always blank.
// - Status only ever becomes 'C' (closed) or 'O' (open) - there is no "failed" equivalent, since
//   a Usage Decision is either made or not (see the AMDP class's header comment).
// - PlannedEndDate here is really the lot's CREATION date, not a due date. The extension is
//   configured (source.dueDateIsAge, thresholds.checklistSlaDays) to treat "overdue" as "open
//   longer than the SLA" instead of "past a due date" - see processing.js.
@OData.publish: true
define view ZI_R2R_CloseTask
  as select from ZTF_EAM_CHECKLIST_STATUS(
                   p_client   : $session.client,
                   p_aufnr    : '',
                   p_werks    : '',
                   p_fromdate : '00000000',
                   p_todate   : '00000000' )
{
      // Element names match the co-pilot's "checklist" source mapping.
  key bukrs                                                              as CompanyCode,
      // No fiscal-year/period field exists on an inspection lot; derived from the creation date
      // (enstehdat) so the extension's existing FiscalYear/FiscalPeriod filter keeps working
      // unchanged. Filtering on a derived value can't use a table index - fine at this data
      // volume, but revisit if the checklist section becomes slow on a large QALS table.
      substring( cast( enstehdat as abap.char( 8 ) ), 1, 4 )             as FiscalYear,
      concat( '0', substring( cast( enstehdat as abap.char( 8 ) ), 5, 2 ) ) as FiscalPeriod,
  key prueflos                                                           as TaskID,
      concat_with_space( 'Inspection lot', prueflos, 1 )                 as TaskName,
      art                                                                as TaskCategory,
      cast( '' as abap.char( 40 ) )                                      as ResponsiblePerson,
      case when closed_flag = 'X' then 'C' else 'O' end                  as Status,
      enstehdat                                                          as PlannedEndDate,
      ud_date                                                            as CompletedDate,
      cast( '' as abap.char( 12 ) )                                      as CompletedByUser,
      status_long                                                        as Note
}
