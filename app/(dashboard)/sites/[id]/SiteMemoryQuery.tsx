'use client'

// 🔍 Interroger ce site — UI Phase 1.5 (retrieval-only, zéro LLM).
// Question → dossier de traces (sémantique + plein-texte). + deux modes
// dédiés : « Qui connaît ce site ? » (équipes) et « Dernières photos ».
// MemorIA retrouve, il ne répond jamais à la place des preuves.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Search, Loader2, AlertTriangle, StickyNote, Camera, Wrench, Users, Sparkles } from 'lucide-react'
import {
  askSiteMemoryAction,
  getSiteTeamsAction,
  getSiteRecentPhotosAction,
  type SiteMemoryHit,
  type SiteTeamHit,
  type SitePhotoHit,
} from './memory-query-actions'

const EXAMPLES = ['réservation', 'étanchéité', 'accès', 'reprise', 'béton']

const TYPE_META: Record<SiteMemoryHit['type'], { label: string; Icon: typeof StickyNote; cls: string }> = {
  anomaly:      { label: 'Anomalie',     Icon: AlertTriangle, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  site_note:    { label: 'Note',         Icon: StickyNote,    cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  intervention: { label: 'Intervention', Icon: Wrench,        cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  photo:        { label: 'Photo',        Icon: Camera,        cls: 'bg-violet-50 text-violet-700 border-violet-200' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}

type Mode = 'search' | 'teams' | 'photos'

export function SiteMemoryQuery({ siteId, variant = 'desktop' }: { siteId: string; variant?: 'desktop' | 'mobile' }) {
  const [mode, setMode] = useState<Mode>('search')
  const [q, setQ] = useState('')
  const [searched, setSearched] = useState('')
  const [hits, setHits] = useState<SiteMemoryHit[] | null>(null)
  const [teams, setTeams] = useState<SiteTeamHit[] | null>(null)
  const [photos, setPhotos] = useState<SitePhotoHit[] | null>(null)
  const [pending, startTransition] = useTransition()

  const siteHref = `${variant === 'mobile' ? '/m/site' : '/sites'}/${siteId}`

  function runSearch(query: string) {
    const text = query.trim()
    if (text.length < 2) return
    setMode('search'); setSearched(text)
    startTransition(async () => {
      const r = await askSiteMemoryAction(siteId, text)
      setHits(r.ok ? r.hits : [])
    })
  }
  function loadTeams() {
    setMode('teams')
    startTransition(async () => {
      const r = await getSiteTeamsAction(siteId)
      setTeams(r.ok ? r.teams : [])
    })
  }
  function loadPhotos() {
    setMode('photos')
    startTransition(async () => {
      const r = await getSiteRecentPhotosAction(siteId)
      setPhotos(r.ok ? r.photos : [])
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" /> Interroger ce site
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          MemorIA retrouve dans la mémoire du site (anomalies, notes, interventions, photos).
          Il vous montre les traces&nbsp;: il ne répond pas à votre place.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); runSearch(q) }} className="flex items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder="Que cherchez-vous sur ce site ?"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending && mode === 'search' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Chercher
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => { setQ(ex); runSearch(ex) }} disabled={pending}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50">
            {ex}
          </button>
        ))}
        <button type="button" onClick={loadTeams} disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50">
          <Users className="h-3 w-3" /> Qui connaît ce site&nbsp;?
        </button>
        <button type="button" onClick={loadPhotos} disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50">
          <Camera className="h-3 w-3" /> Dernières photos
        </button>
      </div>

      {/* ── Résultats ───────────────────────────────────────────────────── */}
      {pending && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recherche…
        </p>
      )}

      {!pending && mode === 'search' && hits !== null && (
        hits.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">
            Aucune trace ne correspond à «&nbsp;{searched}&nbsp;» sur ce site.
          </p>
        ) : (
          <div>
            <p className="text-[11px] text-muted-foreground mb-2">{hits.length} trace{hits.length > 1 ? 's' : ''} pour «&nbsp;{searched}&nbsp;»</p>
            <ul className="space-y-1.5">
              {hits.map((h) => {
                const meta = TYPE_META[h.type]
                const Icon = meta.Icon
                return (
                  <li key={`${h.type}-${h.id}`}>
                    <Link href={siteHref} className="block rounded-lg border bg-background p-2.5 hover:border-foreground/30 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                          <Icon className="h-2.5 w-2.5" /> {meta.label}
                        </span>
                        {h.occurredAt && <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(h.occurredAt)}</span>}
                        {h.similarity !== null && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700"><Sparkles className="h-2.5 w-2.5" />proche</span>
                        )}
                        {h.title && <span className="text-xs font-medium truncate">{h.title}</span>}
                      </div>
                      {h.snippet && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{h.snippet}</p>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      )}

      {!pending && mode === 'teams' && teams !== null && (
        teams.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">Aucune équipe documentée sur ce site.</p>
        ) : (
          <div>
            <p className="text-[11px] text-muted-foreground mb-2">Équipes déjà intervenues sur ce site</p>
            <ul className="space-y-1.5">
              {teams.map((t) => (
                <li key={t.teamName} className="rounded-lg border bg-background p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.teamColor ?? '#94a3b8' }} />
                    <span className="text-sm font-medium">{t.teamName}</span>
                    {!t.isActive && <span className="text-[10px] text-muted-foreground">(archivée)</span>}
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{t.interventions} interv.</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {t.lastPassage && <>Dernier passage&nbsp;: {fmtDate(t.lastPassage)}. </>}
                    {t.missions.length > 0 && <>Missions&nbsp;: {t.missions.slice(0, 3).join(', ')}{t.missions.length > 3 ? '…' : ''}</>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground/70 italic">
              Mémoire collective du lieu — descriptif, sans classement de performance.
            </p>
          </div>
        )
      )}

      {!pending && mode === 'photos' && photos !== null && (
        photos.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">Aucune photo sur ce site.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block group">
                <div className="aspect-square rounded-lg overflow-hidden border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption ?? ''} className="h-full w-full object-cover group-hover:opacity-90 transition-opacity" />
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{fmtDate(p.takenAt)}{p.takenByName ? ` · ${p.takenByName}` : ''}</div>
              </a>
            ))}
          </div>
        )
      )}
    </div>
  )
}
