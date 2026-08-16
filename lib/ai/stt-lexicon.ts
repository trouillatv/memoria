import 'server-only'

// Lexique de transcription contextualisée — nom du chantier + sujets canoniques
// injectés dans le prompt STT (c'est ce qui corrige « P3 City » → « PETRO
// ATITI », prouvé le 16/08 sur téléphone réel).
//
// Extrait de `app/api/copilot/transcribe/route.ts` (P2-C overlap) : la route de
// transcription seule et la route vocale fusionnée (`free-stream`) construisent
// le MÊME lexique. Comportement inchangé.
//
// SÉCURITÉ : cette lecture passe par le client admin, qui BYPASSE la RLS.
// L'appelant DOIT avoir vérifié l'appartenance de l'utilisateur à
// l'organisation du chantier AVANT de l'appeler (incident d'isolation documenté
// dans `lib/field/site-access.ts`).

import { createAdminClient } from '@/lib/supabase/admin'

export async function buildLexicalPrompt(siteId: string): Promise<string> {
  try {
    const admin = createAdminClient()
    const [siteRes, subjectsRes] = await Promise.all([
      admin.from('sites').select('name').eq('id', siteId).single(),
      admin
        .from('canonical_subject')
        .select('label')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    const terms: string[] = []
    if (siteRes.data?.name) terms.push(siteRes.data.name)
    if (subjectsRes.data?.length) {
      const STOP_WORDS = /^(le|la|les|un|une|des|de|du|au|aux|en|à|et|ou|sur|pour|par|dans|avec|sans)\b/i
      const shortLabels = subjectsRes.data
        .map((s) => s.label.trim())
        .filter((l) =>
          l.length > 0 &&
          l.length <= 40 &&         // pas de descriptions longues
          l.split(/\s+/).length <= 4 && // max 4 mots (codes, noms, sigles)
          !STOP_WORDS.test(l) &&    // pas de phrases débutant par un article
          !/\d{1,2}\/\d{2}/.test(l), // pas de dates (ex: "30/03")
        )
      terms.push(...shortLabels.slice(0, 15))
    }
    // Format : liste de termes séparés par des virgules — pas de phrases complètes.
    return terms.join(', ')
  } catch {
    return ''
  }
}
