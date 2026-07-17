import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Eye, Handshake, ShieldAlert, Info, FileX2, Mic, StickyNote, Camera, Video, ClipboardCheck, AlertTriangle, Smartphone, Send, Trophy, XCircle, RotateCcw, Building2, Map as MapIcon, Star, HelpCircle, Check, FileText } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getDossier } from '@/lib/db/dossiers'
import { readForTender, type TakeoverItem } from '@/lib/db/dossier-readings'
import { listGeolocatedCapturesBySite } from '@/lib/db/visit-captures'
import { listResolvedQuestionsByDossier } from '@/lib/db/captured-knowledge'
import { listTendersByDossier, listAttachableTenders } from '@/lib/db/tenders'
import { getLatestComprehensionRun, getComprehensionTrackRecord } from '@/lib/db/comprehension'
import { CaptureMap, type MapCapture } from '@/components/CaptureMap'
import { setDossierPhaseAction, resolveQuestionAction, attachTenderToDossierAction } from './actions'
import { ExportSynthesisButton } from './ExportSynthesisButton'
import { ComprehensionPanel } from './ComprehensionPanel'

export const dynamic = 'force-dynamic'

// « Dossier de réponse à l'appel d'offre » — LECTURE métier déterministe d'une
// PRÉVISITE (readForTender), scopée au DOSSIER (opération), pas au site. La mémoire
// de LIEU (à-savoir, pièges) est héritée du site et partagée entre opérations.
// Zéro IA : on restitue la matière captée, organisée pour chiffrer. La couche IA
// (« voilà ce que j'ai compris », puis mémoire technique) viendra par-dessus, gated.
// Prototype : accessible par URL, pas encore dans la navigation principale.

const PHASE_FR: Record<string, string> = { prospect: 'Prospection', en_ao: 'Préparation AO', actif: 'Travaux', perdu: 'Perdu', archive: 'Archivé' }
const KIND_FR: Record<string, string> = { photo: 'Photo', video: 'Vidéo', vocal: 'Vocal', note: 'Note', verification: 'Vérification', position: 'Position' }
const STATE_FR: Record<string, string> = { bloqué: 'Bloqué', en_attente: 'En attente', dormant: 'En sommeil', ouvert: 'Ouvert', clos: 'Clos' }
const STATE_CLS: Record<string, string> = {
  bloqué: 'bg-rose-100 text-rose-700', en_attente: 'bg-amber-100 text-amber-800',
  dormant: 'bg-slate-100 text-slate-600', ouvert: 'bg-sky-100 text-sky-700', clos: 'bg-emerald-100 text-emerald-700',
}

export default async function DossierAoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const dossier = await getDossier(id)
  if (!dossier) notFound()
  const r = await readForTender(id)
  const [geoCaps, attachedTenders, attachableTenders, resolvedQuestions, comprehensionRun, trackRecord] = await Promise.all([
    listGeolocatedCapturesBySite(dossier.site_id).catch(() => []),
    listTendersByDossier(dossier.id).catch(() => []),
    listAttachableTenders().catch(() => []),
    listResolvedQuestionsByDossier(dossier.id).catch(() => []),
    getLatestComprehensionRun(dossier.id).catch(() => null),
    getComprehensionTrackRecord(user.organization_id).catch(() => ({ evaluatedRuns: 0, conductors: 0 })),
  ])
  const mapCaps: MapCapture[] = geoCaps.map((c) => ({
    id: c.id, kind: c.kind, lat: c.lat, lng: c.lng, created_at: c.created_at,
    body: c.body, reportId: c.report_id, subjectName: c.subject_name,
  }))

  // Récit de l'affaire — « où j'en suis ». DÉTERMINISTE, dérivé des données déjà
  // chargées (captures / AO rattachés / phase). Non bloquant : juste l'histoire.
  const lost = dossier.phase === 'perdu'
  const advanced = dossier.phase === 'actif' || dossier.phase === 'archive'
  const recitSteps: Array<{ label: string; done: boolean; lost?: boolean }> = [
    { label: 'Prospection', done: true },
    { label: 'Prévisite', done: r.observed.capturesTotal > 0 },
    { label: 'AO reçu', done: attachedTenders.length > 0 },
    { label: 'Analyse de l’AO', done: attachedTenders.some((t) => ['ready', 'submitted', 'archived'].includes(t.status)) },
    { label: 'Réponse envoyée', done: attachedTenders.some((t) => t.status === 'submitted') },
    lost ? { label: 'Perdu', done: true, lost: true } : { label: 'Marché gagné', done: advanced },
    { label: 'Chantier actif', done: advanced },
  ]

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/opportunites`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Affaires
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{r.clientName ?? 'Donneur d’ordre à préciser'}{r.address ? ` · ${r.address}` : ''}</p>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
            {PHASE_FR[dossier.phase] ?? dossier.phase}
          </span>
        </div>
        <h1 className="text-2xl font-bold">{r.siteName}</h1>
        <p className="text-sm text-muted-foreground">
          Affaire — ce que la prévisite a capté, organisé pour répondre à l&apos;appel d&apos;offres. Mémoire terrain, aucune IA.
        </p>
      </header>

      {/* Récit de l'affaire — « où j'en suis ». Pas un workflow bloquant : une histoire. */}
      <AffaireRecit steps={recitSteps} />

      {/* Export « Synthèse de prévisite pour réponse AO » — copier/coller ou .md.
          Déterministe : la matière captée + les points vérifiés, mise en forme. */}
      {!r.isEmpty && <ExportSynthesisButton dossierId={dossier.id} />}

      {/* « Voilà ce que j'ai compris » — protocole d'évaluation IA (mig 179).
          L'IA propose des affirmations atomiques + provenance ; l'humain juge. */}
      {(!r.isEmpty || comprehensionRun) && (
        <ComprehensionPanel dossierId={dossier.id} run={comprehensionRun} trackRecord={trackRecord} />
      )}

      {/* Cycle de vie du dossier — la soudure arrière. « Marché gagné » fait du
          dossier un chantier SANS copie : la mémoire de prévisite suit. */}
      <PhaseBar dossierId={dossier.id} siteId={dossier.site_id} phase={dossier.phase} />

      {/* Continuer la collecte sur le terrain (mobile). La prévisite = une visite sur le LIEU. */}
      <Link
        href={`/m/site/${dossier.site_id}`}
        className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
      >
        <Smartphone className="h-4 w-4 text-sky-600" /> Continuer la prévisite sur le terrain
      </Link>

      {/* Soudure AVANT : les AO rattachés à cette opportunité (0..N, souvent 1). Le
          tender est un ÉPISODE rattaché — la mémoire reste portée par le dossier. */}
      <section className="rounded-2xl border bg-card p-4 space-y-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="h-4 w-4" /> Appels d&apos;offres rattachés
        </h2>
        {attachedTenders.length > 0 ? (
          <ul className="space-y-1.5">
            {attachedTenders.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                <Link href={`/tenders/${t.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">{t.title}</Link>
                <form action={attachTenderToDossierAction} className="shrink-0">
                  <input type="hidden" name="tenderId" value={t.id} />
                  <input type="hidden" name="dossierId" value={dossier.id} />
                  <input type="hidden" name="detach" value="1" />
                  <button type="submit" className="text-[11px] text-muted-foreground hover:text-destructive">Détacher</button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Aucun AO rattaché. Quand l&apos;appel d&apos;offres arrive, relie-le ici.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Chemin PRINCIPAL : créer l'AO depuis l'affaire → dossier_id auto-rempli. */}
          <Link
            href={`/tenders/new?dossier_id=${dossier.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            <FileText className="h-4 w-4" /> Créer un appel d&apos;offres
          </Link>
          {/* Exception : rattacher un AO déjà importé (reçu par mail). */}
          {attachableTenders.length > 0 && (
            <form action={attachTenderToDossierAction} className="flex min-w-0 flex-1 items-center gap-2">
              <input type="hidden" name="dossierId" value={dossier.id} />
              <select name="tenderId" required defaultValue="" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm">
                <option value="" disabled>…ou rattacher un AO existant</option>
                {attachableTenders.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <button type="submit" className="shrink-0 rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted">Rattacher</button>
            </form>
          )}
        </div>
      </section>

      {r.isEmpty ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Rien n&apos;a encore été capté sur cette affaire. Lancez une prévisite : photos, vocaux,
          notes, mesures et infos entendues nourriront ce dossier.
        </p>
      ) : (
        <>
          {/* Éléments marqués sur le terrain — la sélection de Guillaume, son point de
              départ pour rédiger l'AO (plutôt que refouiller toutes les captures). */}
          {r.starred.length > 0 && (
            <Block icon={<Star className="h-4 w-4 fill-amber-400 text-amber-500" />} title="Marqués pour le mémoire technique">
              <ul className="space-y-1">
                {r.starred.map((it) => (
                  <li key={it.id} className="flex items-start gap-1.5 text-sm">
                    <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />
                    <span className="min-w-0">
                      {it.text}
                      <span className="ml-1.5 text-[11px] text-muted-foreground">{KIND_FR[it.kind] ?? it.kind}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {/* ❓ « À vérifier » — ce qu'on ne sait pas encore. On STOCKE la réponse
              (mig 178), pas juste « résolu » : la valeur AO est dans ce qu'on a
              trouvé. Pas d'assignation/échéance/priorité — pas un outil de tâches. */}
          {r.questions.length > 0 && (
            <Block icon={<HelpCircle className="h-4 w-4 text-amber-600" />} title="Points à vérifier">
              <ul className="space-y-2.5">
                {r.questions.map((q) => (
                  <li key={q.id} className="rounded-lg border bg-background px-3 py-2.5">
                    <p className="flex items-start gap-1.5 text-sm font-medium">
                      <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span className="min-w-0">{q.text}</span>
                    </p>
                    <form action={resolveQuestionAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="dossierId" value={dossier.id} />
                      <input
                        name="answer" type="text" maxLength={2000}
                        placeholder="Réponse trouvée (ex. diamètre 200, compteur en limite de propriété…)"
                        className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button type="submit" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 px-2.5 py-1.5 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50">
                        <Check className="h-3.5 w-3.5" /> Vérifié
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {/* Points VÉRIFIÉS — question → réponse trouvée. C'est la matière qui
              part directement dans la réponse AO. */}
          {resolvedQuestions.length > 0 && (
            <Block icon={<Check className="h-4 w-4 text-emerald-600" />} title="Points vérifiés">
              <ul className="space-y-1.5">
                {resolvedQuestions.map((q) => (
                  <li key={q.id} className="rounded-lg bg-emerald-50/60 px-3 py-2 text-sm dark:bg-emerald-950/20">
                    <p className="font-medium">{q.question}</p>
                    <p className="mt-0.5 flex items-start gap-1 text-emerald-800 dark:text-emerald-300">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0">{q.answer?.trim() ? q.answer : 'Vérifié'}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {/* Ce qu'on a observé sur site — la matière brute, à transformer en postes. */}
          <Block icon={<Eye className="h-4 w-4 text-sky-600" />} title="Ce qu'on a observé sur place">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Stat icon={<Camera className="h-3.5 w-3.5" />} n={r.observed.photos} label="photo" />
              <Stat icon={<Video className="h-3.5 w-3.5" />} n={r.observed.videos} label="vidéo" />
              <Stat icon={<Mic className="h-3.5 w-3.5" />} n={r.observed.vocals.length} label="vocal" />
              <Stat icon={<StickyNote className="h-3.5 w-3.5" />} n={r.observed.notes.length} label="note" />
              <Stat icon={<ClipboardCheck className="h-3.5 w-3.5" />} n={r.observed.verifications} label="vérification" />
            </div>
            {(r.observed.notes.length > 0 || r.observed.vocals.length > 0) && (
              <ul className="mt-2 space-y-1.5">
                {r.observed.notes.map((it) => (
                  <li key={it.id} className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">{it.text}</span>
                  </li>
                ))}
                {r.observed.vocals.map((it) => (
                  <li key={it.id} className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">{it.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {mapCaps.length > 0 && (
            <Block icon={<MapIcon className="h-4 w-4 text-sky-600" />} title="Carte des observations">
              <CaptureMap siteId={dossier.site_id} captures={mapCaps} heightClass="h-[360px]" />
            </Block>
          )}

          {r.toWatch.length > 0 && (
            <Block icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} title="Points à creuser">
              <ul className="space-y-1.5">
                {r.toWatch.map((d) => (
                  <li key={d.id} className="rounded-lg border bg-background px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/sites/${dossier.site_id}/subjects/${d.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">{d.name}</Link>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CLS[d.state] ?? 'bg-muted text-muted-foreground'}`}>
                        {STATE_FR[d.state] ?? d.state}
                      </span>
                    </div>
                    {(d.cause || d.openQuestion) && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{d.openQuestion ?? d.cause}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {r.promises.length > 0 && (
            <Block icon={<Handshake className="h-4 w-4 text-violet-600" />} title="Engagements entendus">
              <ItemList items={r.promises} siteId={dossier.site_id} />
            </Block>
          )}

          {r.risks.length > 0 && (
            <Block icon={<ShieldAlert className="h-4 w-4 text-rose-600" />} title="Risques de chiffrage">
              <ItemList items={r.risks} siteId={dossier.site_id} />
            </Block>
          )}

          {r.pitfalls.length > 0 && (
            <Block icon={<Info className="h-4 w-4 text-amber-600" />} title="Pièges & contraintes du lieu">
              <ItemList items={r.pitfalls} siteId={dossier.site_id} />
            </Block>
          )}

          {r.missingDocuments.length > 0 && (
            <Block icon={<FileX2 className="h-4 w-4 text-muted-foreground" />} title="Documents manquants / attendus">
              <ItemList items={r.missingDocuments} siteId={dossier.site_id} />
            </Block>
          )}

          <p className="rounded-lg border border-dashed bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
            Prochaines étapes (à venir) : « voilà ce que j&apos;ai compris » (validation), puis génération
            d&apos;un premier mémoire technique via l&apos;Atelier IA.
          </p>
        </>
      )}
    </div>
  )
}

function AffaireRecit({ steps }: { steps: Array<{ label: string; done: boolean; lost?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5">
      {steps.map((s) => (
        <span
          key={s.label}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            s.lost ? 'bg-rose-100 text-rose-700' : s.done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
          }`}
        >
          {s.lost ? <XCircle className="h-3 w-3" /> : s.done ? <Check className="h-3 w-3" /> : <span className="h-2 w-2 rounded-full border border-current opacity-50" aria-hidden />}
          {s.label}
        </span>
      ))}
    </div>
  )
}

function PhaseBtn({ dossierId, phase, label, icon, tone }: {
  dossierId: string; phase: string; label: string; icon: React.ReactNode
  tone: 'success' | 'primary' | 'ghost'
}) {
  const cls = {
    success: 'bg-emerald-600 text-white hover:bg-emerald-700',
    primary: 'bg-foreground text-background hover:opacity-90',
    ghost: 'border bg-card text-muted-foreground hover:bg-muted',
  }[tone]
  return (
    <form action={setDossierPhaseAction}>
      <input type="hidden" name="dossierId" value={dossierId} />
      <input type="hidden" name="phase" value={phase} />
      <button type="submit" className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${cls}`}>
        {icon} {label}
      </button>
    </form>
  )
}

function PhaseBar({ dossierId, siteId, phase }: { dossierId: string; siteId: string; phase: string }) {
  if (phase === 'actif') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
        <Trophy className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="font-medium text-emerald-800">Marché gagné — c&apos;est un chantier.</span>
        <Link href={`/sites/${siteId}`} className="ml-auto inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline">
          <Building2 className="h-4 w-4" /> Voir le chantier
        </Link>
      </div>
    )
  }
  if (phase === 'perdu') {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <XCircle className="h-4 w-4 shrink-0" /> Marché perdu — la mémoire reste conservée.
        <span className="ml-auto">
          <PhaseBtn dossierId={dossierId} phase="en_ao" label="Rouvrir" icon={<RotateCcw className="h-3.5 w-3.5" />} tone="ghost" />
        </span>
      </div>
    )
  }
  // prospect | en_ao : on avance dans le cycle.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {phase === 'prospect' && (
        <PhaseBtn dossierId={dossierId} phase="en_ao" label="Je réponds à l'AO" icon={<Send className="h-4 w-4" />} tone="primary" />
      )}
      <PhaseBtn dossierId={dossierId} phase="actif" label="Marché gagné" icon={<Trophy className="h-4 w-4" />} tone="success" />
      <PhaseBtn dossierId={dossierId} phase="perdu" label="Marché perdu" icon={<XCircle className="h-4 w-4" />} tone="ghost" />
    </div>
  )
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 space-y-2">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </h2>
      {children}
    </section>
  )
}

function Stat({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
      {icon}
      {n} {label}{n > 1 ? 's' : ''}
    </span>
  )
}

function ItemList({ items, siteId }: { items: TakeoverItem[]; siteId: string }) {
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.id} className="flex items-start gap-1.5 text-sm">
          <span className="mt-1 shrink-0 text-muted-foreground/50">•</span>
          <span className="min-w-0">
            {it.text}
            {it.subjectId && (
              <Link href={`/sites/${siteId}/subjects/${it.subjectId}`} className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-violet-700 hover:underline">
                dossier
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
