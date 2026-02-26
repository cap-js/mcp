using {sap.capire.bookshop as my} from '../db/schema';

@cds.query.limit.default: 10
@cds.query.limit.max: 50
service LimitService {

  @cds.query.limit: { default: 5, max: 25 }
  entity FullLimitBooks as projection on my.Books;

  // Expected: default=10 (from service), max=15
  @cds.query.limit: 15
  entity MaxOnlyBooks as projection on my.Books;

  // Expected: default=3, max=30
  @cds.query.limit.default: 3
  @cds.query.limit.max: 30
  entity SeparateAnnotationBooks as projection on my.Books;

  // Expected: default=10 (from service), max=50 (from service)
  @cds.query.limit: 0
  entity DisabledLimitBooks as projection on my.Books;

  // Expected: default=10, max=50
  entity ServiceDefaultBooks as projection on my.Books;

  // Expected: default=10 (from service), max=100
  @cds.query.limit.max: 100
  entity MaxOverrideBooks as projection on my.Books;
}

annotate LimitService with @mcp;
