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
  Users, History, ClipboardList, CalendarClock, ImageIcon,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { getLatestReportDocument } from '@/lib/db/report-documents'
import { listReportFinalVersions } from '@/lib/db/report-final-versions'
import { buildPvValidation, type PvSection } from '@/lib/documents/pv-validation'
import { PvConfirmCard } from './PvConfirmCard'
import { PvItemRow } from './PvItemRow'
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

  const { readiness, gaps } = pv
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
  const minutes = Math.max(1, Math.ceil(actifs.length * 0.5))

  return (
    <div className="space-y-6 w-full max-w-3xl">
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
              <>
                <p className="mt-1 text-sm">
                  {actifs.length} élément{actifs.length > 1 ? 's' : ''} à traiter — {resume.join(' · ')}.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a href="#a-corriger"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                    Corriger maintenant
                  </a>
                  <span className="text-xs opacity-80">≈ {minutes} min</span>
                </div>
              </>
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

      <div id="a-corriger" className="scroll-mt-4" />

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
          return (
            <div key={section} className="space-y-1.5">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {meta.label} ({list.length})
              </h3>
              <ul className="space-y-1">
                {list.map((it) => (
                  <PvItemRow key={it.id} reportId={id} item={it} excludable={excludable} />
                ))}
              </ul>
            </div>
          )
        })}
      </section>

      {/* Sorties : DOCX brouillon toujours dispo ; PDF final gated (cf. PvPanel). */}
      {/* HUB d'actions (Finding A) : on corrige ci-dessus, on prépare/diffuse ici —
          tout au même endroit, plus de va-et-vient vers la réunion. */}
      <PvPanel reportId={id} initial={pvDoc} finalVersions={finalVersions} hideValidationLink />
    </div>
  )
}
