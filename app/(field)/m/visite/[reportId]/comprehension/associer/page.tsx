import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { getCurrentUserWithProfile, userBelongsToOrg } from '@/lib/db/users'
import { getVisit } from '@/lib/db/visits'
import { loadKnowledgeEntities } from '@/lib/knowledge/semantic-entities'
import { associerCandidat } from '../semantic-actions'

export const dynamic = 'force-dynamic'

export default async function AssocierPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>
  searchParams: Promise<{ rawText?: string }>
}) {
  const { reportId } = await params
  const { rawText } = await searchParams
  if (!rawText) redirect(`/m/visite/${reportId}/comprehension`)

  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id || !visit.organization_id) notFound()
  if (visit.organization_id && !(await userBelongsToOrg(user.id, visit.organization_id))) {
    notFound()
  }

  const entities = await loadKnowledgeEntities(visit.site_id, visit.organization_id, user.id)
  const active = entities.filter((e) => e.isActive)

  async function doAssocier(formData: FormData) {
    'use server'
    const entityId = formData.get('entityId') as string | null
    if (!entityId || !rawText) return
    const res = await associerCandidat(reportId, entityId, rawText)
    if (res.ok) redirect(`/m/visite/${reportId}/comprehension`)
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-5 pb-24">
      <header className="space-y-1">
        <Link
          href={`/m/visite/${reportId}/comprehension`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground active:opacity-70"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Retour
        </Link>
        <h1 className="text-xl font-bold leading-tight">Associer à une entité</h1>
        <p className="text-[13px] text-muted-foreground">
          Quel est <strong>&ldquo;{rawText}&rdquo;</strong> dans la mémoire du chantier ?
        </p>
      </header>

      {active.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune entité connue sur ce chantier.
        </p>
      ) : (
        <form action={doAssocier} className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Choisir une entité existante
          </p>
          <ul className="space-y-2">
            {active.map((e) => (
              <li key={e.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-3 has-[:checked]:border-emerald-400 has-[:checked]:bg-emerald-50/50 dark:has-[:checked]:bg-emerald-950/20">
                  <input
                    type="radio"
                    name="entityId"
                    value={e.id}
                    className="accent-emerald-600"
                    required
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium leading-snug">{e.canonicalLabel}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {e.entityType === 'person' ? 'Personne' : 'Entreprise'} ·{' '}
                      {e.scope === 'org' ? 'Organisation' : e.scope === 'site' ? 'Chantier' : 'Utilisateur'}
                    </p>
                  </div>
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                </label>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-[14px] font-semibold text-white active:bg-emerald-700"
          >
            Associer &ldquo;{rawText}&rdquo; à cette entité
          </button>
        </form>
      )}
    </div>
  )
}
