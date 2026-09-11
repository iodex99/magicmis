// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // SPEC 4: Zod at every boundary means `unknown` in, parsed out. An `any`
      // is a hole straight through that.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",

      // Floating promises in a wallet transaction lose writes silently.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // SPEC 4 / 30: money is integer paise and micro-USD; logs never carry content.
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message: "Money is integer paise. See packages/core/money.",
        },
      ],
      // Ban the Number(...) coercion without banning Number.isInteger and friends.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='Number']",
          message: "Number() on an amount loses precision. Use packages/core/money.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='round']",
          message:
            "Math.round is float rounding. Use the explicit RoundingMode helpers in packages/core/money.",
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // Config files and scripts run outside the type-checked project graph.
    files: ["**/*.config.{js,ts,mjs}", "**/scripts/**"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { "no-console": "off" },
  },
);
