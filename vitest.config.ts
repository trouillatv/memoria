import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { INTEGRATION_TESTS } from './tests/integration-tests'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Désactive le parallélisme inter-fichiers : plusieurs tests touchent les
    // mêmes lignes `teams` / `team_members` et entrent en course quand exécutés
    // en parallèle (sur CI Ubuntu + Windows). Un fix propre = préfixes uniques
    // par fichier ; quick fix = série fichier-à-fichier. Les tests à l'intérieur
    // d'un même fichier restent en parallèle (rapide).
    fileParallelism: false,
    // Deux projets : `unit` (pur, sans base — joué en CI) et `integration`
    // (vraie Supabase — joué en local / job DB dédié). `vitest run` sans
    // `--project` lance les deux (run local complet inchangé). Le CI fait
    // `vitest run --project unit`. Cf. tests/integration-tests.ts.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, ...INTEGRATION_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: INTEGRATION_TESTS,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // TEST-ONLY : neutralise le garde-fou de build `server-only` en unit tests
      // (jamais appliqué au build Next réel — cf. tests/stubs/server-only.ts).
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
