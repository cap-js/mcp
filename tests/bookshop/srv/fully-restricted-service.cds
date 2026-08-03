using {sap.capire.bookshop as my} from '../db/schema';

@mcp
service FullyRestrictedService {
  entity Books   as projection on my.Books where ID < 1000; // exclude test-seed range
  entity Authors as projection on my.Authors;
}

annotate FullyRestrictedService.Books with @(restrict: [{
  grant: 'READ',
  to   : 'admin'
}]);

annotate FullyRestrictedService.Authors with @(restrict: [{
  grant: 'READ',
  to   : 'editor'
}]);

annotate FullyRestrictedService.Genres with @(restrict: [{
  grant: 'READ',
  to   : 'admin'
}]);

annotate FullyRestrictedService.Currencies with @(restrict: [{
  grant: 'READ',
  to   : 'admin'
}]);