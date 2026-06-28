import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Handshake, ShieldAlert, Info, FileX2, Layers } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { readForTakeover, type TakeoverItem } from '@/lib/db/dossier-readings'

export const dynamic = 'force-dynamic'

// « Dossier de reprise » — LECTURE métier déterministe du chantier (readForTakeover).
// « Si un nouveau chargé d'affaires reprend ce chantier demain, voilà ce qu'il doit
// savoir. » Zéro IA : pure restitution de la mémoire déjà captée, racontée pour la
// reprise. Cf. [[continuite-operationnelle-2026-05-22]].

const STATE_FR: Record<string, string> = { bloqué: 'Bloqué', en_attente: 'En attente', dormant: 'En sommeil', ouvert: 'Ouvert', clos: 'Clos' }
const STATE_CLS: Record<string, string> = {
  bloqué: 'bg-rose-100 text-rose-700', en_attente: 'bg-amber-100 text-amber-800',
  dormant: 'bg-slate-100 text-slate-600', ouvert: 'bg-sky-100 text-sky-700', clos: 'bg-emerald-100 text-emerald-700',
}

export default async function ReprisePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const r = await readForTakeover(id)

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {r.siteName}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Dossier de reprise — {r.siteName}</h1>
        <p className="text-sm text-muted-foreground">
          Si un nouveau chargé d&apos;affaires reprend ce chantier demain, voilà ce qu&apos;il doit savoir. Restitution de la mémoire — aucune IA.
        </p>
      </header>

      {r.isEmpty ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Pas encore assez de mémoire captée pour reconstituer une reprise. Les visites, réunions et infos retenues nourriront ce dossier.
        </p>
      ) : (
        <>
          {/* Ce qui doit attirer l'attention — les dossiers bloqués / en attente. */}
          {r.mustKnow.length > 0 && (
            <Block icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} title="Ce qui doit attirer l'attention">
              <ul className="space-y-1.5">
                {r.mustKnow.map((d) => (
                  <li key={d.id} className="rounded-lg border bg-background px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/sites/${id}/subjects/${d.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">{d.name}</Link>
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
            <Block icon={<Handshake className="h-4 w-4 text-violet-600" />} title="Promesses entendues">
              <ItemList items={r.promises} siteId={id} />
            </Block>
          )}

          {r.risks.length > 0 && (
            <Block icon={<ShieldAlert className="h-4 w-4 text-rose-600" />} title="Risques">
              <ItemList items={r.risks} siteId={id} />
            </Block>
          )}

          {r.pitfalls.length > 0 && (
            <Block icon={<Info className="h-4 w-4 text-amber-600" />} title="Pièges & habitudes à connaître">
              <ItemList items={r.pitfalls} siteId={id} />
            </Block>
          )}

          {r.missingDocuments.length > 0 && (
            <Block icon={<FileX2 className="h-4 w-4 text-muted-foreground" />} title="Documents manquants">
              <ItemList items={r.missingDocuments} siteId={id} />
            </Block>
          )}
        </>
      )}
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
                <Layers className="h-3 w-3" /> dossier
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
