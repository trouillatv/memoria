import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import reactPlugin from "eslint-plugin-react";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ajouts (script `eslint .`) — bruit hors périmètre applicatif :
    "node_modules/**",
    "tmp/**",
    ".agents/**",
    "coverage/**",
  ]),
  // Ajustements de sévérité au stade pilote (décision produit, pas dette cachée) :
  {
    plugins: { "react-hooks": reactHooks, react: reactPlugin },
    rules: {
      // Next 16 / React 19 : flague des patterns d'effet bénins très courants en
      // App Router (mounted flag, theme, media-query, auth). On garde la
      // vigilance humaine sur les vrais cascade-loops → warn, pas error.
      "react-hooks/set-state-in-effect": "warn",
      // Même famille (règles du React Compiler). Beaucoup de faux positifs sur
      // des API de libs idiomatiques — typiquement @dnd-kit (`setNodeRef`,
      // `isOver` lus dans le JSX sont pris pour un accès ref/impur pendant le
      // render). Vigilance humaine conservée → warn, pas error.
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      // App francophone : « l'équipe » etc. en JSX déclencherait &apos; partout.
      // Zéro gain, lisibilité réduite → désactivée.
      "react/no-unescaped-entities": "off",
    },
  },
  // Tooling hors app livrée (scripts dev, migrations, extraction CommonJS) :
  // règles app non pertinentes ici. require() est correct dans un .cjs ;
  // les scripts jetables n'ont pas à être typés au cordeau.
  {
    files: ["scripts/**", "docs/**/*.cjs", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]);

export default eslintConfig;
