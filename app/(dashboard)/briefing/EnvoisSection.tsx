'use client'

// Section "Préparation des envois WhatsApp" intégrée dans la page Briefing
// du soir (fusion /preparation → /briefing décidée 2026-05-14).
//
// Doctrine V5 :
//   - Pilier 3 : MemorIA prépare, Maeva clique pour envoyer (jamais auto).
//   - Maxim 9 : envois 1-à-1, pas de groupe collectif.
//   - Verrou V6 : aucun timestamp d'envoi persisté (le "envoyé" est local).
//   - Verrou V5 : édition contrainte mais possible — texte modifiable.
//
// UX :
//   - Liste compacte des chefs d'équipe ayant ≥1 passage demain.
//   - Click → drawer latéral avec détail + édition tel + édition message.
//   - Téléphone manquant → édition inline + save permanent par défaut.

import { useEffect, useMemo, useState } from 'react'
import { Send, Phone, X, MessageCircle, CheckCheck } from 'lucide-react'
import type { ChefEquipePreparation } from '@/lib/db/chef-equipe-preparation'
import { buildWhatsAppMessage } from '@/app/(dashboard)/preparation/ChefEquipeCard'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { updateUserPhoneAction } from '@/app/admin/users/actions'

interface Props {
  preparations: ChefEquipePreparation[]
}

function sentKey(userId: string, forDate: string) {
  return `briefing:sent:${forDate}:${userId}`
}

function buildWaMeLink(phone: string, message: string): string {
  const digits = phone.replace(/^\+/, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export function EnvoisSection({ preparations }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sentMap, setSentMap] = useState<Record<string, boolean>>({})

  // Rehydrate "envoyé ce soir" depuis localStorage (verrou V6 : pas en DB).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const map: Record<string, boolean> = {}
    for (const p of preparations) {
      try {
        const v = window.localStorage.getItem(sentKey(p.userId, p.forDate))
        if (v === '1') map[p.userId] = true
      } catch {
        // localStorage inaccessible, on ignore
      }
    }
    setSentMap(map)
  }, [preparations])

  const selected = preparations.find((p) => p.userId === selectedId) ?? null

  function markSent(userId: string, forDate: string) {
    setSentMap((m) => ({ ...m, [userId]: true }))
    try {
      window.localStorage.setItem(sentKey(userId, forDate), '1')
    } catch {
      // ignore
    }
  }

  if (preparations.length === 0) {
    return (
      <section id="envois" aria-labelledby="envois-heading" className="space-y-3">
        <h2 id="envois-heading" className="text-base font-medium inline-flex items-center gap-2">
          <Send className="h-4 w-4 text-brand-600" aria-hidden />
          Préparation des envois
        </h2>
        <p className="text-sm italic text-muted-foreground">
          Aucun chef d&apos;équipe n&apos;a de passage prévu demain.
        </p>
      </section>
    )
  }

  return (
    <section id="envois" aria-labelledby="envois-heading" className="space-y-3 scroll-mt-4">
      <h2 id="envois-heading" className="text-base font-medium inline-flex items-center gap-2">
        <Send className="h-4 w-4 text-brand-600" aria-hidden />
        Préparation des envois ({preparations.length})
      </h2>
      <p className="text-xs text-muted-foreground italic">
        Cliquez sur un chef d&apos;équipe pour relire et envoyer son message WhatsApp.
      </p>

      <ul className="space-y-2">
        {preparations.map((p) => {
          const sent = sentMap[p.userId]
          const hasPhone = Boolean(p.userPhone)
          return (
            <li key={p.userId}>
              <button
                type="button"
                onClick={() => setSelectedId(p.userId)}
                className="w-full text-left rounded-lg border bg-card hover:bg-muted/30 transition-colors p-3 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {p.userFullName}
                    {sent && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        <CheckCheck className="h-2.5 w-2.5" aria-hidden />
                        envoyé
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                    {p.blocks.passages.length} passage{p.blocks.passages.length > 1 ? 's' : ''}
                  </div>
                </div>
                <div className="shrink-0">
                  {hasPhone ? (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                      <Phone className="h-2.5 w-2.5" aria-hidden />
                      WhatsApp
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      <Phone className="h-2.5 w-2.5" aria-hidden />
                      Pas de tél.
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {selected && (
        <AgentEnvoiDrawer
          preparation={selected}
          onClose={() => setSelectedId(null)}
          onSent={() => markSent(selected.userId, selected.forDate)}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Drawer latéral
// ---------------------------------------------------------------------------

const NOTE_MAX = 140

function AgentEnvoiDrawer({
  preparation,
  onClose,
  onSent,
}: {
  preparation: ChefEquipePreparation
  onClose: () => void
  onSent: () => void
}) {
  const [phone, setPhone] = useState(preparation.userPhone ?? '')
  const [saveToProfile, setSaveToProfile] = useState(true)
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneSaved, setPhoneSaved] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)

  const [freeNote, setFreeNote] = useState('')
  const [editingMessage, setEditingMessage] = useState(false)
  const [customMessage, setCustomMessage] = useState<string | null>(null)

  // Toggles par bloc (mêmes que ChefEquipeCard).
  const [includePassages, setIncludePassages] = useState(true)
  const [includeAcces, setIncludeAcces] = useState(true)
  const [includeASavoir, setIncludeASavoir] = useState(true)
  const [includeContinuite, setIncludeContinuite] = useState(true)

  const builtMessage = useMemo(
    () =>
      buildWhatsAppMessage({
        preparation,
        includePassages,
        includeASavoir,
        includeContinuite,
        includeAcces,
        freeNote,
      }),
    [preparation, includePassages, includeASavoir, includeContinuite, includeAcces, freeNote],
  )

  const message = customMessage ?? builtMessage
  const remaining = NOTE_MAX - freeNote.length

  // Esc ferme.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock scroll body tant qu'ouvert.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function savePhone() {
    if (!saveToProfile) {
      // Override one-shot : pas de save DB, juste utiliser pour ce wa.me link.
      setPhoneError(null)
      setPhoneSaved(true)
      return
    }
    setPhoneSaving(true)
    setPhoneError(null)
    try {
      const fd = new FormData()
      fd.set('userId', preparation.userId)
      fd.set('phone', phone)
      const r = await updateUserPhoneAction(fd)
      if (r && 'error' in r && r.error) {
        setPhoneError(r.error)
        toast.error(r.error)
      } else {
        setPhoneSaved(true)
        toast.success('Numéro enregistré.')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue'
      setPhoneError(msg)
      toast.error(msg)
    } finally {
      setPhoneSaving(false)
    }
  }

  const phoneClean = phone.trim().replace(/[\s.\-_]/g, '')
  const phoneValid = phoneClean === '' ? false : /^\+[0-9]{7,15}$/.test(phoneClean)
  const waLink = phoneValid ? buildWaMeLink(phoneClean, message) : null

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="fixed inset-0 z-40 bg-black/30 animate-in fade-in-0"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Préparation de ${preparation.userFullName}`}
        className={cn(
          'fixed top-0 right-0 z-50 h-dvh w-full sm:max-w-md bg-card border-l shadow-xl',
          'overflow-y-auto animate-in slide-in-from-right-4',
        )}
      >
        <header className="sticky top-0 bg-card border-b px-4 py-3 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{preparation.userFullName}</h3>
            <p className="text-xs text-muted-foreground">
              {preparation.blocks.passages.length} passage
              {preparation.blocks.passages.length > 1 ? 's' : ''} prévu
              {preparation.blocks.passages.length > 1 ? 's' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted/50"
            aria-label="Fermer le panneau"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-4 space-y-5">
          {/* Téléphone WhatsApp */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider inline-flex items-center gap-1.5">
              <Phone className="h-3 w-3" aria-hidden />
              WhatsApp
            </label>
            <div className="flex items-center gap-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setPhoneSaved(false)
                  setPhoneError(null)
                }}
                placeholder="+687123456"
                className="flex-1 rounded border p-2 text-sm font-mono tabular-nums"
                disabled={phoneSaving}
              />
              <button
                type="button"
                onClick={savePhone}
                disabled={phoneSaving || !phoneValid || phone === (preparation.userPhone ?? '')}
                className="px-3 py-2 rounded border bg-foreground text-background text-sm disabled:opacity-40"
              >
                {phoneSaving ? '...' : 'OK'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={saveToProfile}
                onChange={(e) => setSaveToProfile(e.target.checked)}
                className="accent-foreground"
              />
              <span>
                Enregistrer ce numéro sur le profil (sinon : usage unique pour ce soir)
              </span>
            </label>
            {phoneError && <p className="text-xs text-red-700">{phoneError}</p>}
            {phoneSaved && !phoneError && (
              <p className="text-xs text-emerald-700">
                {saveToProfile ? 'Numéro enregistré sur le profil.' : 'Numéro utilisé pour ce message uniquement.'}
              </p>
            )}
            {!phoneValid && phone.trim() !== '' && (
              <p className="text-xs text-amber-700">
                Format attendu : +687123456 (E.164, sans espaces).
              </p>
            )}
          </div>

          {/* Passages */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Passages demain
            </h4>
            {preparation.blocks.passages.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">Aucun.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preparation.blocks.passages.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium tabular-nums">{p.time}</span> —{' '}
                    {p.siteName}{' '}
                    <span className="text-muted-foreground">({p.missionShortLabel})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Toggles blocs */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Inclure dans le message
            </legend>
            <ToggleRow checked={includePassages} onChange={setIncludePassages} label="Passages" count={preparation.blocks.passages.length} />
            <ToggleRow checked={includeAcces} onChange={setIncludeAcces} label="Accès (codes, contact)" count={preparation.blocks.accesInfos.length} />
            <ToggleRow checked={includeASavoir} onChange={setIncludeASavoir} label="À savoir" count={preparation.blocks.aSavoir.length} />
            <ToggleRow checked={includeContinuite} onChange={setIncludeContinuite} label="Continuité" count={preparation.blocks.continuite.length} />
          </fieldset>

          {/* Note libre */}
          <div className="space-y-1.5">
            <label htmlFor="freeNote" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Note libre (optionnelle, {remaining} car. restants)
            </label>
            <textarea
              id="freeNote"
              value={freeNote}
              onChange={(e) => setFreeNote(e.target.value.slice(0, NOTE_MAX))}
              rows={2}
              placeholder="Ajout factuel ; pas une consigne."
              className="w-full rounded border p-2 text-sm"
              maxLength={NOTE_MAX}
            />
          </div>

          {/* Aperçu / édition message */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Aperçu du message
              </label>
              <button
                type="button"
                onClick={() => {
                  if (editingMessage) {
                    setCustomMessage(null)
                    setEditingMessage(false)
                  } else {
                    setCustomMessage(builtMessage)
                    setEditingMessage(true)
                  }
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                {editingMessage ? 'Annuler édition' : 'Éditer le texte'}
              </button>
            </div>
            {editingMessage ? (
              <textarea
                value={customMessage ?? ''}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={10}
                className="w-full rounded border p-2 text-sm font-mono whitespace-pre-wrap"
              />
            ) : (
              <pre className="rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap font-sans">
                {message}
              </pre>
            )}
          </div>

          {/* CTA */}
          <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 border-t bg-card flex items-center gap-2">
            {waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onSent}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Ouvrir WhatsApp
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Numéro WhatsApp manquant ou invalide"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded px-3 py-2 bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Ouvrir WhatsApp
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded border text-sm"
            >
              Fermer
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

function ToggleRow({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  count: number
}) {
  const disabled = count === 0
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-2 text-sm py-1',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked && !disabled}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="accent-foreground"
        />
        <span>{label}</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </label>
  )
}
