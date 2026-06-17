using {sap.capire.bookshop as my} from '../db/schema';

@mcp
service ApiIgnoreTestService {

  entity BooksWithIgnored as projection on my.Books {
    key ID,
    title,
    stock,
    @cds.api.ignore
    price,
    @cds.api.ignore
    currency
  };

  @cds.api.ignore
  entity HiddenEntity {
    key ID : UUID;
    secretData : String;
  }

  entity VisibleAuthors as projection on my.Authors {
    key ID,
    name
  };

  @cds.api.ignore
  action hiddenAction(secret : String) returns String;

  @cds.api.ignore
  function hiddenFunction() returns Integer;

  action visibleAction(message : String) returns String;

  function visibleFunction(x : Integer) returns Integer;
}
