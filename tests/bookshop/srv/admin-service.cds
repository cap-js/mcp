using {sap.capire.bookshop as my} from '../db/schema';

@odata @mcp
service AdminService {
  entity Authors as projection on my.Authors;
  @odata.draft.enabled
  entity Books   as projection on my.Books;
  entity Genres  as projection on my.Genres;
}
