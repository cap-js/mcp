const cds = require('@sap/cds')

// Replicate CAP's internal _slugified function for service name derivation
const slugified = name => (
  /[^.]+$/.exec(name)[0]      //> my.very.CatalogService --> CatalogService
    .replace(/Service$/, '')     //> CatalogService --> Catalog
    .replace(/_/g, '-')          //> foo_bar_baz --> foo-bar-baz
    .replace(/([a-z0-9])([A-Z])/g, (_, c, C) => c + '-' + C)  //> ODataFooBarX9 --> OData-Foo-Bar-X9
    .toLowerCase()              //> FOO --> foo
)

// Resolve the tool name prefix for a service definition
function resolvePrefix(def) {
  return cds.env.mcp?.prefix === true ? slugified(def.name) : '';
}

module.exports = { slugified, resolvePrefix }