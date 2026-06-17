import cds from "@sap/cds/eslint.config.mjs";

export default [
  ...cds,
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        SELECT: "readonly",
        INSERT: "readonly",
        UPSERT: "readonly",
        UPDATE: "readonly",
        DELETE: "readonly",
        CREATE: "readonly",
        DROP: "readonly",
        CDL: "readonly",
        CQL: "readonly",
        CXL: "readonly",
        cds: "readonly",
      },
    },
    rules: {
      "no-await-in-loop": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["tests/**"],
    rules: {
      "no-console": "off",
      "no-await-in-loop": "off"
    },
  },
];
