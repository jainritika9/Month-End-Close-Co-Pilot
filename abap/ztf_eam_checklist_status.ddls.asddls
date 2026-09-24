@EndUserText.label: 'MWC R2R - EAM checklist status (table function)'
@ClientHandling.type: #CLIENT_DEPENDENT
@AccessControl.authorizationCheck: #NOT_REQUIRED
// From EAM_Checklist_Status_Table_Function.docx, kept as close to that "ready-to-use" source as
// possible. One row per QM inspection lot (QALS) - close-related EAM checklists (equipment /
// maintenance-order inspections) that must be closed with a Usage Decision before month-end.
//
// One addition beyond the original doc: BUKRS (company code), read via the AUFK join already in
// the AMDP. It doesn't exist on QALS itself; it's needed so ZI_R2R_CloseTask (which reads this
// table function) can filter by company code and apply the same row-level access control as the
// other 3 close-copilot views. Verify AUFK-BUKRS exists in your release (SE11) before activating.
define table function ZTF_EAM_CHECKLIST_STATUS
  with parameters
    @Environment.systemField: #CLIENT
    p_client   : abap.clnt,
    p_aufnr    : aufnr,          // optional - Order
    p_werks    : werks_d,        // optional - Plant
    p_fromdate : abap.dats,      // optional - From Date
    p_todate   : abap.dats       // optional - To Date
  returns {
    client          : mandt;
    prueflos        : qplos;           // Inspection Lot
    aufnr           : aufnr;           // Maintenance Order
    bukrs           : bukrs;           // Company Code (via AUFK - verify it exists in SE11)
    vornr           : vornr;           // Operation
    equnr           : equnr;           // Equipment
    tplnr           : tplnr;           // Functional Location
    matnr           : matnr;
    werks           : werks_d;
    art             : qart;            // Inspection Type
    herkunft        : qherk;           // Lot Origin
    enstehdat       : qentst;          // Creation Date
    ud_code         : qvcode;          // Usage Decision Code
    ud_date         : qvedat;          // Usage Decision Date
    status_ud       : abap.char(1);    // 'X' = UD made
    status_short    : abap.char(4);    // Short status
    status_long     : abap.char(30);   // Long status
    closed_flag     : abap.char(1);    // Closed indicator
  }
  implemented by method
    zcl_tf_eam_checklist_status=>get_checklist_status;
