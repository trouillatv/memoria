'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uploadDocumentAction } from './actions'
import { DOCUMENT_TYPE_OPTIONS, VISIBILITY_OPTIONS } from '@/lib/documents/labels'
import { classifyDocument, TIER_META } from '@/lib/documents/classify'

type Collection = { id: string; name: string }
type LinkOption = { id: string; label: string }
/** Entités rattachables, chargées EN BASE (jamais d'UUID à saisir). */
export type LinkTargets = Record<string, LinkOption[]>

// Libellés des types rattachables présentés à l'humain. Bornés et chargés
// depuis la base : contrat/site/AO/client/équipe. `intervention`/`tenant`
// volontairement hors picker (non bornés/implicite — liaison programmatique
// uniquement, ex. prefill contrat).
const TARGET_LABELS: Record<string, string> = {
  contract: 'Contrat',
  site: 'Site',
  tender: 'Appel d’offres',
  client: 'Client',
  team: 'Équipe',
}

const selectCls =
  'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm'

export function UploadDocumentForm({
  collections,
  linkTargets,
  prefillTargetType,
  prefillTargetId,
}: {
  collections: Collection[]
  linkTargets: LinkTargets
  prefillTargetType?: string
  prefillTargetId?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [targetType, setTargetType] = useState('')
  // Tri d'ingestion : type + nom de fichier → couche mémoire recommandée.
  const [docType, setDocType] = useState('')
  const [filename, setFilename] = useState('')
  const reco = docType ? classifyDocument({ documentType: docType, filename }) : null

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    setPending(true)
    const form = e.currentTarget
    const r = await uploadDocumentAction(new FormData(form))
    setPending(false)
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? 'Échec' })
      return
    }
    form.reset()
    setTargetType('')
    setDocType('')
    setFilename('')
    setMsg({ ok: true, text: 'Document envoyé. Analyse en cours…' })
    router.refresh()
  }

  if (collections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-lg border p-4">
        Crée d’abord une collection : un document doit toujours être classé.
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Collection *</label>
          <select name="collection_id" required defaultValue="" className={selectCls}>
            <option value="" disabled>
              Choisir…
            </option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Type *</label>
          <select
            name="document_type"
            required
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className={selectCls}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {DOCUMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Visibilité</label>
          <select name="visibility_level" defaultValue="manager" className={selectCls}>
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Tags (séparés par virgule)</label>
          <Input name="tags" placeholder="bloc B, humidité" />
        </div>
      </div>

      {prefillTargetType && prefillTargetId ? (
        <>
          <input type="hidden" name="target_type" value={prefillTargetType} />
          <input type="hidden" name="target_id" value={prefillTargetId} />
          <p className="text-xs text-muted-foreground">
            Rattaché à : {prefillTargetType}
          </p>
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Rattacher à (optionnel)</label>
            <select
              name="target_type"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className={selectCls}
            >
              <option value="">— Aucun —</option>
              {Object.keys(linkTargets).map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              {targetType ? `${TARGET_LABELS[targetType] ?? targetType} concerné` : 'Élément'}
            </label>
            <select
              name="target_id"
              className={selectCls}
              required={!!targetType}
              disabled={!targetType}
              defaultValue=""
              key={targetType /* reset la sélection quand le type change */}
            >
              <option value="" disabled>
                {targetType ? 'Choisir…' : 'Sélectionner un type d’abord'}
              </option>
              {(linkTargets[targetType] ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-muted-foreground">Fichier PDF *</label>
        <Input
          type="file"
          name="file"
          accept="application/pdf"
          required
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? '')}
        />
      </div>

      {/* Tri d'ingestion mémorielle — l'IA propose la couche, l'humain valide. */}
      {reco && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${TIER_META[reco.tier].badge}`}
          >
            {TIER_META[reco.tier].label}
          </span>
          <span className="text-muted-foreground">{reco.reason}</span>
          <span className="ml-auto font-medium">
            {reco.embeddingRecommended ? '✅ indexation conseillée' : '❌ pas d’indexation'}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Envoi…' : 'Téléverser'}
        </Button>
        {msg && (
          <p className="text-sm text-muted-foreground">{msg.text}</p>
        )}
      </div>
    </form>
  )
}
