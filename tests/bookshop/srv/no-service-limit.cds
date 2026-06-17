using {sap.capire.bookshop as my} from '../db/schema';

service NoServiceLimitService {
  @cds.query.limit: 0
  entity DisabledBooks as projection on my.Books;

  entity NormalBooks as projection on my.Books;
}

annotate NoServiceLimitService with @mcp;
