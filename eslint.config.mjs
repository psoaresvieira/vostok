import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // Sem `files`, este objeto de regras nominalmente valeria tambem para
    // `.mjs`/`.js` (este proprio arquivo, por exemplo). So e seguro hoje porque
    // `next lint` limita a varredura aos diretorios de fonte TS — `eslint .`
    // direto mudaria o comportamento em silencio. Achado do review final de
    // branch.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // O prefixo `_` so vale como "nao usado de proposito" se o linter for
      // configurado para reconhece-lo — sem isso e so uma convencao que
      // ninguem aplica, e o aviso reaparece a cada build.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
