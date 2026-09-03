import 'server-only'

import { normalizeCanonicalLabel } from './canonical-subject-resolve'

export type ActorCanonicalSubjectResult =
  | { outcome: 'created'; id: string }
  | { outcome: 'reused'; id: string }
  | { outcome: 'error'; message: string | undefined }

const ACTIVE_NORMALIZED_LABEL_CONSTRAINT = 'canonical_subject_active_normalized_label_uniq'

/**
 * Crée un canonical_subject kind='actor' pour ce site ; en cas de violation de
 * canonical_subject_active_normalized_label_uniq (mig 323), un actif avec le
 * même label normalisé existe déjà sur ce site — c'est le MÊME acteur réel, on
 * le retrouve et on réutilise son id plutôt que de perdre le rattachement du
 * thread. Ne traite QUE cette clé d'unicité (code 23505 ET nom de contrainte
 * dans le message Postgres — PostgrestError n'expose pas de champ `constraint`
 * dédié) — toute autre erreur SQL reste une erreur (jamais de fusion sur
 * simple ressemblance lexicale).
 */
export async function createOrReuseActorCanonicalSubject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  siteId: string,
  label: string,
): Promise<ActorCanonicalSubjectResult> {
  const { data: newCs, error: csErr } = await supabase
    .from('canonical_subject')
    .insert({ site_id: siteId, label, status: 'active', kind: 'actor' })
    .select('id')
    .single()

  const createdId = (newCs as { id: string } | null)?.id ?? null
  if (!csErr && createdId) {
    return { outcome: 'created', id: createdId }
  }

  if (csErr?.code === '23505' && csErr?.message?.includes(ACTIVE_NORMALIZED_LABEL_CONSTRAINT)) {
    const normalizedLabel = normalizeCanonicalLabel(label)
    const { data: activeSubjects } = await supabase
      .from('canonical_subject')
      .select('id, label')
      .eq('site_id', siteId)
      .eq('status', 'active')
    const reused = (activeSubjects as { id: string; label: string }[] | null)?.find(
      (cs) => normalizeCanonicalLabel(cs.label) === normalizedLabel,
    )
    if (reused) {
      return { outcome: 'reused', id: reused.id }
    }
  }

  return { outcome: 'error', message: csErr?.message }
}
