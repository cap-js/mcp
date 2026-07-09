using {
  Currency,
  cuid,
  managed,
  sap
} from '@sap/cds/common';

namespace sap.capire.bookshop;

/**
 * Books doc comment 
 */
entity Books : managed {
  key ID       : Integer;
      author   : Association to Authors @mandatory;
      /** The book's title, used for display and search */
      title    : String                  @mandatory;
      /** A brief synopsis of the book's content */
      descr    : String;
      genre    : Association to Genres;
      stock    : Integer @assert.range: [0, 999];
      price    : Price;
      currency : Currency;
      status   : String enum { available = 'A'; out_of_stock = 'O'; discontinued = 'D' };
      isbn     : String @assert.format: '/^[0-9]{13}$/';
      rating   : Decimal @assert.range: [ 0.0, 5.0 ];
      discount : Integer @assert.range: [(0), (100)];
      markup   : Decimal @assert.range: [(0), _];
      publishedAt : DateTime @assert.range: ['2000-01-01T00:00:00Z', '2099-12-31T23:59:59Z'];
      chapters : Composition of many {
          key ID : Integer;
          title  : String;
      }
}

entity Authors : managed {
  key ID           : Integer;
      name         : String @mandatory;
      dateOfBirth  : Date;
      dateOfDeath  : Date;
      placeOfBirth : String;
      placeOfDeath : String;
      books        : Association to many Books
                       on books.author = $self;
}

/** Hierarchical classification system for organizing books into categories and subcategories */
entity Genres : cuid, sap.common.CodeList {
  parent   : Association to Genres;
  children : Composition of many Genres
               on children.parent = $self;
}

type Price : Decimal(9, 2);

/**
 * Test-only entities exercising composition with an explicit backlink association.
 * The child (Section) has both an implicit `up_` (composition parent) AND
 * an explicit `document` assoc pointing back to the parent Document.
 * Used to test that FK columns backing composition-parent backlinks are hidden
 * from draft tool schemas.
 */
entity Documents {
  key ID    : Integer;
      title : String;
      sections : Composition of many Sections on sections.document = $self;
}

entity Sections {
  key ID       : Integer;
      title    : String;
      document : Association to Documents;
}
