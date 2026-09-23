@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MWC R2R - Posted amounts for accrual check'
@Metadata.ignorePropagatedAnnotations: true
// Helper, not exposed. Leading-ledger postings summed at the grain the accrual plan uses:
// company code / fiscal year / period / G/L account / cost center / document type.
// Reversals net out, so an accrual posted and reversed in the same period counts as missing.
// Only ever read through the join in ZI_R2R_AccrualCheck, which restricts it to planned combinations.
define view entity ZI_R2R_AccrualPosted
  as select from I_JournalEntryItem
{
  key CompanyCode,
  key FiscalYear,
  key FiscalPeriod,
  key GLAccount,
  key CostCenter,
  key AccountingDocumentType,
  key CompanyCodeCurrency,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( AmountInCompanyCodeCurrency ) as PostedAmount
}
where
  Ledger = '0L'
group by
  CompanyCode,
  FiscalYear,
  FiscalPeriod,
  GLAccount,
  CostCenter,
  AccountingDocumentType,
  CompanyCodeCurrency
