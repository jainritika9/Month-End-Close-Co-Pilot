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
    USING qals qave jest tj02t aufk afvc.

    lt_result =
      select
        :p_client                                        as client,
        q.prueflos,
        q.aufnr,
        coalesce( a.bukrs, '' )                          as bukrs,
        coalesce( o.vornr, '' )                          as vornr,      -- from afvc
        q.ls_equnr,                                                       
        q.ls_tplnr,                                                       
        q.matnr,
        q.werk,
        q.art,
        q.herkunft,
        q.enstehdat,
        coalesce( ud.vcode, '' )                         as ud_code,    -- from qave
        ud.vdatum                                        as ud_date,    -- from qave (vdatum)

        CASE when ud.vcode is not null and ud.vcode <> ''
             then 'X' else '' end                        as status_ud,

        coalesce( t.txt04, '' )                          as status_short,
        coalesce( t.txt30, '' )                          as status_long,

        case when ud.vcode is not null and ud.vcode <> ''
             then 'X' else '' end                        as closed_flag

      from qals as q

        -- Usage Decision (code + date)
        LEFT OUTER JOIN qave AS ud
          ON  ud.prueflos = q.prueflos
          and ud.kzart    = 'L'              -- l = Usage decision for inspection lot

        -- SYSTEM status
        LEFT OUTER JOIN jest AS j
          ON  j.objnr = q.objnr
          and j.inact = ''

        LEFT OUTER JOIN tj02t AS t
          ON  t.istat = j.stat
          and t.spras = 'E'

        -- Order header (for Company Code)
        LEFT OUTER JOIN aufk AS a
          ON  a.aufnr = q.aufnr

        -- Operation (for vornr)
        LEFT OUTER JOIN afvc AS o
          ON  o.aufpl = q.aufpl
          and o.aplzl = q.aplzl

      where 
        ( :p_aufnr   = '' OR q.aufnr   = :p_aufnr )
        AND ( :p_werks   = '' OR q.werk   = :p_werks )
        AND ( :p_fromdate = '00000000' OR q.enstehdat >= :p_fromdate )
        AND ( :p_todate   = '00000000' OR q.enstehdat <= :p_todate );

    RETURN :lt_result;

  ENDMETHOD.

ENDCLASS.
