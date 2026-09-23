@AbapCatalog.sqlViewName: 'ZIR2RGRIROPEN'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'MWC R2R - Open GR/IR items'
@Metadata.ignorePropagatedAnnotations: true
// DDIC-based view (not a view entity) because @OData.publish only works on these.
// Generates OData V2 service ZI_R2R_GRIROPENITEM_CDS, entity set ZI_R2R_GRIROpenItem.
// Open GR/IR per PO item with the supplier name. Items whose GR and IR already net to zero but
// are not yet cleared (F.13 / MR11 pending) are still returned; the co-pilot hides them.
@OData.publish: true
define view ZI_R2R_GRIROpenItem
  as select from ZI_R2R_GRIRBalance as Bal
    left outer join I_PurchaseOrderAPI01 as PO
      on PO.PurchaseOrder = Bal.PurchaseOrder
    left outer join I_Supplier as Sup
      on Sup.Supplier = PO.Supplier
{
      // Element names match the co-pilot's "grir" source mapping.
  key Bal.CompanyCode,
  key Bal.GLAccount,
  key Bal.PurchaseOrder,
  key Bal.PurchaseOrderItem,
      PO.Supplier,
      Sup.SupplierName,
      Bal.CompanyCodeCurrency,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      Bal.GoodsReceiptAmount,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      Bal.InvoiceReceiptAmount,
      @Semantics.amount.currencyCode: 'CompanyCodeCurrency'
      Bal.BalanceAmount,
      Bal.LastMovementDate
}
