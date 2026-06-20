// ÉCRAN DE VALIDATION DU PV — « la vitre du cockpit » (Vincent 2026-06-20).
//
// Tout le moteur existait déjà (PvValidation, PvReadiness, points à confirmer
// 3 niveaux) mais restait dans les logs : invisible pour Émeline. Cet écran le
// rend visible et lisible AVANT la génération du PV. Sprint 1 = la vitre (lecture
// + gate) ; l'interactivité Compléter/Reporter/Ignorer + propositions auto = les
// sprints suivants (Workflow Validation → PV). Doctrine : on n'affiche QUE ce qui
// compte, classé par sévérité ; on ne devine rien.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft, ShieldAlert, FileWarning, AlertTriangle, Lightbulb, CheckCircle2,
  Users, History, ClipboardList, CalendarClock, ImageIcon, FileText,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { listDecisionsByReport } from '@/lib/db/site-decisions'
import { listSiteIntervenants, getRoleActorMap, listSiteContacts } from '@/lib/db/site-intervenants'
import { getLatestReportDocument } from '@/lib/db/report-documents'
import { listReportFinalVersions } from '@/lib/db/report-final-versions'
import { listMeetingScopedPhotos } from '@/lib/db/site-photos'
import { listReportPhotoMeta, getCrPhotosComment } from '@/lib/db/report-photo-meta'
import { listReportHumanPoints } from '@/lib/db/report-human-points'
import { listReportAddedPoints } from '@/lib/db/report-added-points'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import { buildPvValidation, type PvSection } from '@/lib/documents/pv-validation'
import { PvConfirmCard } from './PvConfirmCard'
import { PvItemRow } from './PvItemRow'
import { PvPrevisionRow } from './PvPrevisionRow'
import { PvPhotoGrid, type PhotoCard } from './PvPhotoGrid'
import { PvHumanPoints } from './PvHumanPoints'
import { PvAddedPoints } from './PvAddedPoints'
import { PvActionsBlock, type ActionRow } from './PvActionsBlock'
import { PvDecisionsBlock } from './PvDecisionsBlock'
import { PvCastingBlock } from './PvCastingBlock'
import { PvParticipantRow, AddParticipant } from './PvParticipantRow'
import { PvResizable } from './PvResizable'
import { PvPanel } from '../../PvPanel'

export const dynamic = 'force-dynamic'

const SECTION_META: Record<PvSection, { label: string; icon: typeof Users }> = {
  participants: { label: 'Participants', icon: Users },
  remarques_cr: { label: 'Remarques sur CR précédent', icon: History },
  points_examines: { label: 'Points examinés', icon: ClipboardList },
  previsions: { label: 'Prévisions', icon: CalendarClock },
  photos: { label: 'Photos', icon: ImageIcon },
}
const SECTION_ORDER: PvSection[] = ['participants', 'remarques_cr', 'points_examines', 'previsions', 'photos']

export default async function PvValidationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { id } = await params
  const [report, pv, pvDoc, finalVersions] = await Promise.all([
    getSiteReport(id),
    buildPvValidation(id),
    getLatestReportDocument(id),
    listReportFinalVersions(id),
  ])
  if (!report || !pv) notFound()

  // ACTIONS éditables (Ajouter / Modifier / Supprimer) — l'entité la plus fréquente.
  // Colonne ACTION (codes responsables, mig 132) : la source d'un point typé 'action'
  // = l'id de l'action → on récupère ses codes mémorisés pour les éditer ici.
  const actionCodesBySource = new Map(
    pv.items.filter((i) => i.section === 'points_examines' && i.type === 'action').map((i) => [i.source, i.actionCodes ?? []]),
  )
  const actionRows: ActionRow[] = (await listSiteActionsByReport(id))
    .filter((a) => a.status !== 'cancelled')
    .map((a) => ({ id: a.id, title: a.title, assignedTo: a.assigned_to ?? '', dueDate: a.due_date ?? '', corpsEtat: a.corps_etat ?? '', actionCodes: actionCodesBySource.get(a.id) ?? [] }))

  // DÉCISIONS (mig 136) prises dans ce CR — mémoire durable, gérées dans leur bloc.
  const decisions = await listDecisionsByReport(id)

  // CASTING DU CHANTIER (mig 137) : rôle → entreprise → contact. Sert le bloc casting
  // ET l'enrichissement « ETV · BatiSud » des codes ACTION. Donnée SITE.
  const [intervenants, roleActorMap, siteContacts] = report.site_id
    ? await Promise.all([listSiteIntervenants(report.site_id), getRoleActorMap(report.site_id), listSiteContacts(report.site_id)])
    : [[], new Map<string, { company: string; contact: string | null }>(), []]
  const roleActors = Object.fromEntries(roleActorMap)
  // Options de liaison participant/décisionnaire → contact réel (« Jean Dupont — BatiSud »).
  const contactOptions = siteContacts.map((c) => ({
    id: c.id,
    label: c.function ? `${c.fullName} — ${c.companyName} (${c.function})` : `${c.fullName} — ${c.companyName}`,
  }))

  // PHOTOS (priorité #1) : vignettes signées + exclusion + ORDRE/COUVERTURE + commentaire.
  const sitePhotos = await listMeetingScopedPhotos({ id, site_id: report.site_id, created_at: report.created_at })
  const [thumbs, photoMeta, photosComment, humanPoints, addedPoints] = await Promise.all([
    getSignedPhotoUrlsThumb(sitePhotos.map((p) => p.storagePath)),
    listReportPhotoMeta(id),
    getCrPhotosComment(id),
    listReportHumanPoints(id),
    listReportAddedPoints(id),
  ])
  const excludedPhotoIds = new Set(pv.items.filter((i) => i.section === 'photos' && i.excluded).map((i) => i.source))
  // Ordre : couverture d'abord, puis sort_order, puis ordre par défaut (scopé).
  const orderedPhotos = [...sitePhotos].sort((a, b) => {
    const ma = photoMeta.get(a.id), mb = photoMeta.get(b.id)
    const ca = ma?.isCover ? 0 : 1, cb = mb?.isCover ? 0 : 1
    if (ca !== cb) return ca - cb
    return (ma?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (mb?.sortOrder ?? Number.MAX_SAFE_INTEGER)
  })
  const photoCards: PhotoCard[] = orderedPhotos.map((p) => ({
    id: p.id,
    source: p.source,
    thumbUrl: thumbs.get(p.storagePath) ?? null,
    legende: p.legende,
    excluded: excludedPhotoIds.has(p.id),
    isCover: photoMeta.get(p.id)?.isCover ?? false,
  }))

  const { readiness, gaps } = pv
  // Cache-buster de l'aperçu : nouveau à chaque rendu → après un router.refresh (suite
  // à une modif), l'iframe recharge le vrai PDF, côte-à-côte. « Aperçu vivant ».
  const previewTs = Date.now()
  const dateLabel = new Date(report.created_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // ACTIFS (à traiter) = signaux sans décision « levante ». 'reported' reste actif
  // (différé ≠ résolu) avec son badge ; 'ignored'/'false_positive' partent en « Traités ».
  const leve = (g: (typeof gaps)[number]) => g.decision?.statut === 'ignored' || g.decision?.statut === 'false_positive'
  const actifs = gaps.filter((g) => !leve(g))
  const traites = gaps.filter((g) => leve(g))

  const bloquantsMetier = actifs.filter((g) => g.niveau === 'bloquant' && (g.nature ?? 'metier') === 'metier')
  const bloquantsDoc = actifs.filter((g) => g.niveau === 'bloquant' && g.nature === 'documentaire')
  const importants = actifs.filter((g) => g.niveau === 'important')
  const suggestions = actifs.filter((g) => g.niveau === 'suggestion')

  // Gate DÉCISION-AWARE (pv.blocking / pv.durs) : un 🔴 dur encore ACTIF désactive
  // le PDF ; un 🔴 documentaire souple → « PV urgent » possible. DOCX : toujours.
  const gate = pv.blocking
    ? { cls: 'border-rose-200 bg-rose-50 text-rose-800', icon: ShieldAlert, title: 'PV non finalisable',
        detail: `${pv.durs} point(s) bloquant(s) dur(s) encore actif(s). PDF final désactivé (DOCX brouillon possible).` }
    : bloquantsDoc.length > 0
      ? { cls: 'border-amber-200 bg-amber-50 text-amber-900', icon: FileWarning, title: 'PV finalisable en mode urgent',
          detail: `${bloquantsDoc.length} point(s) documentaire(s) (DNS, date) — non bloquant(s) pour cette entreprise, à compléter ou assumer.` }
      : { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: CheckCircle2, title: 'Prêt pour le PV',
          detail: 'Aucun point bloquant actif. Vous pouvez générer le PV.' }
  const GateIcon = gate.icon

  // RÉSUMÉ action-first : « qu'est-ce qui m'empêche d'envoyer mon PV ? ». On agrège
  // les points ACTIFS par type, en langage clair, + une estimation de temps (≈ 30s
  // par point). L'utilisateur ne veut pas analyser, il veut agir → CTA « Corriger ».
  const TYPE_LABEL: Record<string, (n: number) => string> = {
    Responsable: (n) => `${n} responsable${n > 1 ? 's' : ''} manquant${n > 1 ? 's' : ''}`,
    'Échéance': (n) => `${n} échéance${n > 1 ? 's' : ''} à confirmer`,
    DNS: () => 'N° DNS absent',
    Date: () => 'date de prochaine réunion',
    Participant: (n) => `${n} organisme${n > 1 ? 's' : ''} à préciser`,
    Photo: (n) => `${n} photo${n > 1 ? 's' : ''} sans légende`,
  }
  const byType = new Map<string, number>()
  for (const g of actifs) byType.set(g.type, (byType.get(g.type) ?? 0) + 1)
  const resume = [...byType.entries()].map(([t, n]) => (TYPE_LABEL[t] ? TYPE_LABEL[t](n) : `${n} ${t}`))

  return (
    <div className="w-full max-w-[96rem]">
      <PvResizable
        left={
          <>
      <Link href={`/meetings/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Réunion
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Points à confirmer avant le PV</h1>
        <p className="text-sm text-muted-foreground capitalize">{report.title || 'Réunion'} · {dateLabel}</p>
        <p className="text-xs text-muted-foreground">
          MemorIA a compris l&apos;essentiel ; voici uniquement ce qui mérite votre confirmation avant de produire le PV.
        </p>
      </header>

      {/* Bandeau action-first : ce qui bloque, en clair, + temps + « Corriger ». */}
      <section className={`rounded-xl border p-4 ${gate.cls}`}>
        <div className="flex items-start gap-3">
          <GateIcon className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{gate.title}</h2>
              <span className="text-xs font-medium opacity-80">Confiance {readiness.score}/100</span>
            </div>

            {actifs.length > 0 ? (
              <p className="mt-1 text-sm">
                {actifs.length} élément{actifs.length > 1 ? 's' : ''} à traiter — {resume.join(' · ')}.
              </p>
            ) : (
              <p className="mt-1 text-sm">{gate.detail}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-3 text-xs opacity-80">
              <span>🔴 {readiness.niveaux.bloquant}</span>
              <span>🟠 {readiness.niveaux.important}</span>
              <span>🟢 {readiness.niveaux.suggestion}</span>
              {traites.length > 0 && <span>· {traites.length} traité{traites.length > 1 ? 's' : ''}</span>}
            </div>
          </div>
        </div>
      </section>

      {/* Points à confirmer, par sévérité */}
      {bloquantsMetier.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-rose-700">
            <ShieldAlert className="h-3.5 w-3.5" /> Bloquants métier ({bloquantsMetier.length})
          </h2>
          <ul className="space-y-1.5">{bloquantsMetier.map((p) => <PvConfirmCard key={p.id} reportId={id} signal={p} />)}</ul>
        </section>
      )}

      {bloquantsDoc.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-rose-700">
            <FileWarning className="h-3.5 w-3.5" /> Bloquants documentaires ({bloquantsDoc.length})
            <span className="ml-1 normal-case tracking-normal text-muted-foreground font-normal">— contournables en PV urgent</span>
          </h2>
          <ul className="space-y-1.5">{bloquantsDoc.map((p) => <PvConfirmCard key={p.id} reportId={id} signal={p} />)}</ul>
        </section>
      )}

      {importants.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Importants ({importants.length})
          </h2>
          <ul className="space-y-1.5">{importants.map((p) => <PvConfirmCard key={p.id} reportId={id} signal={p} />)}</ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
            <Lightbulb className="h-3.5 w-3.5" /> Suggestions ({suggestions.length})
          </h2>
          <ul className="space-y-1.5">{suggestions.map((p) => <PvConfirmCard key={p.id} reportId={id} signal={p} />)}</ul>
        </section>
      )}

      {actifs.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Aucun point à confirmer actif — vous pouvez générer le PV.</p>
      )}

      {/* Traités : ignorés / faux positifs (levés du gate), repliés. Annulables. */}
      {traites.length > 0 && (
        <details className="group rounded-lg border bg-card">
          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Traités ({traites.length})
          </summary>
          <ul className="space-y-1.5 border-t p-3">{traites.map((p) => <PvConfirmCard key={p.id} reportId={id} signal={p} />)}</ul>
        </details>
      )}

      {/* Casting du chantier — qui est qui (rôle → entreprise → contact). Alimente la
          colonne ACTION (« ETV · BatiSud ») et les futures relances. Donnée site. */}
      <div className="border-t pt-5">
        <PvCastingBlock reportId={id} intervenants={intervenants} />
      </div>

      {/* Actions — Ajouter / Modifier / Supprimer (l'entité la plus fréquente). */}
      <div className="border-t pt-5">
        <PvActionsBlock reportId={id} actions={actionRows} roleActors={roleActors} />
      </div>

      {/* Décisions — « on a décidé que… » : mémoire durable du site, projetée dans
          les Points administratifs du CR (spine), gérée ici (pas d'écran parallèle). */}
      <div className="border-t pt-5">
        <PvDecisionsBlock reportId={id} decisions={decisions} contacts={contactOptions} actions={actionRows.map((a) => ({ id: a.id, label: a.title }))} />
      </div>

      {/* Ajouts STRUCTURÉS en séance (anomalie / prévision) — objets typés mémorisés. */}
      <div className="border-t pt-5">
        <PvAddedPoints reportId={id} points={addedPoints} />
      </div>

      {/* Remarques humaines ajoutées (texte libre par section) — injectées dans le CR. */}
      <div className="border-t pt-5">
        <PvHumanPoints reportId={id} points={humanPoints} />
      </div>

      {/* Ce qui ira dans le PV (contenu typé, lecture) */}
      <section className="space-y-3 border-t pt-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Contenu qui ira dans le PV ({pv.items.length})
        </h2>
        {SECTION_ORDER.map((section) => {
          const list = pv.items.filter((it) => it.section === section)
          if (list.length === 0) return null
          const meta = SECTION_META[section]
          const Icon = meta.icon
          // Lignes parasites (anomalies « szdz »…) excludables là où elles vivent.
          const excludable = section === 'points_examines' || section === 'previsions'
          // Participants : ligne ÉDITABLE (nom + organisme + présence → mémoire, #5).
          if (section === 'participants') {
            const ps = report.participants ?? []
            return (
              <div key={section} className="space-y-1.5">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {meta.label} ({ps.length})
                </h3>
                <ul className="space-y-1">
                  {ps.map((p, i) => (
                    <PvParticipantRow key={i} reportId={id} index={i} name={p.name} role={p.role ?? ''} presence={p.presence ?? 'P'} invite={p.invite ?? true} diffusion={p.diffusion ?? false} contactId={p.contactId} contacts={contactOptions} />
                  ))}
                </ul>
                <AddParticipant reportId={id} />
              </div>
            )
          }
          // Photos : grille éditable (vignette + légende + exclure), pas une liste de texte.
          if (section === 'photos') {
            return (
              <div key={section} className="space-y-1.5">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {meta.label} ({photoCards.length})
                </h3>
                <PvPhotoGrid reportId={id} photos={photoCards} comment={photosComment ?? ''} />
              </div>
            )
          }
          // Actions ET décisions retirées d'ici (gérées dans leurs blocs éditables
          // au-dessus ; elles restent projetées dans le CR via le spine).
          const display = section === 'points_examines' ? list.filter((it) => it.type !== 'action' && it.type !== 'decision') : list
          if (display.length === 0) return null
          return (
            <div key={section} className="space-y-1.5">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {meta.label} ({display.length})
              </h3>
              <ul className="space-y-1">
                {/* Prévisions = lignes STRUCTURÉES (qui/quand/fiabilité) ; le reste = ligne simple. */}
                {section === 'previsions'
                  ? display.map((it) => <PvPrevisionRow key={it.id} reportId={id} item={it} />)
                  : display.map((it) => <PvItemRow key={it.id} reportId={id} item={it} excludable={excludable} roleActors={roleActors} />)}
              </ul>
            </div>
          )
        })}
      </section>

      {/* Sorties : DOCX brouillon toujours dispo ; PDF final gated (cf. PvPanel). */}
      {/* HUB d'actions (Finding A) : on corrige ci-dessus, on prépare/diffuse ici —
          tout au même endroit, plus de va-et-vient vers la réunion. */}
      <PvPanel reportId={id} initial={pvDoc} finalVersions={finalVersions} hideValidationLink />
          </>
        }
        right={
          <>
            {/* Aperçu vivant du CR : le vrai PDF, rechargé à chaque modif. */}
            <h2 className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> Aperçu du CR
              <span className="ml-1 normal-case tracking-normal text-muted-foreground/70 font-normal">— glissez la poignée pour agrandir</span>
            </h2>
            <iframe title="Aperçu du CR" src={`/meetings/${id}/pv?t=${previewTs}`} className="h-[80vh] w-full rounded-lg border bg-white" />
            <a href={`/meetings/${id}/pv`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
              Ouvrir en grand →
            </a>
          </>
        }
      />
    </div>
  )
}
