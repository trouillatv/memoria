// LE MATIN — le hero de l'Accueil quand la Nuit a un digest (Vincent 2026-07-09).
//
// Décisions validées (maquette v2) :
//   * Le Matin REMPLACE le hero « Mémoire active ce matin » UNIQUEMENT quand un
//     digest existe pour aujourd'hui — jamais deux heros empilés. Pas de digest
//     → le hero actuel (fallback, aucune régression).
//   * Voix narrative FACTUELLE : chaque mot est un fait vérifiable (nombre de
//     chantiers relus, heure du calcul, focus). Aucune rédaction libre.
//   * Provenance TOUJOURS visible, format compact : « Relu cette nuit à 05h17
//     · 12 chantiers · zéro IA ».
//   * Au plus 2 chantiers en focus (discipline d'apparition) — l'exception
//     « 3 si signal rouge critique » attend une notion de criticité qui
//     n'existe pas encore dans MemorySignal (wording calme, jamais de rouge).
//   * Le Matin est une TRANSITION, pas une page : CTA « Commencer ma journée »
//     → premier chantier en focus, sinon /aujourdhui.
//   * Silence vert COMPACT : digest vide = « rien n'a été oublié » (prouvé par
//     l'heure de calcul), différent de « pas calculé » (fallback).
import Link from 'next/link'
import { ShieldCheck, Sunrise } from 'lucide-react'
import {
  pickMorningFocus,
  isQuietMorning,
  type OrgMorningDigest,
  type MorningFocusItem,
} from '@/lib/db/morning-digest'

const NOUMEA = 'Pacific/Noumea'
const WORDS = ['Aucun', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix']
const nWord = (n: number) => WORDS[n] ?? String(n)

function heureNoumea(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: NOUMEA, hour: '2-digit', minute: '2-digit' })
      .format(new Date(iso))
      .replace(':', 'h')
  } catch {
    return null
  }
}

function provenanceLine(digest: OrgMorningDigest): string {
  const heure = heureNoumea(digest.computedAt)
  const n = digest.sites.length
  return [
    heure ? `Relu cette nuit à ${heure}` : 'Relu cette nuit',
    `${n} chantier${n > 1 ? 's' : ''}`,
    'zéro IA',
  ].join(' · ')
}

export function MorningHero({ digest }: { digest: OrgMorningDigest }) {
  const totalSites = digest.sites.length
  const chantiersRelus = totalSites === 1 ? 'ton chantier' : `tes ${totalSites} chantiers`

  if (isQuietMorning(digest)) {
    // Silence vert compact : la nuit a tourné, rien à signaler — c'est une
    // information prouvée, pas une absence de calcul.
    return (
      <section
        aria-label="Le Matin"
        className="rounded-xl border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/15 p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-base sm:text-lg leading-snug">
              Cette nuit, MemorIA a relu {chantiersRelus}. Rien n&apos;a été oublié.
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {provenanceLine(digest)} — rien ne réclame ton attention ce matin.
            </p>
            <Link
              href="/aujourdhui"
              className="inline-block mt-2 text-sm font-medium text-primary hover:underline"
            >
              Commencer ma journée →
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const focus = pickMorningFocus(digest, 2)
  const sitesWithSignals = digest.sites.filter((s) => s.signalCount > 0)
  const quietCount = totalSites - sitesWithSignals.length
  const othersWithSignals = sitesWithSignals.length - focus.length
  const k = sitesWithSignals.length
  const attention = k === 1 ? 'Un réclame ton attention.' : `${nWord(k)} réclament ton attention.`
  const ctaHref = focus.length > 0 ? `/sites/${focus[0].siteId}` : '/aujourdhui'

  const restParts: string[] = []
  if (othersWithSignals > 0) {
    restParts.push(
      `${othersWithSignals} autre${othersWithSignals > 1 ? 's' : ''} chantier${othersWithSignals > 1 ? 's ont' : ' a'} aussi signalé — visible${othersWithSignals > 1 ? 's' : ''} sur sa page`,
    )
  }
  if (quietCount > 0) {
    restParts.push(
      `${quietCount === totalSites - focus.length ? `Les ${quietCount} autres chantiers` : `${quietCount} chantiers`} n'ont rien signalé cette nuit`,
    )
  }

  return (
    <section
      aria-label="Le Matin"
      className="rounded-xl border border-foreground/10 bg-[#fafaf7] dark:bg-muted/20 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <Sunrise className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
        <div className="min-w-0 flex-1">
          <p className="text-base sm:text-lg leading-snug font-medium">
            Cette nuit, MemorIA a relu {chantiersRelus}. {attention}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">{provenanceLine(digest)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-0">
        {focus.map((f) => (
          <MorningFocusBlock key={f.siteId} focus={f} digest={digest} />
        ))}
      </div>

      {restParts.length > 0 && (
        <p className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground">
          {restParts.join(' · ')}.
        </p>
      )}

      <Link
        href={ctaHref}
        className="mt-4 flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Commencer ma journée →
      </Link>
    </section>
  )
}

function MorningFocusBlock({ focus, digest }: { focus: MorningFocusItem; digest: OrgMorningDigest }) {
  const site = digest.sites.find((s) => s.siteId === focus.siteId)
  const otherSignals = (site?.signals ?? []).filter((s) => s !== focus.signal)
  const items = focus.signal.items.slice(0, 2)
  const moreItems = focus.signal.items.length - items.length

  return (
    <div className="border-t border-border/60 py-3 first:border-t-0 first:pt-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link href={`/sites/${focus.siteId}`} className="font-semibold text-sm hover:underline">
          {focus.siteName ?? 'Chantier'}
        </Link>
        <span className="text-sm text-muted-foreground">— {focus.signal.title}</span>
        {otherSignals.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            + {otherSignals[0].title}
            {otherSignals.length > 1 ? ` · ${otherSignals.length - 1} autre${otherSignals.length > 2 ? 's' : ''}` : ''}
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => (
          <li key={it.id} className="text-sm leading-snug">
            <span className="font-medium">{it.label}</span>
            {it.context && it.context.length > 0 && (
              <span className="block text-xs text-muted-foreground tabular-nums">
                {it.context.slice(0, 2).join(' · ')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {moreItems > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          + {moreItems} autre{moreItems > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
