import Link from 'next/link'
import { ListChecks, AlertTriangle, Footprints, Brain } from 'lucide-react'
import type { SiteStatusCell, SiteStatusMetric } from '@/lib/db/visits'

// P3-mobile Phase 1 — 4 mini-KPI sur UNE ligne (remplace les 4 grosses cartes
// SiteStatusCard sur le mode dossier mobile). MÊME vérité (SiteStatusCell[] issu
// de buildSiteStatusSummary) et MÊMES routes : présentation compacte seule, aucun
// recalcul métier. Une seule représentation (pas de version repliée en parallèle).

const ICON: Record<SiteStatusMetric, typeof ListChecks> = {
  actions: ListChecks,
  reserves: AlertTriangle,
  lastVisit: Footprints,
  canonicalSubjects: Brain,
}
// Libellés COURTS propres au format mini-tuile. Recette 390 px : les libellés longs
// de `buildSiteStatusSummary` (« Actions détectées », « Dernière visite »…) étaient
// coupés à l'ellipse, et les passer sur 2 lignes recréait la hauteur qu'on vient de
// gagner. On raccourcit donc l'ÉTIQUETTE, jamais la valeur — la vérité reste celle
// du read-model, partagée telle quelle avec SiteStatusCard sur les autres écrans.
const SHORT_LABEL: Record<SiteStatusMetric, string> = {
  actions: 'Actions',
  reserves: 'Réserves',
  lastVisit: 'Visite',
  canonicalSubjects: 'Sujets',
}
// Couleurs de marque, portées par l'icône. Le chiffre reste sombre pour la lisibilité.
const METRIC_COLOR: Record<SiteStatusMetric, string> = {
  actions: 'text-orange-600 dark:text-orange-400',
  reserves: 'text-amber-600 dark:text-amber-400',
  lastVisit: 'text-teal-600 dark:text-teal-400',
  canonicalSubjects: 'text-violet-600 dark:text-violet-400',
}

export function SiteKpiTiles({ cells }: { cells: SiteStatusCell[] }) {
  if (cells.length === 0) return null
  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((c) => {
        const Icon = ICON[c.key]
        // Seul le compteur d'actions vire au rouge, et seulement s'il est en alerte
        // (retards). Les autres gardent leur couleur de marque.
        const color = c.key === 'actions' && c.tone === 'alert' ? 'text-red-600 dark:text-red-400' : METRIC_COLOR[c.key]
        // Absence de visite terrain : repère neutre « — » plutôt que le mot « Aucune »,
        // trop large à côté de trois chiffres. Détection DÉTERMINISTE via l'absence de
        // lien (buildSiteStatusSummary ne pose `href` sur lastVisit que s'il existe une
        // visite terminée) — jamais par comparaison de chaîne sur le libellé.
        const value = c.key === 'lastVisit' && !c.href ? '—' : c.value
        const inner = (
          <>
            <Icon className={`h-4 w-4 ${color}`} aria-hidden />
            <span className="mt-1 text-lg font-bold leading-none tabular-nums">{value}</span>
            <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{SHORT_LABEL[c.key]}</span>
          </>
        )
        const cls = 'flex flex-col items-center rounded-xl border bg-card p-2 text-center shadow-sm'
        return c.href ? (
          <Link key={c.key} href={c.href} className={`${cls} active:brightness-95`}>{inner}</Link>
        ) : (
          <div key={c.key} className={cls}>{inner}</div>
        )
      })}
    </div>
  )
}
