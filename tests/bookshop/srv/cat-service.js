const cds = require("@sap/cds");

module.exports = class CatalogService extends cds.ApplicationService {
  init() {
    const { Books } = this.entities;

    // Add some discount for overstocked books
    this.after("each", Books, (book) => {
      if (book.stock > 111) book.title += ` -- 11% discount!`;
    });

    // Simple arithmetic - something OData can't do
    this.on("sum", (req) => {
      const { x, y } = req.data;
      return (x || 0) + (y || 0);
    });

    // Lookup stock for a book by ID
    this.on("stock", async (req) => {
      const { id } = req.data;
      const book = await SELECT.one.from(Books).where({ ID: id }).columns("stock");
      return book?.stock ?? 0;
    });

    // Action: add x to accumulator 'to'
    this.on("add", (req) => {
      const { x, to } = req.data;
      return (x || 0) + (to || 0);
    });

    // Action: order a book, reducing its stock
    this.on('submitOrder', async req => {
      let { book: id, quantity } = req.data
      if (quantity < 1) return req.error(400, `quantity has to be 1 or more`)
      let succeeded = await UPDATE(Books, id)
        .with`stock = stock - ${quantity}`
        .where`stock >= ${quantity}`
      if (succeeded) return
      else if (!this.exists(Books, id)) req.error(404, `Book #${id} doesn't exist`)
      else req.error(409, `${quantity} exceeds stock for book #${id}`)
    })

    // Delegate requests to the underlying generic service
    return super.init();
  }
};
