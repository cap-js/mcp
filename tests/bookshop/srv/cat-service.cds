using {sap.capire.bookshop as my} from '../db/schema';

// Service with description annotations
@description: 'Catalog service for browsing books'
@Core.LongDescription: 'Provides read access to the book catalog including genres and author information.'
service CatalogService {
  // Entity with i18n reference for title (tests locale resolution)
  @title: '{i18n>Books}'
  entity Books as
    projection on my.Books {
      *,
      author.name as author
    }
    excluding {
      createdBy,
      modifiedBy
    };

  @Common.Label: 'Genre Categories'
  @Core.Description: 'List of book genres'
  @Core.LongDescription: 'Hierarchical classification system for organizing books into categories and subcategories.'
  entity Genres as projection on my.Genres;

  @description: 'Add two integers'
  function sum(
    @description: 'First operand'
    x: Integer,
    @Core.Description: 'Second operand'
    y: Integer
  ) returns Integer;

  @description: 'Get current stock for a book'
  function stock(id: Integer) returns Integer;

  @description: 'Add a value to an accumulator'
  action add(x: Integer, to: Integer) returns Integer;
}

// Element annotations
annotate CatalogService.Books with {
  @Core.Description: 'Unique book identifier'
  ID;

  @Common.Label: 'Book Title'
  title;

  @Core.Description: 'Current inventory count'
  @Core.LongDescription: 'Number of copies available in the warehouse.'
  stock;
};

annotate CatalogService with @mcp @odata;
