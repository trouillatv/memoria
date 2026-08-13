'use client'

// La correction viewport est désormais gérée par un script synchrone dans <head>
// (app/layout.tsx) qui s'exécute avant tout rendu — aucun flash possible.
// Ce composant est conservé pour compatibilité des imports existants.

export function FieldViewportFix() {
  return null
}
