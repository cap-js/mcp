using {sap.capire.bookshop as my} from '../db/schema';

service CatalogService {

  /** For displaying lists of Books */
  @readonly
  entity ListOfBooks as
    projection on Books {
      *,
      genre.name      as genre,
      currency.symbol as currency,
    }
    excluding {
      descr
    };

  /** For display in details pages */
  @readonly
  entity Books       as
    projection on my.Books {
      *,
      author.name as author
    }
    excluding {
      createdBy,
      modifiedBy
    };

  @requires: 'authenticated-user'
  action submitOrder(book: Books:ID, quantity: Integer) returns {
    stock : Integer
  };
}
