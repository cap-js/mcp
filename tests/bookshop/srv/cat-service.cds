using {sap.capire.bookshop as my} from '../db/schema';

/**
 * Catalog service for browsing books.
 * Provides read access to the book catalog including genres and author information.
 */
service CatalogService {
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

  @description: 'Add two integers'
  function sum(
    @description: 'First operand'
    x: Integer,
    @description: 'Second operand'
    y: Integer
  ) returns Integer;

  @description: 'Get current stock for a book'
  function stock(id: Integer) returns Integer;

  @description: 'Add a value to an accumulator'
  action add(x: Integer, to: Integer) returns Integer;

  @description: 'Validate an email address'
  function validateEmail(
    @description: 'Email to validate'
    email: String @assert.format: '/^\S+@\S+\.\S+$/'
  ) returns Boolean;

  @description: 'Order a book by its ID and desired quantity. Reduces stock accordingly.'
  action submitOrder(
    @description: 'The ID of the book to order'
    book: Books:ID @mandatory,
    @description: 'Number of copies to order'
    quantity: Integer @assert.range: [1, 100],
    @description: 'Shipping priority'
    priority: String enum { standard = 'S'; express = 'E' }
  );
}

annotate CatalogService.Books with {
  @description: 'Unique book identifier'
  ID;

  @description: 'The display title of the book'
  title;

  @description: 'Current inventory count'
  stock;
};

annotate CatalogService with @mcp @odata;
