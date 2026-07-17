import 'server-only'

// ── « POURQUOI C'EST ICI ? » — LA CHAÎNE DE PROVENANCE ───────────────────────
// Objectif 2 du moteur d'explication (cadrage 2026-07-18) : « en 30 secondes,
// je comprends pourquoi cette chose existe ».
//
// La chaîne remonte un objet confirmé jusqu'à la voix qui l'a fait naître :
//   chantier → visite → mémo(s), mot pour mot → objet.
//
// AUCUNE génération n'a lieu ici : chaque maillon est une ligne de base
// identifiable (règle « rien d'affiché sans preuve »). Le travail dur est déjà
// fait — report_id sur l'objet, source_capture_ids sur la proposition qui l'a
// porté (backref promoted_object_id, mig 212). Ce read model ne fait que le
// rendre lisible. Il servira tel quel à l'onglet Explorer.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export type ProvenanceObjectType = 'action' | 'deadline' | 'decision'

export interface ProvenanceStep {
  kind: 'site' | 'visite' | 'memo' | 'objet'
  label: string
  /** Détail court — date de visite, contrainte d'échéance… */
  sub?: string | null
  /** Le mémo, mot pour mot (tronqué) : la preuve, jamais une paraphrase. */
  excerpt?: string | null
}

export interface ProvenanceChain {
  steps: ProvenanceStep[]
}

const TABLES: Record<ProvenanceObjectType, { table: string; titleCol: string }> = {
  action: { table: 'site_actions', titleCol: 'title' },
  deadline: { table: 'site_deadlines', titleCol: 'title' },
  decision: { table: 'site_decisions', titleCol: 'titre' },
}

const OBJET_LABEL: Record<ProvenanceObjectType, string> = {
  action: 'Action',
  deadline: 'Échéance',
  decision: 'Décision',
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long',
})

/**
 * La provenance d'un objet confirmé. `null` si l'objet n'existe pas, n'a pas de
 * provenance, ou n'appartient pas à l'organisation de l'appelant (fail-closed :
 * le service-role bypasse la RLS, la garde vit ici).
 */
export async function getProvenance(
  type: ProvenanceObjectType,
  id: string,
): Promise<ProvenanceChain | null> {
  const orgId = await getOrgId()
  if (!orgId) return null

  const db = createAdminClient()
  const { table, titleCol } = TABLES[type]

  const { data: obj } = await db
    .from(table)
    .select(`id, ${titleCol}, site_id, report_id`)
    .eq('id', id)
    .maybeSingle()
  if (!obj) return null
  const row = obj as unknown as Record<string, string | null>
  const siteId = row.site_id
  const reportId = row.report_id
  if (!siteId) return null

  // Garde tenant : l'objet doit appartenir à un chantier de MON organisation.
  const { data: site } = await db
    .from('sites')
    .select('id, name, organization_id')
    .eq('id', siteId)
    .maybeSingle()
  if (!site || (site as { organization_id: string | null }).organization_id !== orgId) return null

  // La proposition qui a porté l'objet (mig 212) : c'est elle qui connaît les
  // captures d'origine. Son absence n'est pas une erreur — un objet saisi à la
  // main n'a simplement pas de voix derrière lui.
  const { data: prop } = await db
    .from('site_knowledge_proposals')
    .select('id, source_capture_ids, report_id')
    .eq('promoted_object_id', id)
    .maybeSingle()

  const captureIds: string[] = (prop as { source_capture_ids?: string[] } | null)?.source_capture_ids ?? []
  const effectiveReportId = reportId ?? (prop as { report_id?: string | null } | null)?.report_id ?? null

  const steps: ProvenanceStep[] = [
    { kind: 'site', label: (site as { name: string }).name },
  ]

  if (effectiveReportId) {
    const { data: report } = await db
      .from('site_reports')
      .select('id, started_at')
      .eq('id', effectiveReportId)
      .maybeSingle()
    if (report) {
      const started = (report as { started_at: string | null }).started_at
      steps.push({
        kind: 'visite',
        label: started ? `Visite du ${dateFmt.format(new Date(started))}` : 'Visite',
        sub: 'la source de ce que MemorIA a retenu',
      })
    }

    // Les mémos d'origine : d'abord ceux que la proposition désigne ; à défaut,
    // les captures textuelles de la visite (le fait en vient forcément).
    let capQuery = db
      .from('visit_capture')
      .select('id, kind, body')
      .is('hidden_at', null)
      .not('body', 'is', null)
    capQuery = captureIds.length > 0
      ? capQuery.in('id', captureIds)
      : capQuery.eq('report_id', effectiveReportId).in('kind', ['vocal', 'note'])
    const { data: caps } = await capQuery.limit(3)
    for (const c of (caps ?? []) as Array<{ id: string; kind: string; body: string | null }>) {
      if (!c.body) continue
      steps.push({
        kind: 'memo',
        label: c.kind === 'vocal' ? 'Mémo vocal' : 'Note de visite',
        excerpt: c.body.length > 240 ? c.body.slice(0, 237) + '…' : c.body,
      })
    }
  }

  steps.push({
    kind: 'objet',
    label: (row[titleCol] as string) ?? OBJET_LABEL[type],
    sub: OBJET_LABEL[type],
  })

  // Une chaîne réduite à « chantier → objet » n'explique rien : on la dit nulle,
  // et l'écran n'affiche pas un bouton qui ne tiendra pas sa promesse.
  return steps.length > 2 ? { steps } : null
}
