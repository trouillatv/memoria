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
import { ArrowLeft, FileDown, FileText, Home, Images } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildVisitNarrative } from '@/lib/db/visit-narrative'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { VisitShareButton } from '@/app/(field)/m/visite/[reportId]/VisitShareButton'
import { NarrativeReader, type CaptureMedia } from './recit/NarrativeReader'

export const dynamic = 'force-dynamic'

const KIND_PLURAL: Record<string, [string, string]> = {
  action: ['action', 'actions'],
  reserve: ['réserve', 'réserves'],
  decision: ['décision', 'décisions'],
  echeance: ['échéance', 'échéances'],
  memoire: ['élément à mémoriser', 'éléments à mémoriser'],
  intervenant: ['intervenant', 'intervenants'],
}

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

  const parKind = produced.reduce<Record<string, number>>((acc, p) => {
    acc[p.kind] = (acc[p.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href={`/sites/${id}/visites`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Visites
      </Link>

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
            label="captures sur le terrain"
            sub={[plural(vocaux, 'vocal', 'vocaux'), plural(photos, 'photo', 'photos'), plural(notes, 'note', 'notes')]
              .filter(Boolean)
              .join(' · ')}
          />
          <Compteur value={understood.length} label="éléments proposés par MemorIA" sub={plural(validated.pendingProposals, 'en attente', 'en attente')} />
          <Compteur
            value={gestes}
            label="gestes humains"
            sub={[plural(validated.ignoredProposals, 'écarté', 'écartés'), plural(validated.correctedSections.length, 'section corrigée', 'sections corrigées')]
              .filter(Boolean)
              .join(' · ')}
          />
          <Compteur value={produced.length} label="objets devenus permanents au chantier" />
        </dl>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Cette visite a produit :</span>
          {produced.length === 0 ? (
            <span className="text-muted-foreground">rien encore — aucune ligne du compte-rendu n’a été concrétisée.</span>
          ) : (
            Object.entries(parKind).map(([kind, n]) => (
              <span key={kind} className="rounded-full border px-2.5 py-0.5">
                {n} {KIND_PLURAL[kind]?.[n > 1 ? 1 : 0] ?? kind}
              </span>
            ))
          )}
          {validated.pendingProposals > 0 && (
            <span className="rounded-full border border-dashed px-2.5 py-0.5 text-muted-foreground">
              {validated.pendingProposals} restée{validated.pendingProposals > 1 ? 's' : ''} à l’état de proposition
            </span>
          )}
        </div>
      </header>

      <div className="py-8">
        <NarrativeReader
          narrative={narrative}
          media={media}
          canPromote={doc?.status === 'draft'}
          crHref={doc ? `/m/visite/${visitId}/cr` : null}
        />
      </div>

      {/* ── LES GESTES PÉRIPHÉRIQUES — utiles, mais pas le cœur de la visite ── */}
      <footer className="flex flex-wrap items-center gap-2 border-t pt-6">
        <VisitShareButton reportId={visitId} siteName={identity.name} />
        <FooterLink href={`/m/visite/${visitId}/pdf`} icon={<FileDown className="h-4 w-4" aria-hidden />} label="Télécharger le compte-rendu" newTab />
        <FooterLink href={`/m/visite/${visitId}/recap`} icon={<Images className="h-4 w-4" aria-hidden />} label="Ouvrir sur mobile" />
        <FooterLink href={`/sites/${id}`} icon={<Home className="h-4 w-4" aria-hidden />} label="Retour au chantier" />
      </footer>
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

function FooterLink({ href, icon, label, newTab }: { href: string; icon: React.ReactNode; label: string; newTab?: boolean }) {
  return (
    <Link
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
    >
      {icon}
      {label}
    </Link>
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
const frDuree = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`)
