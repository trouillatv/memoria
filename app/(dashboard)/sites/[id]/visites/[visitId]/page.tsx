// LA PAGE D'UNE VISITE — un bureau de traitement, pas un rapport.
//
// Il existait deux pages pour une même visite : un « Débrief de chantier » resté
// au monde d'avant le compte-rendu documentaire, et le récit. Deux portes vers
// le même objet suffisaient à rendre le produit illisible. Cette adresse EST la
// visite, et la seule.
//
// « Une page ne doit proposer que les gestes cohérents avec son récit. » Sur une
// visite : écouter, comprendre, raconter, arbitrer, concrétiser. Créer une
// action ex nihilo n'appartient pas à cette histoire — cela rouvrirait une
// deuxième porte vers un objet que la concrétisation fabrique déjà, avec sa
// provenance.
//
// L'ORDRE EST CELUI DE LA LECTURE, PAS CELUI DU PIPELINE : ce qui s'est passé,
// ce que MemorIA en a compris, ce qui attend une décision. L'audit — ignoré,
// obsolète — descend en bas, à un clic.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Camera, CheckCircle2, ChevronRight, FileDown, FileText, Home, Images, Pencil,
  Sparkles, Users,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildVisitNarrative } from '@/lib/db/visit-narrative'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { VisitShareButton } from '@/app/(field)/m/visite/[reportId]/VisitShareButton'
import { VisitDesk, type CaptureMedia } from './VisitDesk'
import { ReanalyseButton } from './ReanalyseButton'
import { VerserPiece } from './VerserPiece'

export const dynamic = 'force-dynamic'

/** Les familles d'arbitrage — la MÊME teinte que dans le bureau, d'un bout à
 *  l'autre de la page : c'est ce qui permet de retrouver « les échéances » sans
 *  lire les mots. */
const FAMILLES: Array<{ cle: string; un: string; plusieurs: string; teinte: string }> = [
  { cle: 'action', un: 'action', plusieurs: 'actions', teinte: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  { cle: 'deadline', un: 'échéance', plusieurs: 'échéances', teinte: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
  { cle: 'stakeholder', un: 'intervenant', plusieurs: 'intervenants', teinte: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  { cle: 'knowledge', un: 'connaissance', plusieurs: 'connaissances', teinte: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' },
  { cle: 'vigilance', un: 'vigilance', plusieurs: 'vigilances', teinte: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
  { cle: 'decision', un: 'décision', plusieurs: 'décisions', teinte: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' },
]

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

  // Le résumé affiché est celui du compte-rendu HUMAIN — jamais un second texte
  // fabriqué pour l'en-tête.
  const resume = doc?.sections.find((s) => s.key === 'resume')?.content?.trim() || null
  const crHref = doc ? `/m/visite/${visitId}/cr` : null

  const debut = visit.started_at ?? visit.created_at
  const minutes = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null

  const { captured, understood, produced, enrichment } = narrative
  const vocaux = captured.filter((c) => c.kind === 'vocal').length
  const photos = captured.filter((c) => c.kind === 'photo').length
  const videos = captured.filter((c) => c.kind === 'video').length
  const intervenants = understood.filter((p) => p.type === 'stakeholder').length
  const enAttente = understood.filter((p) => p.status === 'proposed')
  const parFamille = FAMILLES.map((f) => ({ ...f, n: enAttente.filter((p) => p.type === f.cle).length })).filter((f) => f.n > 0)

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link href="/sites" className="hover:text-foreground">Chantiers</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <Link href={`/sites/${id}/visites`} className="hover:text-foreground">Visites</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium text-foreground">Visite du {frDate(debut)}</span>
        </nav>
        <Link
          href={`/sites/${id}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          <Home className="h-3.5 w-3.5" aria-hidden />
          Retour au chantier
        </Link>
      </div>

      {/* ── IDENTITÉ ────────────────────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-balance text-3xl font-semibold tracking-tight">Visite du {frDate(debut)}</h1>
          <EtatCr crHref={crHref} doc={narrative.validated.document} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="tabular-nums">
            {frHeure(debut)}
            {visit.ended_at ? ` → ${frHeure(visit.ended_at)}` : ''}
            {minutes !== null ? ` (${frDuree(minutes)})` : ''}
          </span>
          {conducteur && (
            <span>
              Par <span className="font-medium text-foreground">{conducteur}</span> · Conducteur de travaux
            </span>
          )}
          {!visit.ended_at && <span>visite en cours</span>}
        </p>
      </header>

      <div className="lg:flex lg:items-start lg:gap-4">
        <div className="min-w-0 flex-1 space-y-4">
          {/* ── ÉTAT DE L'ANALYSE — jamais un numéro de version ─────────────── */}
          <BandeauAnalyse enrichment={enrichment} visitId={visitId} crHref={crHref} />

          {/* ── RÉSUMÉ + LES QUATRE CHIFFRES ────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-4 lg:flex lg:gap-6">
            <div className="min-w-0 lg:w-2/5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
                Résumé de la visite
              </h2>
              {resume ? (
                <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed">{resume}</p>
              ) : (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Aucun compte-rendu n’a encore été rédigé pour cette visite.
                </p>
              )}
              {crHref && (
                <Link href={crHref} className="mt-3 inline-block text-[13px] font-medium text-primary hover:underline">
                  Voir le compte-rendu complet ↗
                </Link>
              )}
            </div>
            <dl className="mt-4 grid flex-1 grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <Chiffre
                icon={Camera}
                teinte="text-sky-600"
                valeur={captured.length}
                label="captures"
                sous={[plural(photos, 'photo', 'photos'), plural(vocaux, 'vocal', 'vocaux'), plural(videos, 'vidéo', 'vidéos')]
                  .filter(Boolean)
                  .join(', ')}
              />
              <Chiffre icon={Sparkles} teinte="text-violet-600" valeur={understood.length} label="propositions" sous="détectées par MemorIA" />
              <Chiffre icon={Users} teinte="text-emerald-600" valeur={intervenants} label="intervenants" sous="détectés" />
              <Chiffre icon={FileText} teinte="text-slate-600" valeur={produced.length} label="objets produits" sous="rattachés à ce récit" />
            </dl>
          </section>

          <VisitDesk narrative={narrative} media={media} canPromote={doc?.status === 'draft'} crHref={crHref} />
        </div>

        {/* ── RAIL — les gestes, l'arbitrage, le vocabulaire ─────────────────── */}
        <aside className="mt-4 space-y-4 lg:mt-0 lg:w-80 lg:shrink-0">
          <section className="rounded-xl border bg-card p-3">
            <h2 className="mb-2 text-[13px] font-semibold">Actions sur cette visite</h2>
            <VisitShareButton reportId={visitId} siteName={identity.name} />
            <div className="mt-1 divide-y">
              {enrichment.sinceLastAnalysis > 0 && (
                <div className="py-1.5">
                  <ReanalyseButton reportId={visitId} />
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {enrichment.sinceLastAnalysis} pièce{enrichment.sinceLastAnalysis > 1 ? 's versées' : ' versée'} depuis l’analyse
                  </p>
                </div>
              )}
              <div className="py-1.5">
                <VerserPiece reportId={visitId} visitStartedAt={debut} />
                <p className="pl-8 text-[11.5px] text-muted-foreground">Photo, vocal, vidéo</p>
              </div>
              <RailLink href={`/m/visite/${visitId}/pdf`} icon={<FileDown className="h-4 w-4" aria-hidden />} label="Télécharger le compte-rendu" sous="PDF" newTab />
              <RailLink href={`/m/visite/${visitId}/recap`} icon={<Images className="h-4 w-4" aria-hidden />} label="Ouvrir sur mobile" />
            </div>
          </section>

          {/* ── ARBITRAGES — le vrai travail, chiffré par famille ───────────── */}
          {enAttente.length > 0 && (
            <section className="rounded-xl border bg-card p-3">
              <h2 className="text-[13px] font-semibold">Arbitrages</h2>
              <p className="mt-1 text-[13px] font-medium">
                {enAttente.length} décision{enAttente.length > 1 ? 's vous attendent' : ' vous attend'}
              </p>
              <ul className="mt-2 space-y-1.5">
                {parFamille.map((f) => (
                  <li key={f.cle} className="flex items-center gap-2 text-[13px]">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold tabular-nums ${f.teinte}`}>
                      {f.n}
                    </span>
                    {f.n > 1 ? f.plusieurs : f.un}
                  </li>
                ))}
              </ul>
              {crHref && (
                <Link
                  href={crHref}
                  className="mt-3 block rounded-lg bg-primary px-3 py-2 text-center text-[13px] font-medium text-primary-foreground hover:opacity-90"
                >
                  Commencer l’arbitrage
                </Link>
              )}
            </section>
          )}

          {/* ── COMPRENDRE LES STATUTS — chaque mot de cette page a un sens ─── */}
          <section className="rounded-xl border bg-card p-3">
            <h2 className="mb-2 text-[13px] font-semibold">Comprendre les statuts</h2>
            <dl className="space-y-2.5">
              <Statut mot="En attente" teinte="bg-sky-500" sens="Proposition de MemorIA à arbitrer." />
              <Statut mot="Confirmée" teinte="bg-emerald-500" sens="Vous l’avez validée. Elle peut être concrétisée." />
              <Statut mot="Écartée" teinte="bg-rose-500" sens="Vous l’avez refusée. Elle n’apparaîtra plus." />
              <Statut mot="Obsolète" teinte="bg-amber-500" sens="Devenue dépassée après une nouvelle analyse — ce n’est pas un refus." />
              <Statut mot="Ajoutée après" teinte="bg-slate-400" sens="Pièce versée au dossier après la visite." />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** L'état du compte-rendu, en une pastille : puis-je encore l'enrichir ? */
function EtatCr({ crHref, doc }: { crHref: string | null; doc: { status: string; validatedAt: string | null } | null }) {
  if (!doc || !crHref) {
    return (
      <span className="rounded-full border border-dashed px-2.5 py-1 text-[12.5px] text-muted-foreground">
        Aucun compte-rendu
      </span>
    )
  }
  const brouillon = doc.status === 'draft'
  return (
    <Link
      href={crHref}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${
        brouillon
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
      }`}
    >
      {brouillon ? 'Compte-rendu en brouillon' : `Compte-rendu finalisé${doc.validatedAt ? ` le ${frDate(doc.validatedAt)}` : ''}`}
      <Pencil className="h-3 w-3" aria-hidden />
    </Link>
  )
}

/** Trois états, et AUCUN numéro de version : `analysis_version` mesure la
 *  dernière analyse ayant RECONDUIT une proposition, pas sa naissance.
 *  Numéroter les analyses compterait comme neuve une proposition née à la
 *  première et simplement redite (tranché 2026-07-22). */
function BandeauAnalyse({
  enrichment,
  visitId,
  crHref,
}: {
  enrichment: { afterVisit: number; sinceLastAnalysis: number; lastAnalysisAt: string | null }
  visitId: string
  crHref: string | null
}) {
  if (!enrichment.lastAnalysisAt) {
    return (
      <section className="rounded-xl border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
        Cette visite n’a pas encore été lue par MemorIA.
      </section>
    )
  }
  const aJour = enrichment.sinceLastAnalysis === 0
  return (
    <section
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${
        aJour
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'
          : 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
      }`}
    >
      <CheckCircle2 className={`h-5 w-5 shrink-0 ${aJour ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">{aJour ? 'Analyse MemorIA à jour' : 'Analyse MemorIA dépassée'}</p>
        <p className="text-[12.5px] text-muted-foreground">
          {aJour
            ? 'Aucune nouvelle pièce depuis la dernière analyse.'
            : `${enrichment.sinceLastAnalysis} pièce${enrichment.sinceLastAnalysis > 1 ? 's ont été versées' : ' a été versée'} depuis la dernière analyse.`}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          Dernière analyse le {frDateHeure(enrichment.lastAnalysisAt)}
        </span>
        {aJour
          ? crHref && (
            <Link href={crHref} className="rounded-lg border bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-muted">
              Voir le détail
            </Link>
          )
          : <ReanalyseButton reportId={visitId} />}
      </div>
    </section>
  )
}

function Chiffre({
  icon: Icon,
  teinte,
  valeur,
  label,
  sous,
}: {
  icon: typeof Camera
  teinte: string
  valeur: number
  label: string
  sous?: string
}) {
  return (
    <div>
      <Icon className={`h-4 w-4 ${teinte}`} aria-hidden />
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{valeur}</dd>
      <dt className="text-[12.5px] leading-snug">{label}</dt>
      {sous && <p className="text-[11.5px] leading-snug text-muted-foreground">{sous}</p>}
    </div>
  )
}

function RailLink({
  href, icon, label, sous, newTab,
}: { href: string; icon: React.ReactNode; label: string; sous?: string; newTab?: boolean }) {
  return (
    <Link
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
    >
      <span className="mt-0.5">{icon}</span>
      <span>
        {label}
        {sous && <span className="block text-[11.5px] text-muted-foreground">{sous}</span>}
      </span>
    </Link>
  )
}

function Statut({ mot, teinte, sens }: { mot: string; teinte: string; sens: string }) {
  return (
    <div className="flex gap-2">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${teinte}`} />
      <div>
        <dt className="text-[13px] font-medium">{mot}</dt>
        <dd className="text-[12px] leading-snug text-muted-foreground">{sens}</dd>
      </div>
    </div>
  )
}

async function resolveConducteur(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await createAdminClient().from('users').select('full_name').eq('id', userId).maybeSingle()
  return (data as { full_name: string | null } | null)?.full_name?.trim() || null
}

const plural = (n: number, un: string, plusieurs: string) => (n > 0 ? `${n} ${n > 1 ? plusieurs : un}` : '')
// Le rendu serveur tourne en UTC : sans `timeZone`, une capture de 09:15 à
// Nouméa s'affichait 22:15 la veille. Le fuseau de l'organisation est donc
// passé EXPLICITEMENT partout — c'est le meme ecueil que `todayLocalIso`.
const frHeure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit' })
const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })
const frDateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const frDuree = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`)
