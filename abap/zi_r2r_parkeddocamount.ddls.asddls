@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MWC R2R - Parked document total'
@Metadata.ignorePropagatedAnnotations: true
// Helper, not exposed. Document total = sum of debit lines.
define view entity ZI_R2R_ParkedDocAmount
  as select from ZI_R2R_ParkedDocItem
{
  key CompanyCode,
  key FiscalYear,
  key AccountingDocument,
      CompanyCodeCurrency,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( DebitAmount ) as DocumentAmount
}
group by
  CompanyCode,
  FiscalYear,
  AccountingDocument,
  CompanyCodeCurrency
