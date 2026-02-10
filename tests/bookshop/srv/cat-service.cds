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
}

annotate CatalogService with @mcp;
