using {sap.capire.bookshop as my} from '../db/schema';

service CatalogService {
  entity Books as
    projection on my.Books {
      *,
      author.name as author
    }
    excluding {
      createdBy,
      modifiedBy
    };

  entity Genres as projection on my.Genres;

  @description: 'Add two integers'
  function sum(x: Integer, y: Integer) returns Integer;

  @description: 'Get current stock for a book'
  function stock(id: Integer) returns Integer;

  @description: 'Add a value to an accumulator'
  action add(x: Integer, to: Integer) returns Integer;
}

annotate CatalogService with @mcp @odata;
