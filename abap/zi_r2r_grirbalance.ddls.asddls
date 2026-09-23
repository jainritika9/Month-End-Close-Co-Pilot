@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MWC R2R - Open GR/IR balance per PO item'
@Metadata.ignorePropagatedAnnotations: true
define view entity ZI_R2R_GRIRBalance
  as select from I_JournalEntryItem as Item
    inner join   ZI_R2R_GRIRAccount as Acct
      on  Acct.ChartOfAccounts = Item.ChartOfAccounts
      and Acct.GLAccount       = Item.GLAccount
{
  key Item.CompanyCode,
  key Item.GLAccount,
  key Item.PurchasingDocument     as PurchaseOrder,
  key Item.PurchasingDocumentItem as PurchaseOrderItem,
      Item.CompanyCodeCurrency,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when Item.ReferenceDocumentType = 'MKPF'
                then Item.AmountInCompanyCodeCurrency end )  as GoodsReceiptAmount,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( case when Item.ReferenceDocumentType <> 'MKPF'
                then Item.AmountInCompanyCodeCurrency end )  as InvoiceReceiptAmount,

      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      sum( Item.AmountInCompanyCodeCurrency )                as BalanceAmount,

      max( Item.PostingDate )                                as LastMovementDate
}
where
      Item.Ledger               =  '0L'
  and Item.ClearingJournalEntry =  ''
  and Item.PurchasingDocument   <> ''
group by
  Item.CompanyCode,
  Item.GLAccount,
  Item.PurchasingDocument,
  Item.PurchasingDocumentItem,
  Item.CompanyCodeCurrency
