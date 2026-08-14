using {sap.capire.bookshop as my} from '../db/schema';

/**
 * Service-level authorization test services.
 * Each service annotates its own definition (not entities) so we can verify
 * service-level @requires / @restrict enforcement mirroring CAP's HTTP
 * `authorize` semantics (dev = public / prod = 'authenticated-user' when
 * @restrict clauses carry no `to`).
 *
 * Each is exposed via both @odata and @mcp for parity checks.
 */

@odata
@mcp
@requires: 'admin'
service ServiceRequiresAdmin {
  entity Books as projection on my.Books { ID, title } where ID < 1000;
}

@odata
@mcp
@restrict: [{ grant: 'READ', to: 'admin' }]
service ServiceRestrictAdmin {
  entity Books as projection on my.Books { ID, title } where ID < 1000;
}

@odata
@mcp
@restrict: [{ grant: 'READ' }] // no `to` — falls to CAP env fallback
service ServiceRestrictNoTo {
  entity Books as projection on my.Books { ID, title } where ID < 1000;
}

@odata
@mcp
@restrict: [{ grant: 'READ', to: ['admin', 'editor'] }]
service ServiceRestrictAdminOrEditor {
  entity Books as projection on my.Books { ID, title } where ID < 1000;
}
