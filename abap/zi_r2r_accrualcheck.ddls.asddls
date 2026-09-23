@AbapCatalog.sqlViewName: 'ZIR2RACCRCHK'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'MWC R2R - Accrual plan vs posted'
@Metadata.ignorePropagatedAnnotations: true
// DDIC-based view (not a view entity) because @OData.publish only works on these.
// Generates OData V2 service ZI_R2R_ACCRUALCHECK_CDS, entity set ZI_R2R_AccrualCheck.
// Planned accruals (ZMWC_R2R_ACCPLN) with what was actually posted for the same
// G/L account + cost center + document type in the period. PostedAmount is null when nothing
// was posted - the co-pilot reads that as a missing accrual.
// Assumes the plan is kept in company code currency (see the table's comments).
@OData.publish: true
define view ZI_R2R_AccrualCheck
  as select from zmwc_r2r_accpln as Plan
    left outer join ZI_R2R_AccrualPosted as Posted
      on  Posted.CompanyCode            = Plan.bukrs
      and Posted.FiscalYear             = Plan.gjahr
      and Posted.FiscalPeriod           = Plan.poper
      and Posted.GLAccount              = Plan.gl_account
      and Posted.CostCenter             = Plan.cost_center
      and Posted.AccountingDocumentType = Plan.doc_type
{
      // Element names match the co-pilot's "accruals" source mapping.
  key Plan.bukrs          as CompanyCode,
  key Plan.gjahr          as FiscalYear,
  key Plan.poper          as FiscalPeriod,
  key Plan.accrual_id     as AccrualObject,
      Plan.description    as Description,
      Plan.gl_account     as GLAccount,
      Plan.cost_center    as CostCenter,
      Plan.doc_type       as AccountingDocumentType,
      Plan.currency       as CompanyCodeCurrency,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      Plan.planned_amount as PlannedAmount,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      Posted.PostedAmount as PostedAmount,
      Plan.due_date       as PostingDueDate,
      Plan.responsible    as ResponsiblePerson
}
