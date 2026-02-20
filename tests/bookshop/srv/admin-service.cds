using {sap.capire.bookshop as my} from '../db/schema';

@odata @mcp
@requires: 'admin'
service AdminService {
  entity Authors as projection on my.Authors;
  @odata.draft.enabled
  entity Books   as projection on my.Books;
  entity Genres  as projection on my.Genres;

  @description: 'Add two integers (admin only)'
  function sum(x: Integer, y: Integer) returns Integer;

  @description: 'Get current stock for a book (admin only)'
  function stock(id: Integer) returns Integer;

  @description: 'Add a value to an accumulator (admin only)'
  action add(x: Integer, to: Integer) returns Integer;
}
