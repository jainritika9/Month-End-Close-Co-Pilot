@AbapCatalog.sqlViewName: 'ZIR2RCLTASK'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'MWC R2R - Close checklist task'
@Metadata.ignorePropagatedAnnotations: true
// DDIC-based view (not a view entity) because @OData.publish only works on these.
// Generates OData V2 service ZI_R2R_CLOSETASK_CDS, entity set ZI_R2R_CloseTask.
@OData.publish: true
define view ZI_R2R_CloseTask
  as select from zmwc_r2r_cltask
{
      // Element names match the co-pilot's "checklist" source mapping
      // (config/default-config.json), so the extension needs no field changes.
  key bukrs        as CompanyCode,
  key gjahr        as FiscalYear,
  key poper        as FiscalPeriod,
  key task_id      as TaskID,
      task_name    as TaskName,
      category     as TaskCategory,
      responsible  as ResponsiblePerson,
      // O = open, I = in process, C = completed, E = error
      status       as Status,
      planned_end  as PlannedEndDate,
      completed_on as CompletedDate,
      completed_by as CompletedByUser,
      note         as Note
}
