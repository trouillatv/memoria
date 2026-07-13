'use client'

// Écran d'import (mig 184). Trois temps : (1) choisir le chantier + la source,
// (2) déposer l'export WhatsApp ou les fichiers → MemorIA RECONSTRUIT et montre
// ce qu'il a compris, (3) entrer dans le tri EXISTANT. L'écran de reconstruction
// est une CONFIRMATION : le découpage en visites est proposé, jamais imposé.
// Cf. docs/ingestion-engine.md.
//
// Lot M (2026-07-13) : l'utilisateur ne sait pas où Android range ses fichiers
// — on ne le lui demande plus. Un bouton PAR TYPE de preuve, chacun avec son
// `accept` PUR : `image/*` seul ouvre le sélecteur de photos, `audio/*` seul le
// sélecteur d'audios (où les vocaux WhatsApp apparaissent). Un accept mixte
// retombe sur le gestionnaire de fichiers — c'est le bug vécu sur le terrain.

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessageSquare, ChevronRight, Loader2, Check, Image as ImageIcon,
  Video, Mic, FileText, ArrowRight, Camera,
} from 'lucide-react'
import { toast } from 'sonner'
import { importVisitAction, type ImportResult } from './import-actions'

type Site = { id: string; name: string }
type Source = 'whatsapp_zip' | 'upload'

const PROOF_KINDS = [
  { accept: 'image/*', icon: Camera, label: 'Photos', hint: 'galerie, WhatsApp' },
  { accept: 'video/*', icon: Video, label: 'Vidéos', hint: 'galerie, WhatsApp' },
  { accept: 'audio/*', icon: Mic, label: 'Vocaux', hint: 'WhatsApp, dictaphone' },
  { accept: 'application/pdf', icon: FileText, label: 'Documents', hint: 'PDF' },
] as const

export function ImportVisit({ sites, initialSiteId, initialSource }: { sites: Site[]; initialSiteId?: string; initialSource?: Source }) {
  const router = useRouter()
  const [siteId, setSiteId] = useState<string>(initialSiteId ?? sites[0]?.id ?? '')
  const [pending, start] = useTransition()
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // La source du prochain dépôt — fixée au moment du clic, pas un état d'écran.
  const sourceRef = useRef<Source>('upload')

  // `accept`/`multiple` sont posés sur l'input AU CLIC (pas via un état React :
  // le .click() doit partir dans le même geste utilisateur).
  function openPicker(accept: string, source: Source) {
    const input = fileRef.current
    if (!input) return
    if (!siteId) { toast.error('Choisissez un chantier'); return }
    sourceRef.current = source
    input.accept = accept
    input.multiple = source === 'upload'
    input.click()
  }

  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    if (!siteId) { toast.error('Choisissez un chantier'); return }
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('source', sourceRef.current)
    for (const f of Array.from(files)) fd.append('files', f)
    start(async () => {
      const r = await importVisitAction(fd)
      if (r.ok) setResult(r)
      else toast.error(r.error)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  // ── Écran de reconstruction (confirmation) ────────────────────────────────
  if (result) {
    const d = result.detected
    const many = result.sessions.length > 1
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/15">
          <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            <Check className="h-4 w-4" /> Lot reconstruit
          </div>
          <ul className="space-y-1 text-sm text-emerald-900/90 dark:text-emerald-100/80">
            <li><strong>{d.total}</strong> capture{d.total > 1 ? 's' : ''} détectée{d.total > 1 ? 's' : ''}</li>
            {d.photos > 0 && <li className="inline-flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> {d.photos} photo{d.photos > 1 ? 's' : ''}</li>}
            {d.videos > 0 && <li className="inline-flex items-center gap-1.5"><Video className="h-3.5 w-3.5" /> {d.videos} vidéo{d.videos > 1 ? 's' : ''}</li>}
            {d.vocals > 0 && <li className="inline-flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" /> {d.vocals} vocal{d.vocals > 1 ? 'aux' : ''} — transcription en cours</li>}
            {d.pdf > 0 && <li className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {d.pdf} document{d.pdf > 1 ? 's' : ''}</li>}
            <li className="pt-1 text-emerald-800/80 dark:text-emerald-200/70">
              Ordre chronologique reconstruit · <strong>{result.sessions.length}</strong> visite{many ? 's' : ''}
              {many ? ' (par journée)' : ''}
            </li>
            {result.skippedDuplicates > 0 && (
              <li className="text-emerald-800/70 dark:text-emerald-200/60">{result.skippedDuplicates} déjà importé{result.skippedDuplicates > 1 ? 's' : ''} — ignoré{result.skippedDuplicates > 1 ? 's' : ''}</li>
            )}
          </ul>
        </div>

        {many && (
          <p className="text-[12px] text-muted-foreground">
            MemorIA a séparé les captures en {result.sessions.length} visites selon les écarts de temps.
            Ouvrez-les pour trier — vous corrigez, MemorIA ne décide pas à votre place.
          </p>
        )}

        <div className="space-y-2">
          {result.sessions.map((s, i) => (
            <button
              key={s.reportId}
              type="button"
              onClick={() => router.push(`/m/visite/${s.reportId}`)}
              className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-3 text-left text-sm font-medium hover:bg-accent active:scale-[0.99] transition-transform"
            >
              <span className="min-w-0 flex-1">
                {many ? `Visite ${i + 1} — ` : 'Trier la visite — '}
                <span className="text-muted-foreground">{s.captureCount} capture{s.captureCount > 1 ? 's' : ''}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setResult(null)}
          className="text-[13px] text-muted-foreground underline"
        >
          Importer un autre lot
        </button>
      </div>
    )
  }

  // ── Écran de dépôt ────────────────────────────────────────────────────────
  const disabled = pending || !siteId

  const proofButtons = (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Ajouter des preuves</label>
      <div className="grid grid-cols-2 gap-2">
        {PROOF_KINDS.map(({ accept, icon: Icon, label, hint }) => (
          <button
            key={accept}
            type="button"
            onClick={() => openPicker(accept, 'upload')}
            disabled={disabled}
            className="flex flex-col items-start gap-1 rounded-xl border bg-background px-3 py-3 text-left transition-colors hover:bg-accent active:scale-[0.99] disabled:opacity-50"
          >
            <Icon className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            <span className="text-sm font-medium">{label}</span>
            <span className="text-[11px] text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Le téléphone ouvre directement le bon sélecteur — pas besoin de savoir dans quel dossier c&apos;est rangé.
      </p>
    </div>
  )

  const whatsappBlock = (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => openPicker('.zip,application/zip', 'whatsapp_zip')}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white active:scale-[0.99] transition-transform disabled:opacity-50"
      >
        <MessageSquare className="h-4 w-4" /> Importer une discussion WhatsApp (.zip)
        <ChevronRight className="h-4 w-4" />
      </button>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Dans WhatsApp : ouvrez la discussion → <em>Exporter la discussion</em> → <em>Inclure les médias</em>.
        MemorIA lit les dates de l&apos;export pour remettre tout dans l&apos;ordre.
      </p>
    </div>
  )

  const zipFirst = initialSource === 'whatsapp_zip'

  return (
    <div className="space-y-5">
      {/* 1. Chantier */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Chantier</label>
        {sites.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Aucun chantier accessible.</p>
        ) : (
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            disabled={pending}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {/* 2. Preuves typées + export WhatsApp — l'entrée choisie passe en premier. */}
      {zipFirst ? whatsappBlock : proofButtons}
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
      </div>
      {zipFirst ? proofButtons : whatsappBlock}

      {pending && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reconstruction…
        </p>
      )}

      {/* Un seul input caché : `accept`/`multiple` sont posés au clic. */}
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => onPick(e.target.files)} />
    </div>
  )
}
