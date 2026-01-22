using {sap.capire.bookshop as my} from '../db/schema';

@protocol: 'mcp'
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
}
