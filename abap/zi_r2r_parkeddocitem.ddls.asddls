@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MWC R2R - Parked document debit lines'
@Metadata.ignorePropagatedAnnotations: true
// Helper, not exposed. Debit lines of FI parked documents across the four parked-item tables
// (G/L, supplier, customer, asset). Summing the debits gives the document total, whatever the
// document type. No released CDS view carries parked line amounts, hence direct table access
// (fine on-premise / RISE; would need rework under ABAP Cloud).
// BKPF is joined only to get the company code currency for the amount's currency reference.
// MM parked supplier invoices (MIR7) live in RBKP/RSEG, not here - see README.
define view entity ZI_R2R_ParkedDocItem
  as select from vbsegs
    inner join   bkpf on  bkpf.bukrs = vbsegs.ausbk
                      and bkpf.belnr = vbsegs.belnr
                      and bkpf.gjahr = vbsegs.gjahr
{
  key vbsegs.ausbk as CompanyCode,
  key vbsegs.belnr as AccountingDocument,
  key vbsegs.gjahr as FiscalYear,
  key vbsegs.bzkey as ParkedLineItem,
      cast( 'S' as abap.char( 1 ) ) as ParkedLineType,
      bkpf.hwaer   as CompanyCodeCurrency,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      vbsegs.dmbtr as DebitAmount
}
where vbsegs.shkzg = 'S'

union all

select from vbsegk
  inner join bkpf on  bkpf.bukrs = vbsegk.ausbk
                  and bkpf.belnr = vbsegk.belnr
                  and bkpf.gjahr = vbsegk.gjahr
{
  key vbsegk.ausbk as CompanyCode,
  key vbsegk.belnr as AccountingDocument,
  key vbsegk.gjahr as FiscalYear,
  key vbsegk.bzkey as ParkedLineItem,
      cast( 'K' as abap.char( 1 ) ) as ParkedLineType,
      bkpf.hwaer   as CompanyCodeCurrency,
      vbsegk.dmbtr as DebitAmount
}
where vbsegk.shkzg = 'S'

union all

select from vbsegd
  inner join bkpf on  bkpf.bukrs = vbsegd.ausbk
                  and bkpf.belnr = vbsegd.belnr
                  and bkpf.gjahr = vbsegd.gjahr
{
  key vbsegd.ausbk as CompanyCode,
  key vbsegd.belnr as AccountingDocument,
  key vbsegd.gjahr as FiscalYear,
  key vbsegd.bzkey as ParkedLineItem,
      cast( 'D' as abap.char( 1 ) ) as ParkedLineType,
      bkpf.hwaer   as CompanyCodeCurrency,
      vbsegd.dmbtr as DebitAmount
}
where vbsegd.shkzg = 'S'

union all

select from vbsega
  inner join bkpf on  bkpf.bukrs = vbsega.ausbk
                  and bkpf.belnr = vbsega.belnr
                  and bkpf.gjahr = vbsega.gjahr
{
  key vbsega.ausbk as CompanyCode,
  key vbsega.belnr as AccountingDocument,
  key vbsega.gjahr as FiscalYear,
  key vbsega.bzkey as ParkedLineItem,
      cast( 'A' as abap.char( 1 ) ) as ParkedLineType,
      bkpf.hwaer   as CompanyCodeCurrency,
      vbsega.dmbtr as DebitAmount
}
where vbsega.shkzg = 'S'
