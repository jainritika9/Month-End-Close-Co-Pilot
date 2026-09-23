@AbapCatalog.sqlViewName: 'ZIR2RPARKDOC'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'MWC R2R - Parked FI documents'
@Metadata.ignorePropagatedAnnotations: true
// DDIC-based view (not a view entity) because @OData.publish only works on these.
// Generates OData V2 service ZI_R2R_PARKEDDOCUMENT_CDS, entity set ZI_R2R_ParkedDocument.
// FI documents still parked: BSTAT V = parked, W = parked and saved as complete.
// (Z = parked and deleted, blank = posted - both excluded.)
@OData.publish: true
define view ZI_R2R_ParkedDocument
  as select from bkpf
    left outer join ZI_R2R_ParkedDocAmount as _Amount
      on  _Amount.CompanyCode        = bkpf.bukrs
      and _Amount.FiscalYear         = bkpf.gjahr
      and _Amount.AccountingDocument = bkpf.belnr
{
      // Element names match the co-pilot's "unposted" source mapping.
  key bkpf.bukrs                  as CompanyCode,
  key bkpf.gjahr                  as FiscalYear,
  key bkpf.belnr                  as AccountingDocument,
      // MONAT is NUMC 2; padded to 3 so it filters the same way as POPER-based
      // periods in the other services (FiscalPeriod eq '009').
      cast( concat( '0', bkpf.monat ) as abap.numc( 3 ) ) as FiscalPeriod,
      bkpf.blart                  as AccountingDocumentType,
      bkpf.bstat                  as DocumentStatus,
      bkpf.budat                  as PostingDate,
      bkpf.bldat                  as DocumentDate,
      bkpf.cpudt                  as EntryDate,
      bkpf.usnam                  as CreatedByUser,
      bkpf.xblnr                  as DocumentReferenceID,
      bkpf.bktxt                  as DocumentHeaderText,
      bkpf.hwaer                  as CompanyCodeCurrency,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      _Amount.DocumentAmount      as AmountInCompanyCodeCurrency
}
where
     bkpf.bstat = 'V'
  or bkpf.bstat = 'W'
