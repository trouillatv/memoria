// Résultat d'import — P1-A, lot UI final (2026-08-20).
//
// "Examiner" ne doit plus renvoyer dans la grosse page Histoire : cette page
// est le compte rendu du travail que MemorIA vient d'effectuer sur CE PV,
// scopée via site_reports.extraction_run_id (lib/db/memory-build-result.ts).
// 32 sujets ne doivent jamais devenir 32 cartes : seuls les rapprochements
// (jugement humain réel) sont mis en avant ; le reste est consultable, pas
// une corvée de validation (Vincent, 2026-08-20).

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { getCurrentUserWithProfile, userBelongsToOrg } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { getMemoryBuildResult } from '@/lib/db/memory-build-result'
import { ImportResultSuggestions } from './ImportResultSuggestions'
import { SemanticDeepSearchCta } from './SemanticDeepSearchCta'

export const dynamic = 'force-dynamic'

const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })

export default async function ResultatImportPage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit] = await Promise.all([getSiteIdentity(id), getVisit(visitId)])
  if (!identity || !visit || visit.site_id !== id || visit.origin !== 'import') notFound()
  if (visit.organization_id && !(await userBelongsToOrg(user.id, visit.organization_id))) notFound()

  const admin = createAdminClient()
  const result = await getMemoryBuildResult(admin, visitId)
  if (!result) redirect(`/sites/${id}/visites/${visitId}`)

  const pvLabel = visit.text_input?.trim() || `PV du ${frDate(visit.started_at ?? visit.created_at)}`
  const complete = result.pendingSuggestions.length === 0

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link href="/sites" className="hover:text-foreground">Chantiers</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <Link href={`/sites/${id}/visites/${visitId}`} className="hover:text-foreground">{pvLabel}</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium text-foreground">Résultat d’import</span>
        </nav>
        <Link
          href={`/sites/${id}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          <Home className="h-3.5 w-3.5" aria-hidden />
          Retour au chantier
        </Link>
      </div>

      <header className="mb-4">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Mémoire construite à partir de {pvLabel}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          {result.identifiedSubjectCount} sujet{result.identifiedSubjectCount > 1 ? 's' : ''} identifié{result.identifiedSubjectCount > 1 ? 's' : ''} · {result.integratedSubjectCount} sujet{result.integratedSubjectCount > 1 ? 's' : ''} métier intégré{result.integratedSubjectCount > 1 ? 's' : ''}
          {result.pendingSuggestions.length > 0 && (
            <> · {result.pendingSuggestions.length} rapprochement{result.pendingSuggestions.length > 1 ? 's' : ''} proposé{result.pendingSuggestions.length > 1 ? 's' : ''}</>
          )}
        </p>
      </header>

      <div className="space-y-4">
        {complete ? (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-[13.5px] dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">✓ Mémoire à jour</p>
            <p className="mt-1 text-muted-foreground">
              {result.enrichedSubjectCount} sujet{result.enrichedSubjectCount > 1 ? 's' : ''} métier enrichi{result.enrichedSubjectCount > 1 ? 's' : ''}
              {result.mergedCount > 0 && <> · {result.mergedCount} rapprochement{result.mergedCount > 1 ? 's' : ''} confirmé{result.mergedCount > 1 ? 's' : ''}</>}
              {result.distinctCount > 0 && <> · {result.distinctCount} conservé{result.distinctCount > 1 ? 's' : ''} distinct{result.distinctCount > 1 ? 's' : ''}</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/sites/${id}/historique`}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-emerald-700"
              >
                Voir les lignes de vie
              </Link>
              <Link
                href={`/sites/${id}`}
                className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-muted"
              >
                Retour au chantier
              </Link>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <h2 className="text-[15px] font-semibold">
              {result.pendingSuggestions.length} rapprochement{result.pendingSuggestions.length > 1 ? 's' : ''} à examiner
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              MemorIA a repéré des sujets qui se ressemblent. À vous de trancher.
            </p>
            <div className="mt-3">
              <ImportResultSuggestions siteId={id} initialSuggestions={result.pendingSuggestions} />
            </div>
          </section>
        )}

        {result.semanticDeepSearch && (
          <SemanticDeepSearchCta
            siteId={id}
            reportId={result.siteReportId}
            candidateCount={result.semanticDeepSearch.candidateCount}
          />
        )}

        {result.enrichedSubjectCount > 0 && (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-[13.5px] font-medium">
              {result.enrichedSubjectCount} sujet{result.enrichedSubjectCount > 1 ? 's' : ''} métier enrichi{result.enrichedSubjectCount > 1 ? 's' : ''} par ce PV
            </summary>
            <ul className="mt-3 space-y-2">
              {result.enrichedSubjects.map((subj) => (
                <li key={subj.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-[13px]">
                  <span className="font-medium">{subj.label}</span>
                  <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    +{subj.addedEvidenceCount} preuve{subj.addedEvidenceCount > 1 ? 's' : ''}
                    {subj.page != null && <> · page {subj.page}</>}
                    <Link href={`/sites/${id}/historique/sujets/${subj.id}`} className="ml-1 text-[12px] font-medium text-primary hover:underline">
                      Voir le sujet
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {result.newSubjectCount > 0 && (
          <section className="rounded-xl border p-4">
            <h2 className="text-[13.5px] font-medium">
              {result.newSubjectCount} nouveau{result.newSubjectCount > 1 ? 'x' : ''} sujet{result.newSubjectCount > 1 ? 's' : ''} ajouté{result.newSubjectCount > 1 ? 's' : ''} automatiquement
            </h2>
            <ul className="mt-3 space-y-2">
              {result.newSubjects.map((subj) => (
                <li key={subj.id} className="rounded-lg border p-3 text-[13px]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">{subj.label}</p>
                    <Link href={`/sites/${id}/historique/sujets/${subj.id}`} className="shrink-0 text-[12px] font-medium text-primary hover:underline">
                      Voir le sujet
                    </Link>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Première apparition : {pvLabel}
                    {subj.sourcePage != null && <> · page {subj.sourcePage}</>}
                    {subj.type && <> · {subj.type}</>}
                  </p>
                  {subj.sourceExcerpt && (
                    <p className="mt-1.5 text-[12.5px] italic text-muted-foreground">« {subj.sourceExcerpt} »</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {result.ignoredThreadCount > 0 && (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-[13.5px] font-medium text-muted-foreground">
              {result.ignoredThreadCount} élément{result.ignoredThreadCount > 1 ? 's' : ''} ignoré{result.ignoredThreadCount > 1 ? 's' : ''} / fait{result.ignoredThreadCount > 1 ? 's' : ''} ponctuel{result.ignoredThreadCount > 1 ? 's' : ''} — Voir le détail
            </summary>
            <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
              {result.ignoredItems.map((item) => (
                <li key={item.label}>
                  · {item.label}
                  <span className="text-muted-foreground/70"> — {item.reason ?? 'non rattaché à un sujet suivi de ce chantier'}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
