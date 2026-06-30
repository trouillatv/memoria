// lib/db/previsite-synthesis.ts
// « Synthèse de prévisite pour réponse AO » — PROJECTION déterministe du
// read-model d'un dossier en texte prêt à copier/coller (ou télécharger).
//
// Zéro IA, zéro fait inventé : on remet en forme ce qui a été capté et vérifié,
// organisé pour chiffrer. La couche IA (« voilà ce que j'ai compris ») viendra
// par-dessus, gated. Fonction PURE — testable, pas d'accès DB ici.

import type { TenderReading } from '@/lib/db/dossier-readings'

export interface ResolvedQuestion {
  id: string
  question: string
  answer: string | null
  resolvedAt: string | null
}

function frDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Assemble la synthèse. Sections n'apparaissant que si elles ont du contenu :
 * une synthèse ne montre jamais une rubrique vide.
 */
export function buildPrevisiteSynthesis(r: TenderReading, resolved: ResolvedQuestion[]): string {
  const L: string[] = []
  const push = (s = '') => L.push(s)

  // En-tête
  push(`# Synthèse de prévisite — ${r.siteName}`)
  const sub = [r.clientName, r.address].filter(Boolean).join(' · ')
  if (sub) push(`_${sub}_`)
  push()
  push('_Synthèse de prévisite pour réponse à appel d’offres — mémoire terrain MemorIA, déterministe._')
  push()

  // Éléments importants (⭐) — le point de départ pour chiffrer.
  if (r.starred.length > 0) {
    push('## Éléments importants (marqués sur le terrain)')
    for (const it of r.starred) push(`- ⭐ ${it.text}`)
    push()
  }

  // Points vérifiés — question → réponse (la valeur, pas juste « résolu »).
  if (resolved.length > 0) {
    push('## Points vérifiés')
    for (const q of resolved) {
      const d = frDate(q.resolvedAt)
      push(`- **${q.question}**`)
      push(`  → ${q.answer?.trim() ? q.answer.trim() : 'vérifié'}${d ? ` _(vérifié le ${d})_` : ''}`)
    }
    push()
  }

  // Points encore à vérifier — les trous restants, à lever avant de remettre.
  if (r.questions.length > 0) {
    push('## Points encore à vérifier')
    for (const q of r.questions) push(`- ❓ ${q.text}`)
    push()
  }

  // Ce qu'on a observé — la matière brute (notes + vocaux transcrits + compteurs).
  const obs = r.observed
  push('## Observations sur site')
  push(
    `${obs.photos} photo(s) · ${obs.videos} vidéo(s) · ${obs.vocals.length} vocal(aux) · ` +
    `${obs.notes.length} note(s) · ${obs.verifications} vérification(s).`,
  )
  if (obs.notes.length > 0) {
    push()
    push('**Notes :**')
    for (const n of obs.notes) push(`- ${n.text}`)
  }
  if (obs.vocals.length > 0) {
    push()
    push('**Vocaux (transcrits) :**')
    for (const v of obs.vocals) push(`- « ${v.text} »`)
  }
  push()

  // Engagements / risques / pièges / documents manquants — s'ils existent.
  if (r.promises.length > 0) {
    push('## Engagements entendus')
    for (const it of r.promises) push(`- ${it.text}`)
    push()
  }
  if (r.risks.length > 0) {
    push('## Risques de chiffrage')
    for (const it of r.risks) push(`- ${it.text}`)
    push()
  }
  if (r.pitfalls.length > 0) {
    push('## Pièges & contraintes du lieu')
    for (const it of r.pitfalls) push(`- ${it.text}`)
    push()
  }
  if (r.missingDocuments.length > 0) {
    push('## Documents manquants / attendus')
    for (const it of r.missingDocuments) push(`- ${it.text}`)
    push()
  }

  return L.join('\n').trimEnd() + '\n'
}
