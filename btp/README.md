# Month-end close co-pilot on SAP BTP (Fiori launchpad tile)

Written for: the SAP Basis team deploying this to the BTP subaccount that serves the Fiori launchpad.

This is the close dashboard (checklist, unposted documents, open GR/IR, accruals) as a BTP HTML5 app, served through an approuter. Users open it from a launchpad tile. The browser reads the SAP OData services through the approuter, so SAP sees each user's own identity. There is no SAP password in the app and no server of ours in the path.

The Claude Code plugin (`mcp/`, the slash commands) is **not** part of this deployment. It runs inside Claude Code only.

```
btp/
  mta.yaml                  deployment descriptor (3 modules, 4 services)
  xs-security.json          XSUAA: the "Close Co-Pilot Viewer" role
  approuter/xs-app.json     routes: /sap/* -> SAP destination "sap-rise"; everything else -> the app
  approuter/package.json    approuter (@sap/approuter 23.3.0)
  app.js, browser-snapshot.js   the browser app (uses the shared src/ modules)
tools/build-btp.mjs         builds the static site into btp/dist/ (run by the MTA build)
```

## 1. Before you start

- A BTP subaccount with a Cloud Foundry space, and entitlements for: HTML5 Apps Repository (`app-host`, `app-runtime`), Authorization & Trust Management / XSUAA (`application`), Destination (`lite`). Add SAP Build Work Zone if the launchpad is Work Zone.
- Network path from BTP to the SAP system. The SAP host (`vhc2jq4rci.rise.ccbji.co.jp`, port 8000) resolves only on the corporate network, so BTP needs a Cloud Connector (or the RISE connectivity SAP provides) that exposes it to the subaccount. Basis confirms this first.
- The OData services are registered and authorized in SAP. The five standard APIs plus the parked-document view, with the `S_SERVICE` and other authorizations, are listed in [abap/README.md](../abap/README.md) (sections "Test URLs" and "Authorizations").
- **Decide the default `demoMode` before building.** The build bundles `config/default-config.json` exactly as it is in the repo. Set `"demoMode": false` and commit it first, or the tile shows sample data.

## 2. Build the archive

On a machine with Node 20+ and GNU `make` (mbt uses `make`, which isn't on a default Windows PATH; use Linux, macOS, WSL or a CI runner):

```
cd btp
npx mbt@1.2.49 build        # writes mta_archives/closecopilot_1.0.0.mtar
```

The MTA build runs `node ../tools/build-btp.mjs`, which writes `btp/dist/`. Git ignores both output folders.

## 3. Deploy

```
cf login -a <cf API endpoint> -o <org> -s <space>
cf deploy mta_archives/closecopilot_1.0.0.mtar
```

This creates the approuter app, the HTML5 app repository, the XSUAA instance and the Destination instance.

## 4. Create the SAP destination `sap-rise`

The name must match `approuter/xs-app.json`. In the BTP cockpit: **Connectivity → Destinations → New Destination**.

| Field | Value |
|---|---|
| Name | `sap-rise` |
| Type | HTTP |
| URL | `http://vhc2jq4rci.rise.ccbji.co.jp:8000` (no path) |
| Proxy type | `OnPremise` if it goes through the Cloud Connector, otherwise `Internet` |
| Authentication | see below |

Pick one authentication method. This decides **whose SAP authorizations apply**:

- **`OAuth2SAMLBearerAssertion` (principal propagation) — recommended.** Each viewer reads SAP as themselves, so SAP's own authorizations (`S_SERVICE`, `F_BKPF_BUK`, the PP/PM/QM order authorizations) limit what each person sees. Needs a SAML trust between the subaccount's identity provider and SAP, and principal propagation set up in the Cloud Connector.
- **`BasicAuthentication` (technical user).** Every viewer reads SAP as one SAP user, so everyone sees what that user can see. Use this only if the security team accepts it. Enter the user and password here in the destination, never in the repo.

## 5. Give users access

In the BTP cockpit: **Security → Role Collections → New**, name it `Close Co-Pilot Viewer`, add the role `CloseCopilotViewer` (from the `closecopilot-ui` app), and assign it to the user groups that should see the dashboard. Users without it are refused at the approuter, before any SAP call.

## 6. Add the tile to the launchpad

Two users must be able to reach the app: the SAP user needs the tile (launchpad role), and the BTP user needs the **Close Co-Pilot Viewer** role collection (section 5). Use 6a if the launchpad is the ABAP Fiori launchpad, which is the case when the system's launchpad path is `/sap/bc/ui2/flp` (as in `config/default-config.json`). Use 6b only if the launchpad is SAP Build Work Zone.

### 6a. ABAP Fiori launchpad: URL tile

The tile opens the approuter URL in a new browser tab.

0. Get the URL after deployment: `cf app closecopilot-approuter`, then use the route, `https://<route>/`. It is not the BTP HTML5 app URL.
1. In the SAP system (client 100), open `/UI2/FLPD_CUST` (Launchpad Designer). Save changes into a customizing transport request.
2. **Catalog:** create a catalog, e.g. ID `ZCLOSECOPILOT_CAT`, title "Close Co-Pilot".
3. **Tile:** in that catalog, add an **App Launcher - Static** tile with title "Month-End Close Co-Pilot" and a subtitle and icon of your choice. Under navigation, use semantic object navigation with semantic object `ZCloseCopilot` and action `display`.
4. **Target mapping:** in the catalog's Target Mappings, create one with the same semantic object and action (`ZCloseCopilot` / `display`). Application type `URL`, URL = the approuter URL from step 0, open in a new window. A URL target doesn't need the System Alias; set it only if your release insists on the field, then use `LOCAL`.
5. **Role:** Basis assigns the catalog to a PFCG role (e.g. `Z_FIORI_CLOSECOPILOT`), generates the profile and assigns the role to the test users. Add the tile to a group and assign that group to the same role if you want it on the home page.

### 6b. SAP Build Work Zone

1. Confirm the deployed app appears in **HTML5 Applications** as `closecopilot-ui`.
2. In the launchpad's content management, add that application and create a tile: title "Month-End Close Co-Pilot", target = this application.
3. Put the tile in a group and attach that group to the **Close Co-Pilot Viewer** role collection, so the tile and the app are granted to the same users.

## 7. Check it works

1. Open the tile, sign in through the identity provider, and confirm the dashboard appears with "Synced …" and no banner.
2. A card showing `Could not load: SAP returned 403` means an SAP authorization is missing. Check `S_SERVICE` and the list in abap/README.md.
3. A banner of "Could not reach SAP" points at the destination or the Cloud Connector.
4. "Your sign-in has expired" means reload the page.

## 8. Updates

Change the repo, build again, and deploy the new archive. Bump `version` in `mta.yaml` each time.

## Known limits

- The bundle contains the same settings as the Chrome extension, minus the SAP host name. Settings are changed by rebuilding, not from the page.
- Data limits from [abap/README.md](../abap/README.md) still apply, for example the 365-day window on maintenance orders and the empty accruals API in the current system.
- This repo has been checked with demo data and with a stubbed SAP OData endpoint in headless Edge, and the MTA descriptor passed `mbt`'s parser. It has **not** been deployed to a BTP subaccount or run against the real SAP system.
