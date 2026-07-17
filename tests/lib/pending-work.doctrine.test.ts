import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── UNE PROPOSITION N'EST PAS UN ENGAGEMENT ──────────────────────────────────
// « Une proposition ne doit jamais : compter comme action ouverte, alimenter les
// indicateurs de production réalisée, apparaître comme engagement confirmé,
// entrer dans le planning d'exécution, être exportée comme fait validé dans un
// document externe. Elle peut uniquement compter comme élément à traiter. »
// (Vincent, 2026-07-17)
//
// Le danger n'est pas théorique : le Dashboard compte déjà des propositions et
// annonce « +3 intervenants » alors que le casting réel est vide. Le jour où un
// écran additionne une proposition à une action ouverte, le conducteur croit
// avoir pris un engagement que personne n'a pris.

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const READ_MODEL = 'lib/knowledge/pending-work.ts'
const BLOC = 'app/(field)/m/actions/PendingWorkBlock.tsx'
const PAGE = 'app/(field)/m/actions/page.tsx'

describe('« À confirmer » ne se mélange jamais à « À exécuter »', () => {
  it('le read model ne renvoie QUE des propositions vivantes', () => {
    const src = codeOf(READ_MODEL)
    expect(src).toContain("eq('status', 'proposed')")
    // Il ne lit pas les objets métier : ce n'est pas son rôle, et les mélanger
    // dans une même liste est exactement l'erreur à empêcher.
    expect(src, 'les actions ouvertes ont leur propre lecture').not.toMatch(/from\(['"]site_actions|from\(['"]site_deadlines/)
  })

  it('la page charge les deux sources SÉPARÉMENT', () => {
    const src = codeOf(PAGE)
    expect(src).toContain('listOpenSiteActions')
    expect(src).toContain('getPendingWork')
    // Aucune fusion : deux listes, deux blocs, deux mots.
    expect(src, 'concaténer les deux ferait compter une proposition comme une action')
      .not.toMatch(/\.\.\.pending\.actions|actions\.concat\(|\[\.\.\.actions, \.\.\.pending/)
  })

  it('le bloc n’offre AUCUN attribut d’exécution', () => {
    const src = codeOf(BLOC)
    // Pas de « terminé », pas d'assignation, pas de statut : ils n'existeront
    // qu'après la promotion, sur l'objet réel.
    for (const interdit of ['completed', 'done_at', 'assigned_to', 'Terminer', 'Terminée', 'Marquer']) {
      expect(src, `« ${interdit} » est un geste d'exécution : il n'a rien à faire sur une proposition`)
        .not.toContain(interdit)
    }
  })

  it('le mot est « à confirmer », jamais « ouvert »', () => {
    // codeOf, pas le fichier brut : le commentaire qui EXPLIQUE l'interdit ne
    // doit pas la déclencher. (C'est la deuxième fois aujourd'hui.)
    const src = codeOf(BLOC)
    expect(src).toContain('à confirmer')
    // Le mot « ouvert » n'a AUCUN usage légitime dans un bloc de propositions —
    // on l'interdit en entier plutôt que d'essayer d'attraper « N actions
    // ouvertes ». Un regex sur la phrase rate `action${n > 1 ? 's' : ''}
    // ouvertes` : l'interpolation sépare les deux mots. C'est exactement
    // comme ça qu'un garde-fou passe au vert sans rien garder.
    expect(src, '« ouvert » compterait une proposition comme un engagement').not.toMatch(/ouvert/i)
  })

  it('le verbe du bouton vient du contrat, jamais du JSX', () => {
    const src = codeOf(BLOC)
    expect(src).toContain('capability.label')
    for (const verbe of ["Créer l'action", "Créer l’action", 'Ajouter au planning', 'Confirmer']) {
      expect(src, `« ${verbe} » vient de getPromotionCapability`).not.toContain(verbe)
    }
  })

  it('le geste réutilise le cycle unique, il n’en invente pas un second', () => {
    const src = codeOf(BLOC)
    expect(src).toContain('promoteFromMemoryAction')
    expect(src).toContain('dismissFromMemoryAction')
    expect(src, 'un renderer ne parle pas à la base').not.toMatch(/createAdminClient|\.from\(['"]/)
  })
})
