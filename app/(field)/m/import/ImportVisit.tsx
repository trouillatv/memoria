'use client'

// Écran d'import (mig 184). Trois temps : (1) choisir le chantier + la source,
// (2) déposer l'export WhatsApp ou les fichiers → MemorIA RECONSTRUIT et montre
// ce qu'il a compris, (3) entrer dans le tri EXISTANT. L'écran de reconstruction
// est une CONFIRMATION : le découpage en visites est proposé, jamais imposé.
// Cf. docs/ingestion-engine.md.

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessageSquare, FolderUp, ChevronRight, Loader2, Check, Image as ImageIcon,
  Video, Mic, FileText, ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { importVisitAction, type ImportResult } from './import-actions'

type Site = { id: string; name: string }
type Source = 'whatsapp_zip' | 'upload'

export function ImportVisit({ sites }: { sites: Site[] }) {
  const router = useRouter()
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '')
  const [source, setSource] = useState<Source>('whatsapp_zip')
  const [pending, start] = useTransition()
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    if (!siteId) { toast.error('Choisissez un chantier'); return }
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('source', source)
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
  const accept = source === 'whatsapp_zip' ? '.zip,application/zip' : 'image/*,video/*,audio/*,application/pdf'

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

      {/* 2. Source */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">D&apos;où viennent les médias ?</label>
        <div className="grid grid-cols-2 gap-2">
          <SourceButton active={source === 'whatsapp_zip'} onClick={() => setSource('whatsapp_zip')} icon={<MessageSquare className="h-5 w-5" />} label="Export WhatsApp" hint=".zip de la discussion" />
          <SourceButton active={source === 'upload'} onClick={() => setSource('upload')} icon={<FolderUp className="h-5 w-5" />} label="Fichiers" hint="photos, vidéos, vocaux" />
        </div>
      </div>

      {/* 3. Dépôt */}
      <div>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple={source === 'upload'}
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pending || !siteId}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white active:scale-[0.99] transition-transform disabled:opacity-50"
        >
          {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Reconstruction…</> : <>{source === 'whatsapp_zip' ? 'Choisir le .zip WhatsApp' : 'Choisir les fichiers'}<ChevronRight className="h-4 w-4" /></>}
        </button>
      </div>

      {source === 'whatsapp_zip' && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Dans WhatsApp : ouvrez la discussion → <em>Exporter la discussion</em> → <em>Inclure les médias</em>.
          MemorIA lit les dates de l&apos;export pour remettre tout dans l&apos;ordre.
        </p>
      )}
    </div>
  )
}

function SourceButton({ active, onClick, icon, label, hint }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition-colors ${
        active ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' : 'bg-background hover:bg-accent'
      }`}
    >
      <span className={active ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}>{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  )
}
