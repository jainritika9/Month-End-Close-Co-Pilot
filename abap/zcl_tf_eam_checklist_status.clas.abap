"! AMDP implementation for ZTF_EAM_CHECKLIST_STATUS. From EAM_Checklist_Status_Table_Function.docx,
"! unchanged except for the added bukrs (company code) column - see that field's comment in the
"! table function for why it's there.
"!
"! Notes carried over from the doc, still worth keeping in mind:
"! - Classic ABAP function modules (e.g. EAM_CL_API_READ_LOTS) cannot be called inside AMDP; this
"!   reads the tables directly instead.
"! - "Closed" here means a Usage Decision exists (QALS-VCODE is not blank). That doesn't
"!   distinguish an accepted from a rejected UD, so there is no "error/rejected" state - only
"!   open vs. closed. Enhance with the specific decision codes if you need that distinction.
"! - Only lots linked to a maintenance order (AUFNR filled) get a company code via this join, so
"!   only those lots pass the ZI_R2R_CloseTask access control and appear on the dashboard.
CLASS zcl_tf_eam_checklist_status DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.

    CLASS-METHODS get_checklist_status
      FOR TABLE FUNCTION ztf_eam_checklist_status.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.



CLASS zcl_tf_eam_checklist_status IMPLEMENTATION.

  METHOD get_checklist_status
    BY DATABASE FUNCTION
    FOR HDB
    LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY
    USING qals jest tj02t aufk afvc.

    lt_result =
      SELECT
        q.mandt                                          AS client,
        q.prueflos,
        q.aufnr,
        a.bukrs                                          AS bukrs,
        q.vornr,
        q.equnr,
        q.tplnr,
        q.matnr,
        q.werks,
        q.art,
        q.herkunft,
        q.enstehdat,
        q.vcode                                          AS ud_code,
        q.vaedat                                         AS ud_date,

        CASE WHEN q.vcode IS NOT NULL AND q.vcode <> ''
             THEN 'X' ELSE '' END                        AS status_ud,

        COALESCE( t.txt04, '' )                          AS status_short,
        COALESCE( t.txt30, '' )                          AS status_long,

        CASE WHEN q.vcode IS NOT NULL AND q.vcode <> ''
             THEN 'X' ELSE '' END                        AS closed_flag

      FROM qals AS q
        LEFT OUTER JOIN jest AS j
          ON  j.objnr = q.objnr
          AND j.inact = ''
        LEFT OUTER JOIN tj02t AS t
          ON  t.istat = j.stat
          AND t.spras = 'E'
        LEFT OUTER JOIN aufk AS a
          ON a.aufnr = q.aufnr
        LEFT OUTER JOIN afvc AS o
          ON  o.aufpl = q.aufpl
          AND o.aplzl = q.aplzl

      WHERE q.mandt = :p_client
        AND ( :p_aufnr   = '' OR q.aufnr   = :p_aufnr )
        AND ( :p_werks   = '' OR q.werks   = :p_werks )
        AND ( :p_fromdate = '00000000' OR q.enstehdat >= :p_fromdate )
        AND ( :p_todate   = '00000000' OR q.enstehdat <= :p_todate );

    RETURN :lt_result;

  ENDMETHOD.

ENDCLASS.
