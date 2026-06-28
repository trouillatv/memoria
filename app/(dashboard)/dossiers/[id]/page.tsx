import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Eye, Handshake, ShieldAlert, Info, FileX2, Mic, StickyNote, Camera, Video, ClipboardCheck, AlertTriangle, Smartphone, Send, Trophy, XCircle, RotateCcw, Building2, Map as MapIcon } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getDossier } from '@/lib/db/dossiers'
import { readForTender, type TakeoverItem } from '@/lib/db/dossier-readings'
import { setDossierPhaseAction } from './actions'

export const dynamic = 'force-dynamic'

// « Dossier de réponse à l'appel d'offre » — LECTURE métier déterministe d'une
// PRÉVISITE (readForTender), scopée au DOSSIER (opération), pas au site. La mémoire
// de LIEU (à-savoir, pièges) est héritée du site et partagée entre opérations.
// Zéro IA : on restitue la matière captée, organisée pour chiffrer. La couche IA
// (« voilà ce que j'ai compris », puis mémoire technique) viendra par-dessus, gated.
// Prototype : accessible par URL, pas encore dans la navigation principale.

const PHASE_FR: Record<string, string> = { prospect: 'Prospect', en_ao: 'En appel d’offre', actif: 'Actif', perdu: 'Perdu', archive: 'Archivé' }
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

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/opportunites`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Opportunités
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{r.clientName ?? 'Donneur d’ordre à préciser'}{r.address ? ` · ${r.address}` : ''}</p>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
            {PHASE_FR[dossier.phase] ?? dossier.phase}
          </span>
        </div>
        <h1 className="text-2xl font-bold">Dossier de réponse à l&apos;appel d&apos;offre</h1>
        <p className="text-sm font-medium">{r.siteName}</p>
        <p className="text-sm text-muted-foreground">
          Ce que la prévisite a capté, organisé pour chiffrer. Restitution de la mémoire terrain — aucune IA.
        </p>
      </header>

      {/* Cycle de vie du dossier — la soudure arrière. « Marché gagné » fait du
          dossier un chantier SANS copie : la mémoire de prévisite suit. */}
      <PhaseBar dossierId={dossier.id} siteId={dossier.site_id} phase={dossier.phase} />

      {/* Continuer la collecte sur le terrain (mobile). La prévisite = une visite sur le LIEU. */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/m/site/${dossier.site_id}`}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <Smartphone className="h-4 w-4 text-sky-600" /> Continuer la prévisite sur le terrain
        </Link>
        <Link
          href={`/sites/${dossier.site_id}/carte`}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <MapIcon className="h-4 w-4 text-sky-600" /> Carte des captures
        </Link>
      </div>

      {r.isEmpty ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Rien n&apos;a encore été capté sur cette opportunité. Lancez une prévisite : photos, vocaux,
          notes, mesures et infos entendues nourriront ce dossier.
        </p>
      ) : (
        <>
          {/* Ce qu'on a observé sur site — la matière brute, à transformer en postes. */}
          <Block icon={<Eye className="h-4 w-4 text-sky-600" />} title="Ce qu'on a observé sur site">
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
