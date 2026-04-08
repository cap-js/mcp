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

  @description: 'Apply a discount to a book'
  action applyDiscount(
    @description: 'The ID of the book'
    book: Books:ID @mandatory,
    @description: 'Discount percentage (exclusive of 0 and 100)'
    percentage: Integer @assert.range: [(0), (100)],
    @description: 'Price markup multiplier (must be positive)'
    markup: Decimal @assert.range: [(0), _],
    @description: 'Effective date for the discount'
    effectiveDate: DateTime @assert.range: ['2020-01-01T00:00:00Z', '2030-12-31T23:59:59Z']
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
