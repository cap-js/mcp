using {sap.capire.bookshop as my} from '../db/schema';

@mcp
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
}
