// LA PAGE D'UNE VISITE — et il n'y en a plus qu'une (Vincent, 2026-07-22).
//
// Il existait deux pages pour une même visite : ce « Débrief de chantier », resté
// au monde d'avant le compte-rendu documentaire, et le récit. Deux portes vers le
// même objet suffisaient à rendre le produit illisible. Le débrief disparaît
// comme vue ; cette adresse EST le récit.
//
// « Une page ne doit proposer que les gestes cohérents avec son récit. » Sur une
// visite, ces gestes sont : écouter, comprendre, raconter, arbitrer, concrétiser.
// Les tuiles « Créer une action » / « Créer une réserve » sont donc parties : pas
// parce qu'elles ne marchaient pas, mais parce qu'elles rouvraient une DEUXIÈME
// porte vers un objet — exactement le défaut qu'on a passé des semaines à
// supprimer. Créer une action sans visite reste possible ailleurs, là où c'est
// l'histoire de la page.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, FileDown, FileText, Home, Images, Paperclip } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildVisitNarrative } from '@/lib/db/visit-narrative'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { VisitShareButton } from '@/app/(field)/m/visite/[reportId]/VisitShareButton'
import { NarrativeReader, type CaptureMedia } from './recit/NarrativeReader'
import { ReanalyseButton } from './ReanalyseButton'

export const dynamic = 'force-dynamic'

export default async function VisitPage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit, narrative, doc] = await Promise.all([
    getSiteIdentity(id),
    getVisit(visitId),
    buildVisitNarrative(visitId),
    getVisitCrDocument(visitId).catch(() => null),
  ])
  if (!identity || !visit || visit.site_id !== id || !narrative) notFound()
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const [media, conducteur] = await Promise.all([
    getVisitCapturePreviewUrls(
      narrative.captured
        .filter((c) => c.attachmentId)
        .map((c) => ({ id: c.id, attachment_id: c.attachmentId }) as VisitCaptureRow),
    ).catch((): CaptureMedia => ({})),
    resolveConducteur(visit.created_by ?? null),
  ])

  // Le récit introductif est celui que l'humain a sous les yeux dans son
  // compte-rendu — jamais un second texte fabriqué pour l'occasion.
  const resume = doc?.sections.find((s) => s.key === 'resume')?.content?.trim() || null

  const debut = visit.started_at ?? visit.created_at
  const minutes = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null

  const { captured, understood, validated, produced } = narrative
  const vocaux = captured.filter((c) => c.kind === 'vocal').length
  const photos = captured.filter((c) => c.kind === 'photo').length
  const notes = captured.filter((c) => c.kind === 'note').length
  // Les gestes HUMAINS, et eux seuls : `superseded` n'en est pas un (personne
  // n'a rien décidé, une analyse plus récente ne redit simplement plus le fait).
  const gestes = validated.confirmedProposals + validated.ignoredProposals
    + validated.correctedSections.length + validated.discardedCaptures

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href="/sites" className="hover:text-foreground">Chantiers</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}/visites`} className="hover:text-foreground">Visites</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium text-foreground">Visite du {frDate(debut)}</span>
      </nav>

      {/* ── L'IDENTITÉ DE LA VISITE — où suis-je, et dans quel état ? ───────── */}
      <header className="mt-4 space-y-4 border-b pb-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Visite de chantier
          </p>
          <h1 className="mt-1 text-balance text-3xl font-semibold tracking-tight">
            {identity.name} — {frDate(debut)}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {conducteur && (
              <span>
                <span className="font-medium text-foreground">{conducteur}</span> · conducteur
              </span>
            )}
            <span className="tabular-nums">
              {frHeure(debut)}
              {visit.ended_at ? ` → ${frHeure(visit.ended_at)}` : ''}
            </span>
            {minutes !== null && <span className="font-medium text-foreground">{frDuree(minutes)}</span>}
            {!visit.ended_at && <span>visite en cours</span>}
          </p>
        </div>

        {resume && <p className="max-w-prose text-[15px] leading-relaxed">{resume}</p>}

        <CrState visitId={visitId} doc={narrative.validated.document} />

        {/* Quatre chiffres, et chacun dit de quelle couche il vient. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 pt-2 sm:grid-cols-4">
          <Compteur
            value={captured.length}
            label="captures"
            sub={[plural(vocaux, 'vocal', 'vocaux'), plural(photos, 'photo', 'photos'), plural(notes, 'note', 'notes')]
              .filter(Boolean)
              .join(' · ')}
          />
          <Compteur value={understood.length} label="propositions de MemorIA" sub={plural(validated.pendingProposals, 'en attente', 'en attente')} />
          <Compteur
            value={gestes}
            label="arbitrages"
            sub={[plural(validated.ignoredProposals, 'écarté', 'écartés'), plural(validated.correctedSections.length, 'section corrigée', 'sections corrigées')]
              .filter(Boolean)
              .join(' · ')}
          />
          <Compteur value={produced.length} label="objets produits" />
        </dl>

      </header>

      <div className="py-8">
        <NarrativeReader
          narrative={narrative}
          media={media}
          canPromote={doc?.status === 'draft'}
          crHref={doc ? `/m/visite/${visitId}/cr` : null}
          rail={
            <div className="mt-4 space-y-4">
              {/* ANALYSE — ce que la base sait démontrer, et rien de plus. Pas de
                  v1/v2 : il n'existe aucun historique des analyses, seulement la
                  courante et un delta calculable (arbitrage 2026-07-22). */}
              <section className="rounded-xl border bg-card p-3">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Analyse MemorIA
                </h2>
                {narrative.enrichment.lastAnalysisAt ? (
                  <p className="mt-1.5 text-[13px]">
                    Dernière analyse
                    <span className="ml-1 font-medium">{frDateHeure(narrative.enrichment.lastAnalysisAt)}</span>
                  </p>
                ) : (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">Cette visite n’a pas encore été lue.</p>
                )}
                {narrative.enrichment.sinceLastAnalysis > 0 && (
                  <>
                    <p className="mt-1.5 text-[13px] text-muted-foreground">
                      +{narrative.enrichment.sinceLastAnalysis} preuve
                      {narrative.enrichment.sinceLastAnalysis > 1 ? 's' : ''} depuis cette analyse
                    </p>
                    <div className="mt-2">
                      <ReanalyseButton reportId={visitId} />
                    </div>
                  </>
                )}
              </section>

              <section className="rounded-xl border bg-card p-3">
                <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Actions sur cette visite
                </h2>
                <div className="flex flex-col gap-1">
                  <VisitShareButton reportId={visitId} siteName={identity.name} />
                  <RailLink href={`/m/visite/${visitId}/pdf`} icon={<FileDown className="h-4 w-4" aria-hidden />} label="Télécharger le compte-rendu" newTab />
                  <RailLink href={`/m/visite/${visitId}/recap`} icon={<Images className="h-4 w-4" aria-hidden />} label="Ouvrir sur mobile" />
                  {/* Annoncé, pas simulé : le lot n'est pas ouvert. */}
                  <span className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground/70">
                    <Paperclip className="h-4 w-4" aria-hidden />
                    Ajouter une preuve
                    <span className="ml-auto text-[11px]">à venir</span>
                  </span>
                  <RailLink href={`/sites/${id}`} icon={<Home className="h-4 w-4" aria-hidden />} label="Retour au chantier" />
                </div>
              </section>

              {/* COMPRENDRE LES STATUTS — de la pédagogie, pas de la décoration :
                  chaque mot de cette page a un sens précis, autant l'écrire. */}
              <section className="rounded-xl border bg-card p-3">
                <h2 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Comprendre les statuts
                </h2>
                <dl className="space-y-1.5 text-[12.5px] leading-snug">
                  <Statut mot="Ajouté après" sens="preuve versée au dossier après la clôture de la visite." />
                  <Statut mot="En attente" sens="proposition de MemorIA que personne n’a encore tranchée." />
                  <Statut mot="Obsolète" sens="proposition qu’une analyse plus récente ne redit plus — ce n’est pas un refus." />
                  <Statut mot="Produit" sens="objet dont la création par cette visite est démontrable." />
                </dl>
              </section>
            </div>
          }
        />
      </div>

    </div>
  )
}

/** L'état du compte-rendu, dit en clair — c'est la question qu'on se pose en
 *  arrivant : puis-je encore l'enrichir, ou est-il figé ? */
function CrState({ visitId, doc }: { visitId: string; doc: { status: string; validatedAt: string | null } | null }) {
  if (!doc) {
    return (
      <p className="text-sm">
        <span className="mr-2 rounded-full border border-dashed px-2.5 py-0.5 text-[13px] text-muted-foreground">
          Aucun compte-rendu
        </span>
        <Link href={`/m/visite/${visitId}/cr`} className="underline underline-offset-4">
          Le créer à partir de cette visite
        </Link>
      </p>
    )
  }
  const brouillon = doc.status === 'draft'
  return (
    <p className="text-sm">
      <span
        className={`mr-2 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${
          brouillon
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
            : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
        }`}
      >
        {brouillon ? 'Compte-rendu en brouillon' : `Compte-rendu finalisé${doc.validatedAt ? ` le ${frDate(doc.validatedAt)}` : ''}`}
      </span>
      <Link href={`/m/visite/${visitId}/cr`} className="inline-flex items-center gap-1 underline underline-offset-4">
        <FileText className="h-3.5 w-3.5" aria-hidden />
        {brouillon ? 'Ouvrir et compléter' : 'Ouvrir'}
      </Link>
    </p>
  )
}

function Compteur({ value, label, sub }: { value: number; label: string; sub?: string }) {
  return (
    <div>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
      <dt className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{label}</dt>
      {sub && <p className="text-[12px] text-muted-foreground/80">{sub}</p>}
    </div>
  )
}

function RailLink({ href, icon, label, newTab }: { href: string; icon: React.ReactNode; label: string; newTab?: boolean }) {
  return (
    <Link
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
    >
      {icon}
      {label}
    </Link>
  )
}

function Statut({ mot, sens }: { mot: string; sens: string }) {
  return (
    <div>
      <dt className="inline font-medium">{mot}</dt>
      <dd className="inline text-muted-foreground"> — {sens}</dd>
    </div>
  )
}

async function resolveConducteur(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await createAdminClient().from('users').select('full_name').eq('id', userId).maybeSingle()
  return (data as { full_name: string | null } | null)?.full_name?.trim() || null
}

const plural = (n: number, un: string, plusieurs: string) => (n > 0 ? `${n} ${n > 1 ? plusieurs : un}` : '')
const frHeure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const frDateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const frDuree = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`)
