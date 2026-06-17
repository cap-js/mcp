using {sap.capire.bookshop as my} from '../db/schema';

@mcp
service RestrictedService {
  entity Books   as projection on my.Books;
  entity Authors as projection on my.Authors;
  entity Genres  as projection on my.Genres;

  @description: 'Add a value to an accumulator'
  action add(x: Integer, to: Integer) returns Integer;
}

annotate RestrictedService.add with @(requires: 'admin');

annotate RestrictedService.Books with @(restrict: [{
  grant: 'READ',
  to   : 'admin'
}]);

annotate RestrictedService.Authors with @(restrict: [{
  grant: 'READ',
  to   : 'editor'
}]);
