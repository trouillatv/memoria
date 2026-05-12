import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
