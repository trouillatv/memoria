'use client'

// 🔍 Interroger toute l'entreprise — UI P7 (cross-site, retrieval + synthèse).
// Question → dossier de traces de TOUS les chantiers (sémantique + plein-texte),
// chaque résultat attribué à SON SITE. MemorIA retrouve, il ne répond jamais à
// la place des preuves.

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { Search, Loader2, AlertTriangle, StickyNote, Camera, Wrench, MapPin, Sparkles, Flame, Activity, Archive, ShieldCheck, BookOpen, ListTodo, Flag, Hammer, Info, Check } from 'lucide-react'
import {
  askOrgMemoryAction,
  getOrgMemoryTermsAction,
  synthesizeOrgMemoryAction,
  type OrgMemoryHit,
  type OrgMemorySummary,
  type MemorySynthesis,
} from './org-memory-actions'

// Chips curés (fallback quand la donnée est encore maigre au pilote) : les
// thèmes cross-chantiers que la mémoire d'ENTREPRISE sait capitaliser — pas des
// mots au hasard, mais les récurrences à valeur d'expérience partagée en BTP.
const ORG_EXAMPLE_CHIPS = ['infiltrations', 'fournisseurs', 'SOCOTEC', 'ferraillage', 'réserves', 'livraisons']

const CONFIDENCE_META: Record<OrgMemorySummary['confidence'], { label: string; cls: string }> = {
  forte:   { label: 'Confiance forte',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  moyenne: { label: 'Confiance moyenne', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  faible:  { label: 'Confiance faible',  cls: 'bg-slate-50 text-slate-600 border-slate-200' },
}


const TYPE_META: Record<OrgMemoryHit['type'], { label: string; Icon: typeof StickyNote; cls: string }> = {
  anomaly:      { label: 'Anomalie',     Icon: AlertTriangle, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  site_note:    { label: 'Note',         Icon: StickyNote,    cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  // Convention app (règle 2026-07-12) : intervention = Wrench/ambre partout.
  intervention: { label: 'Intervention', Icon: Wrench,        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  photo:        { label: 'Photo',        Icon: Camera,        cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  document:     { label: 'Document',     Icon: BookOpen,      cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  action:       { label: 'Action',       Icon: ListTodo,      cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  reserve:      { label: 'Réserve',      Icon: Flag,          cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  mission:      { label: 'Mission',      Icon: Hammer,        cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  // S4a-1 — corpus étendu (mémoire récente MemorIA, désormais cherchable).
  site_action:      { label: 'Action',       Icon: ListTodo, cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  meeting_decision: { label: 'Décision',     Icon: Check,    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  site_reserve:     { label: 'Réserve',      Icon: Flag,     cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  report_document:  { label: 'Compte-rendu', Icon: Archive,  cls: 'bg-slate-50 text-slate-700 border-slate-200' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}

export function OrgMemoryQuery() {
  const [q, setQ] = useState('')
  const [searched, setSearched] = useState('')
  const [hits, setHits] = useState<OrgMemoryHit[] | null>(null)
  const [summary, setSummary] = useState<OrgMemorySummary | null>(null)
  const [synthesis, setSynthesis] = useState<MemorySynthesis | null>(null)
  const [synthMock, setSynthMock] = useState(false)
  // Double-clic avant l'IA : 1er clic arme + prévient du coût, 2e exécute.
  const [confirmSynth, setConfirmSynth] = useState(false)
  const [synthPending, startSynth] = useTransition()
  const [pending, startTransition] = useTransition()
  const [terms, setTerms] = useState<{ term: string; count: number }[] | null>(null)

  // Pistes ANCRÉES : les mots qui reviennent vraiment dans la mémoire de TOUTE
  // l'entreprise (au lieu d'exemples génériques codés en dur).
  useEffect(() => {
    let alive = true
    getOrgMemoryTermsAction()
      .then((r) => { if (alive && r.ok) setTerms(r.terms) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  function synthesize() {
    if (!hits || hits.length === 0) return
    setConfirmSynth(false) // masque aussitôt « Confirmer / Annuler » + la note coût
    startSynth(async () => {
      const r = await synthesizeOrgMemoryAction(searched, hits)
      setSynthesis(r.ok ? r.synthesis : { retiens: [], hypothesis: null, themes: [] })
      setSynthMock(r.ok ? r.mock : false)
    })
  }

  function runSearch(query: string) {
    const text = query.trim()
    if (text.length < 2) return
    setSearched(text); setSynthesis(null)
    startTransition(async () => {
      const r = await askOrgMemoryAction(text)
      setHits(r.ok ? r.hits : [])
      setSummary(r.ok ? r.summary : null)
    })
  }

  // Ligne de résultat réutilisée par les deux sections (exactes / proches).
  const renderHit = (h: OrgMemoryHit) => {
    const meta = TYPE_META[h.type]
    const Icon = meta.Icon
    const inner = (
      <>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
            <Icon className="h-2.5 w-2.5" /> {meta.label}
          </span>
          {h.sourceLabel ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-700">
              <BookOpen className="h-2.5 w-2.5" /> {h.sourceLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-foreground/80">
              <MapPin className="h-2.5 w-2.5" /> {h.siteName}
            </span>
          )}
          {h.occurredAt && <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(h.occurredAt)}</span>}
          {h.title && <span className="text-xs font-medium truncate">{h.title}</span>}
        </div>
        {h.snippet && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{h.snippet}</p>}
      </>
    )
    return (
      <li key={`${h.type}-${h.id}`}>
        {h.siteId ? (
          <Link href={`/sites/${h.siteId}`} className="block rounded-lg border bg-background p-2.5 hover:border-foreground/30 hover:bg-muted/30 transition-colors">
            {inner}
          </Link>
        ) : (
          <div className="block rounded-lg border bg-background p-2.5">{inner}</div>
        )}
      </li>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" /> Interroger l&apos;entreprise
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          MemorIA retrouve dans la mémoire de tous les chantiers (anomalies, notes, interventions).
          Chaque trace est rattachée à son site&nbsp;: il ne répond pas à votre place.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); runSearch(q) }} className="flex items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder="Que cherchez-vous dans toute l'entreprise ?"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Chercher
        </button>
      </form>

      {/* Chips d'entrée. RIEN pendant le chargement (terms === null) : pas de
          « flash » d'exemples codés. Puis : les vrais thèmes (données) s'il y en a,
          SINON un jeu curé — questions cross-chantiers que la mémoire d'entreprise
          sait capitaliser (infiltrations réglées ailleurs, fournisseurs qui
          reviennent, contrôles, qualité structure). */}
      {terms && terms.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Ce qui revient dans l&apos;entreprise
          </p>
          <div className="flex flex-wrap gap-1.5">
            {terms.map(({ term, count }) => (
              <button key={term} type="button" onClick={() => { setQ(term); runSearch(term) }} disabled={pending}
                title={`${count} trace${count > 1 ? 's' : ''}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50">
                {term}
                <span className="text-[9px] tabular-nums text-muted-foreground/50">{count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : terms && terms.length === 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {ORG_EXAMPLE_CHIPS.map((ex) => (
            <button key={ex} type="button" onClick={() => { setQ(ex); runSearch(ex) }} disabled={pending}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50">
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Résultats ───────────────────────────────────────────────────── */}
      {pending && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recherche…
        </p>
      )}

      {!pending && hits !== null && (
        hits.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">
            Aucune trace ne correspond à «&nbsp;{searched}&nbsp;» dans l&apos;entreprise.
          </p>
        ) : (
          <div>
            {summary && !summary.keywordGrounded && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900">
                Aucune trace ne contient exactement «&nbsp;{searched}&nbsp;». Voici des traces{' '}
                <span className="font-medium">sémantiquement proches</span> — à vérifier, ce ne sont pas forcément des réponses.
              </div>
            )}
            {/* Synthèse encadrée (LLM) : réponse en tête, sources dessous */}
            <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-sky-600" /> Synthèse
                  <span className="rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700">IA</span>
                </h3>
                {confirmSynth ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={synthesize}
                      disabled={synthPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-600 bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {synthPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmSynth(false)}
                      disabled={synthPending}
                      className="rounded-lg border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmSynth(true)}
                    disabled={synthPending}
                    className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
                  >
                    {synthPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    {synthesis === null ? 'Synthétiser' : 'Régénérer'}
                  </button>
                )}
              </div>
              {confirmSynth && !synthPending && (
                <p className="inline-flex items-start gap-1 text-[11px] text-amber-700">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Cette synthèse lance une requête IA — elle consomme un peu de crédit (coût très faible). Confirmer&nbsp;?
                </p>
              )}
              {synthesis && synthesis.retiens.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ce qu&apos;il faut retenir</p>
                  <ul className="space-y-1">
                    {synthesis.retiens.map((t, i) => (
                      <li key={i} className="flex gap-1.5 text-sm text-sky-950">
                        <span aria-hidden className="text-sky-500">•</span>
                        <span className="min-w-0">{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {synthesis?.hypothesis && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Hypothèse · à confirmer</p>
                  <p className="mt-0.5 text-sm italic text-amber-900">{synthesis.hypothesis}</p>
                </div>
              )}
              {synthesis && synthesis.themes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Thèmes observés</p>
                  <ul className="space-y-0.5">
                    {synthesis.themes.map((t, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm text-sky-950">
                        <span className="min-w-0">{t.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t.count} trace{t.count > 1 ? 's' : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {synthesis && synthesis.retiens.length === 0 && synthesis.themes.length === 0 && !synthPending && (
                synthMock ? (
                  <p className="text-xs italic text-amber-700">
                    IA en mode démo sur cet environnement (aucune clé configurée) — la synthèse n&apos;est pas générée.
                  </p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">Pas de synthèse nette à dégager.</p>
                )
              )}
              {synthesis !== null && (
                <p className="text-[10px] text-muted-foreground/70">
                  Synthèse à partir des traces ci-dessous — vérifiez les sources. Une hypothèse est une lecture plausible, pas une vérité.
                </p>
              )}
            </div>

            {/* Confiance + Importance — signal déterministe, zéro LLM */}
            {summary && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium ${CONFIDENCE_META[summary.confidence].cls}`}>
                  <ShieldCheck className="h-2.5 w-2.5" /> {CONFIDENCE_META[summary.confidence].label}
                </span>
                <span className="text-muted-foreground">
                  {summary.count} trace{summary.count > 1 ? 's' : ''} · {summary.distinctDays} date{summary.distinctDays > 1 ? 's' : ''}
                </span>
                {summary.recurring && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700">
                    <Flame className="h-2.5 w-2.5" /> Sujet récurrent
                  </span>
                )}
                {summary.keywordGrounded && !summary.recurring && summary.last30dCount >= 3 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                    <Activity className="h-2.5 w-2.5" /> Sujet actif · {summary.last30dCount} sur 30 j
                  </span>
                )}
                {summary.keywordGrounded && summary.spanDays !== null && summary.spanDays > 365 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-600">
                    <Archive className="h-2.5 w-2.5" /> Historique · sur {Math.round(summary.spanDays / 365)} an{summary.spanDays > 730 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
            {/* Séparation honnête : correspondances EXACTES (le mot est là) vs
                CONCEPTS PROCHES (sémantique seulement = sujets voisins). */}
            {hits.some((h) => h.keyword) && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold inline-flex items-center gap-1 text-emerald-700">
                  <Check className="h-3 w-3" /> Correspondances exactes
                </p>
                <ul className="space-y-1.5">{hits.filter((h) => h.keyword).map(renderHit)}</ul>
              </div>
            )}
            {hits.some((h) => !h.keyword) && (
              <div className={`space-y-1.5 ${hits.some((h) => h.keyword) ? 'mt-3' : ''}`}>
                <p className="text-[11px] font-semibold inline-flex items-center gap-1 text-muted-foreground">
                  <span aria-hidden className="text-sm leading-none">≈</span> Concepts proches
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  Ne parlent pas de «&nbsp;{searched}&nbsp;» mais de sujets voisins — à vérifier.
                </p>
                <ul className="space-y-1.5">{hits.filter((h) => !h.keyword).map(renderHit)}</ul>
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
