const cds = require('@sap/cds')

const PREFIX = cds.env.mcp?.prefix === true

exports.resolvePrefix = !PREFIX
  ? () => ''
  : PREFIX === true
    ? (d) => d.name + '-'
    : (d, prefix) => prefix.replace(/\{service.name\}/, d.name)

// Replicate CAP's internal _slugified function for service name derivation
exports.slugified = (name) =>
  /[^.]+$/
    .exec(name)[0] //> my.very.CatalogService --> CatalogService
    .replace(/Service$/, '') //> CatalogService --> Catalog
    .replace(/_/g, '-') //> foo_bar_baz --> foo-bar-baz
    .replace(/([a-z0-9])([A-Z])/g, (_, c, C) => c + '-' + C) //> ODataFooBarX9 --> OData-Foo-Bar-X9
    .toLowerCase() //> FOO --> foo
