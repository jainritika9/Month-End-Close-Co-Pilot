@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MWC R2R - GR/IR clearing accounts'
@Metadata.ignorePropagatedAnnotations: true
// Helper, not exposed. The GR/IR clearing account(s) per chart of accounts, read from automatic
// account determination (OBYC, transaction key WRX) so nobody has to maintain an account list.
// DISTINCT because T030 holds one row per valuation modifier / valuation class and the same
// account usually repeats - without it the join in ZI_R2R_GRIRBalance would multiply amounts.
// Add further keys (e.g. FR1/FR3 freight clearing) here if you want those in the dashboard too.
define view entity ZI_R2R_GRIRAccount
  as select distinct from t030
{
  key ktopl as ChartOfAccounts,
  key konts as GLAccount
}
where
      ktosl =  'WRX'
  and konts <> ''
