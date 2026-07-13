// « Montre-moi tout ce qu'on sait sur Discount Poindimié. »
// « On avait déjà vu cette fuite il y a deux ans ? »
// « Quelles observations concernent les chambres froides ? »
//
// Cette page cherchait dans les INTERVENTIONS, avec quatre `ILIKE`. Elle ne
// voyait ni les observations de terrain, ni les décisions, ni les réserves, ni
// les sujets. Elle branche maintenant le vrai moteur (`search_memory`, mig 200)
// et rend une RÉPONSE, pas une liste :
//
//   • les FILS d'abord — un sujet qui porte le mot cherché contient déjà toute
//     l'histoire ; c'est la meilleure réponse possible ;
//   • puis les faits, groupés par CHANTIER, datés, typés, sourcés.
//
// Déterministe, zéro LLM : ce moteur CLASSE des faits, il n'en rédige aucun.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Search, MapPin, GitBranch, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { searchMemory, memoryHitHref, type MemoryHit } from '@/lib/db/memory-search'
import {
  groupSearchHits,
  applyFilters,
  HIT_LABEL_FR,
  ALL_MEMORY_DAYS,
} from '@/lib/memory/search-grouping'
import { SearchBar } from './SearchBar'
import { SearchFilters } from './SearchFilters'

export const dynamic = 'force-dynamic'

const FR_MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

/** « 14 juil. 2026 » — « il y a deux ans » se lit alors d'un coup d'œil. */
function frDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function trunc(s: string, n = 180): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > n ? `${clean.slice(0, n - 1).trimEnd()}…` : clean
}

/** Les noms de chantiers — la RPC ne rend que des identifiants. */
async function siteNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await createAdminClient().from('sites').select('id, name').in('id', ids)
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
}

function HitRow({ hit }: { hit: MemoryHit }) {
  return (
    <Link
      href={memoryHitHref(hit)}
      className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40"
    >
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-dashed px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {HIT_LABEL_FR[hit.type]}
          </span>
          <span className="text-xs text-muted-foreground">{frDate(hit.occurredAt)}</span>
          {/* Rattaché à un fil : le clic ouvre l'HISTOIRE, pas le fait isolé. */}
          {hit.subjectId && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-brand-700">
              <GitBranch className="h-3 w-3" /> suivi
            </span>
          )}
        </span>
        <span className="block text-sm leading-snug">{trunc(hit.snippet || hit.title)}</span>
      </span>
      <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

const EXAMPLES = ['fuite', 'chambre froide', 'porte', 'sol', 'vitrine', 'climatisation']

export default async function RecherchePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; site?: string; type?: string; days?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const sp = await searchParams
  const query = sp.q?.trim() ?? ''

  // TOUTE la mémoire par défaut : « on avait déjà vu ça il y a deux ans ? » porte
  // précisément sur l'ancien. Une fenêtre d'un an répondrait « non » à tort —
  // le pire mensonge possible pour une mémoire.
  const days = Number(sp.days) > 0 ? Number(sp.days) : ALL_MEMORY_DAYS

  const hits =
    query.length >= 2 ? await searchMemory({ q: query, periodDays: days, limit: 120 }) : []

  const names = await siteNames([
    ...new Set(hits.map((h) => h.siteId).filter((v): v is string => !!v)),
  ])

  // Les filtres possibles se lisent sur TOUS les résultats — sinon filtrer par
  // « Observation » ferait disparaître le filtre lui-même.
  const allTypes = groupSearchHits(hits, (id) => names.get(id)).countsByType
  const allSites = [...names.entries()]
    .map(([id, name]) => ({
      id,
      name,
      count: hits.filter((h) => h.siteId === id).length,
    }))
    .sort((a, b) => b.count - a.count)

  const filters = {
    q: query,
    siteId: sp.site ?? null,
    type: (sp.type as MemoryHit['type'] | undefined) ?? null,
    days,
  }

  // Le filtre RÉDUIT ce qu'on a déjà : il ne relance pas de recherche.
  const shown = applyFilters(hits, filters)
  const grouped = groupSearchHits(shown, (id) => names.get(id))

  return (
    <div className="w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-semibold">
          <Search className="h-5 w-5 text-muted-foreground" />
          Recherche
        </h1>
        <p className="text-sm text-muted-foreground">
          Observations, réunions, décisions, actions, réserves, comptes-rendus — sur toute la
          mémoire, sans limite de date.
        </p>
      </header>

      <SearchBar defaultValue={query} />

      {hits.length > 0 && (
        <SearchFilters state={filters} types={allTypes} sites={allSites} />
      )}

      {query.length >= 2 && (
        <div className="space-y-5">
          {shown.length === 0 ? (
            <div className="space-y-1 py-10 text-center">
              {/* Ne JAMAIS dire « rien dans la mémoire » quand c'est un filtre
                  qui a tout masqué : ce serait un mensonge sur la mémoire. */}
              {hits.length > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Rien avec ces filtres — mais {hits.length} trace
                    {hits.length > 1 ? 's' : ''} sur «&nbsp;{query}&nbsp;».
                  </p>
                  <Link
                    href={`/recherche?q=${encodeURIComponent(query)}`}
                    className="inline-block text-xs text-brand-700 underline underline-offset-2"
                  >
                    Tout revoir
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Rien sur «&nbsp;{query}&nbsp;» dans toute la mémoire.
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    Ce n&apos;est pas « pas encore indexé » : c&apos;est qu&apos;on ne l&apos;a
                    jamais écrit.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {grouped.countsByType
                  .map(
                    (c) =>
                      `${c.count} ${HIT_LABEL_FR[c.type].toLowerCase()}${c.count > 1 ? 's' : ''}`,
                  )
                  .join(' · ')}
              </p>

              {/* LES FILS. Un sujet qui porte le mot cherché contient déjà
                  l'histoire complète : c'est la meilleure réponse possible. */}
              {grouped.threads.length > 0 && (
                <section className="space-y-1.5 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
                  <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-800">
                    <GitBranch className="h-3.5 w-3.5" />
                    {grouped.threads.length > 1 ? 'Sujets suivis' : 'Sujet suivi'}
                  </h2>
                  <ul>
                    {grouped.threads.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={memoryHitHref(t)}
                          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-brand-100/60"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{t.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {t.siteId ? (names.get(t.siteId) ?? 'Chantier') : ''} — toute
                              l&apos;histoire de ce sujet
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-brand-700" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* LES FAITS, groupés par chantier. */}
              {grouped.sites.map((g) => (
                <section key={g.siteId} className="space-y-1 rounded-2xl border bg-card p-4">
                  <h2 className="flex items-center justify-between gap-2">
                    <Link
                      href={`/sites/${g.siteId}`}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {g.siteName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {g.hits.length} trace{g.hits.length > 1 ? 's' : ''}
                    </span>
                  </h2>
                  <ul className="divide-y">
                    {g.hits.map((hit) => (
                      <li key={`${hit.type}:${hit.id}`}>
                        <HitRow hit={hit} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      )}

      {!query && (
        <div className="space-y-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">Exemples :</p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <Link
                key={ex}
                href={`/recherche?q=${encodeURIComponent(ex)}`}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                {ex}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
