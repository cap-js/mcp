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
      title    : localized String       @mandatory;
      /** A brief synopsis of the book's content */
      descr    : localized String;
      genre    : Association to Genres;
      stock    : Integer;
      price    : Price;
      currency : Currency;
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


// --------------------------------------------------------------------------------
// Temporary workaround for this situation:
// - Fiori apps in bookstore annotate Books with @fiori.draft.enabled.
// - Because of that .csv data has to eagerly fill in ID_texts column.
annotate Books with @fiori.draft.enabled;
