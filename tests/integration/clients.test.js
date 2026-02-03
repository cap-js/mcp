const cds = require("@sap/cds");

const exportCalls = [];
const purgeCalls = [];

const testClient = {
  export(services, url) {
    exportCalls.push({ services: services.map((s) => s.name), url });
  },
  purge(services) {
    purgeCalls.push({ services: services.map((s) => s.name) });
  },
};

// fires after plugins are loaded but before server starts
cds.on("bootstrap", () => {
  cds.env.protocols.mcp.clients.testClient = testClient;
});

const test = cds.test(__dirname + "/../bookshop");
const { expect } = test;

describe("Custom MCP Client Registration", () => {
  describe("export()", () => {
    it("is called when server starts", async () => {
      await test;
      expect(exportCalls.length).to.equal(1);
    });

    it("receives MCP services with correct names", async () => {
      await test;
      expect(exportCalls[0].services).to.include("CatalogService");
      expect(exportCalls[0].services).to.include("AdminService");
    });

    it("receives the server URL", async () => {
      await test;
      expect(exportCalls[0].url).to.match(/http:\/\/localhost:\d+/);
    });
  });

  describe("purge()", () => {
    it("is called once on shutdown with correct services", async () => {
      await test;

      cds.emit("shutdown");

      expect(purgeCalls.length).to.equal(1);

      expect(purgeCalls[0].services).to.include("CatalogService");
      expect(purgeCalls[0].services).to.include("AdminService");
    });
  });
});
