using {sap.capire.bookshop as my} from '../db/schema';

/**
 * Service for testing all @requires / @restrict annotation combinations.
 * Exposed via both @odata and @mcp so results can be compared directly.
 */
@odata
@mcp
service AuthTestService {
  // --- entity-level @requires ---
  // @requires: 'admin'  ≡  @restrict: [{ grant: '*', to: 'admin' }]
  entity RequiresAdmin  as projection on my.Books   { ID, title, stock } where ID < 1000;

  // @requires with multiple roles (OR logic) — admin OR editor
  entity RequiresAdminOrEditor as projection on my.Authors { ID, name };

  // --- entity-level @restrict with explicit READ grant ---
  entity RestrictReadAdmin   as projection on my.Books   { ID, title, stock } where ID < 1000;
  entity RestrictReadEditor  as projection on my.Authors { ID, name };

  // @restrict with wildcard grant '*'
  entity RestrictStarAdmin   as projection on my.Books   { ID, title, stock } where ID < 1000;

  // @restrict with WRITE-only grant — READ has no explicit grant, so READ is denied (CAP behaviour:
  // any @restrict annotation locks down access; only explicitly granted operations are allowed)
  entity RestrictWriteAdmin  as projection on my.Books   { ID, title, stock } where ID < 1000;

  // @restrict with no 'to' clause — 'any' pseudo-role, accessible to everyone incl. unauthenticated
  entity RestrictNoTo        as projection on my.Genres  { ID, name };

  // @restrict with multiple roles in one privilege
  entity RestrictMultiRole   as projection on my.Books   { ID, title, stock } where ID < 1000;

  // @restrict with multiple privileges (admin READ or editor READ)
  entity RestrictMultiPrivilege as projection on my.Authors { ID, name };

  // Both @requires (admin) AND @restrict (editor READ) — @requires wins because it is checked first
  // and is shorthand for grant:* — an entity has either @requires or @restrict, not both
  // (testing @requires alone is sufficient; this entity tests that @requires gates correctly)
  entity RequiresAndRestrictAdmin as projection on my.Books { ID, title, stock } where ID < 1000;

  // --- action-level @requires ---
  @description: 'Admin-only action'
  action adminAction(x: Integer) returns Integer;

  @description: 'Editor-only action'
  action editorAction(x: Integer) returns Integer;

  @description: 'Open action (no auth)'
  action openAction(x: Integer) returns Integer;

  // --- action-level @restrict ---
  @description: 'Action restricted via @restrict to admin'
  action restrictedAction(x: Integer) returns Integer;
}

// entity-level @requires
annotate AuthTestService.RequiresAdmin with @(requires: 'admin');
annotate AuthTestService.RequiresAdminOrEditor with @(requires: ['admin', 'editor']);

// entity-level @restrict
annotate AuthTestService.RestrictReadAdmin with @(restrict: [{ grant: 'READ', to: 'admin' }]);
annotate AuthTestService.RestrictReadEditor with @(restrict: [{ grant: 'READ', to: 'editor' }]);
annotate AuthTestService.RestrictStarAdmin with @(restrict: [{ grant: '*', to: 'admin' }]);
annotate AuthTestService.RestrictWriteAdmin with @(restrict: [{ grant: 'WRITE', to: 'admin' }]);
annotate AuthTestService.RestrictNoTo with @(restrict: [{ grant: 'READ' }]);
annotate AuthTestService.RestrictMultiRole with @(restrict: [{ grant: 'READ', to: ['admin', 'editor'] }]);
annotate AuthTestService.RestrictMultiPrivilege with @(restrict: [
  { grant: 'READ', to: 'admin' },
  { grant: 'READ', to: 'editor' }
]);
annotate AuthTestService.RequiresAndRestrictAdmin with @(requires: 'admin');

// action-level @requires
annotate AuthTestService.adminAction with @(requires: 'admin');
annotate AuthTestService.editorAction with @(requires: 'editor');

// action-level @restrict (grant is ignored on actions, only 'to' matters)
annotate AuthTestService.restrictedAction with @(restrict: [{ grant: 'READ', to: 'admin' }]);
