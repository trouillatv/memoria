import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'

export default async function DevFieldPage() {
  // Page de debug : indisponible en production (audit sécurité 2026-05-13).
  if (process.env.NODE_ENV === 'production') notFound()
  const supabase = createAdminClient()

  const [sites, missions, interventions, checklistItems, photos, anomalies, validations] = await Promise.all([
    supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('missions').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('interventions').select('id', { count: 'exact', head: true }),
    supabase.from('intervention_checklist_items').select('id', { count: 'exact', head: true }),
    supabase.from('intervention_photos').select('id', { count: 'exact', head: true }),
    supabase.from('intervention_anomalies').select('id', { count: 'exact', head: true }),
    supabase.from('intervention_validations').select('id', { count: 'exact', head: true }),
  ])

  const rows = [
    { label: 'Sites', count: sites.count ?? 0, slice: 'fondations' },
    { label: 'Missions (recettes)', count: missions.count ?? 0, slice: '2.1' },
    { label: 'Interventions (instances)', count: interventions.count ?? 0, slice: '2.2' },
    { label: 'Checklist items', count: checklistItems.count ?? 0, slice: '2.3' },
    { label: 'Photos', count: photos.count ?? 0, slice: '2.3' },
    { label: 'Anomalies', count: anomalies.count ?? 0, slice: '2.4' },
    { label: 'Validations', count: validations.count ?? 0, slice: '2.4' },
  ]

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Page debug Field MVP — Slice 2.0 livrée. Affiche le compte des entités créées.
        Les vraies pages produit arrivent en slices 2.1 → 2.5.
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">État des tables Field</h2>
        <ul className="rounded-lg border bg-card divide-y">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-medium">{row.label}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                  alimenté en slice {row.slice}
                </span>
              </div>
              <span className="font-mono text-muted-foreground tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground italic">
        Cockpit Boucle de preuve actuel : seul PROMIS est calculé.
        Les 4 autres dimensions s&apos;allumeront slice par slice (2.1 → 2.4).
      </p>
    </div>
  )
}
