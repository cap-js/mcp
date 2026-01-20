const cds = require("@sap/cds");

module.exports = class CatalogService extends cds.ApplicationService {
  init() {
    const { Books } = this.entities;

    // Add some discount for overstocked books
    this.after("each", Books, (book) => {
      if (book.stock > 111) book.title += ` -- 11% discount!`;
    });
    // Delegate requests to the underlying generic service
    return super.init();
  }
};
