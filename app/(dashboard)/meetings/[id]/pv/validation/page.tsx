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
  Users, History, ClipboardList, CalendarClock, ImageIcon, Download, FileText,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { buildPvValidation, type PvSection, type PvValidationItem } from '@/lib/documents/pv-validation'
import type { PvPointAConfirmer } from '@/lib/documents/meeting-to-cr-becib'

export const dynamic = 'force-dynamic'

const SECTION_META: Record<PvSection, { label: string; icon: typeof Users }> = {
  participants: { label: 'Participants', icon: Users },
  remarques_cr: { label: 'Remarques sur CR précédent', icon: History },
  points_examines: { label: 'Points examinés', icon: ClipboardList },
  previsions: { label: 'Prévisions', icon: CalendarClock },
  photos: { label: 'Photos', icon: ImageIcon },
}
const SECTION_ORDER: PvSection[] = ['participants', 'remarques_cr', 'points_examines', 'previsions', 'photos']

function ConfirmCard({ p }: { p: PvPointAConfirmer }) {
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{p.libelle}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-medium">{p.type}</span>
            {p.nature && <span>· {p.nature === 'metier' ? 'métier' : 'documentaire'}</span>}
            {p.proposition && (
              <span className="normal-case text-sky-700">· proposition : {p.proposition}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

export default async function PvValidationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { id } = await params
  const [report, pv] = await Promise.all([getSiteReport(id), buildPvValidation(id)])
  if (!report || !pv) notFound()

  const { readiness, gaps } = pv
  const dateLabel = new Date(report.created_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const bloquantsMetier = gaps.filter((g) => g.niveau === 'bloquant' && (g.nature ?? 'metier') === 'metier')
  const bloquantsDoc = gaps.filter((g) => g.niveau === 'bloquant' && g.nature === 'documentaire')
  const importants = gaps.filter((g) => g.niveau === 'important')
  const suggestions = gaps.filter((g) => g.niveau === 'suggestion')

  // Gate : un 🔴 MÉTIER ne se contourne jamais ; un 🔴 documentaire seul → « PV
  // urgent » possible (DOCX brouillon de toute façon autorisé).
  const gate = readiness.bloquants.metier > 0
    ? { cls: 'border-rose-200 bg-rose-50 text-rose-800', icon: ShieldAlert, title: 'PV non finalisable',
        detail: `${readiness.bloquants.metier} point(s) métier à lever (responsable d'action). Le PDF final reste désactivé.` }
    : readiness.bloquants.documentaire > 0
      ? { cls: 'border-amber-200 bg-amber-50 text-amber-900', icon: FileWarning, title: 'PV finalisable en mode urgent',
          detail: `${readiness.bloquants.documentaire} point(s) documentaire(s) (DNS, date) — contournables si le PV est urgent, sinon à compléter.` }
      : { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: CheckCircle2, title: 'Prêt pour le PV',
          detail: 'Aucun point bloquant. Vous pouvez générer le PV.' }
  const GateIcon = gate.icon

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

      {/* Gate + score */}
      <section className={`rounded-xl border p-4 ${gate.cls}`}>
        <div className="flex items-start gap-3">
          <GateIcon className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{gate.title}</h2>
              <span className="text-xs font-medium">Confiance {readiness.score}/100</span>
            </div>
            <p className="mt-1 text-sm">{gate.detail}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <span>🔴 {readiness.niveaux.bloquant} bloquant(s)</span>
              <span>🟠 {readiness.niveaux.important} important(s)</span>
              <span>🟢 {readiness.niveaux.suggestion} suggestion(s)</span>
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
          <ul className="space-y-1.5">{bloquantsMetier.map((p, i) => <ConfirmCard key={`bm${i}`} p={p} />)}</ul>
        </section>
      )}

      {bloquantsDoc.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-rose-700">
            <FileWarning className="h-3.5 w-3.5" /> Bloquants documentaires ({bloquantsDoc.length})
            <span className="ml-1 normal-case tracking-normal text-muted-foreground font-normal">— contournables en PV urgent</span>
          </h2>
          <ul className="space-y-1.5">{bloquantsDoc.map((p, i) => <ConfirmCard key={`bd${i}`} p={p} />)}</ul>
        </section>
      )}

      {importants.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Importants ({importants.length})
          </h2>
          <ul className="space-y-1.5">{importants.map((p, i) => <ConfirmCard key={`im${i}`} p={p} />)}</ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
            <Lightbulb className="h-3.5 w-3.5" /> Suggestions ({suggestions.length})
          </h2>
          <ul className="space-y-1.5">{suggestions.map((p, i) => <ConfirmCard key={`sg${i}`} p={p} />)}</ul>
        </section>
      )}

      {gaps.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Aucun point à confirmer — la mémoire est complète pour ce PV.</p>
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
          return (
            <div key={section} className="space-y-1.5">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {meta.label} ({list.length})
              </h3>
              <ul className="space-y-1">
                {list.map((it: PvValidationItem) => (
                  <li key={it.id} className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                    {it.blocking && <span title="Blocage métier" className="mt-0.5 text-rose-600">⛔</span>}
                    <span className="min-w-0 flex-1">{it.texte}</span>
                    {it.confiance === 'à confirmer' && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à confirmer</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>

      {/* Sorties : DOCX brouillon toujours dispo ; PDF final gated (cf. PvPanel). */}
      <section className="flex flex-wrap items-center gap-2 border-t pt-5">
        <a
          href={`/meetings/${id}/pv`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"
        >
          <Download className="h-4 w-4" /> Aperçu DOCX brouillon
        </a>
        <Link
          href={`/meetings/${id}`}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"
        >
          <FileText className="h-4 w-4" /> Générer / valider le PV
        </Link>
        {readiness.bloquants.metier > 0 && (
          <span className="text-xs text-muted-foreground">PDF final désactivé tant qu&apos;un bloquant métier subsiste.</span>
        )}
      </section>
    </div>
  )
}
