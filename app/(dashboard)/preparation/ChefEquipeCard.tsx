'use client'

// Sprint 4 PC — Card chef d'équipe sur /preparation (Doctrine V5).
//
// Maeva consulte cette card le soir, ajuste 3 toggles + une note libre 140
// chars max, puis ouvre api.whatsapp.com/send?phone=…&text=… pour envoyer
// individuellement (Maxim 9 : jamais groupe collectif). On utilise
// api.whatsapp.com/send (et non wa.me) pour la compatibilité Windows :
// wa.me redirige sur Windows vers une page « Continue to Chat » qui échoue
// à pré-remplir le message.
//
// Verrous gravés ici :
//   - V4 : aucune formulation de contrôle pré-générée (helper DB l'a filtré).
//   - V5 : édition contrainte (toggles + 140 chars max + emoji ✋ palette).
//   - V6 : aucun timestamp d'envoi persisté en DB. Badge UI temporaire en
//     localStorage `chef-prep-sent::<userId>::<forDate>` purgé naturellement
//     car la clé contient la date du jour ciblé.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  MessageCircle,
  PhoneOff,
  Check,
  ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ChefEquipePreparation } from '@/lib/db/chef-equipe-preparation'

const MONTHS_FR_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]
const WEEKDAYS_FR_SHORT = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
]

function formatDateShortFr(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d))
  const weekday = WEEKDAYS_FR_SHORT[date.getUTCDay()] ?? ''
  const month = MONTHS_FR_SHORT[(m ?? 1) - 1] ?? ''
  return `${weekday} ${d} ${month}`
}

function firstNameOf(fullName: string): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}

/** localStorage key — change tous les jours, purge naturelle (Verrou V6). */
function sentKey(userId: string, forDate: string): string {
  return `chef-prep-sent::${userId}::${forDate}`
}

const NOTE_MAX = 140

/**
 * Construit le texte envoyé sur WhatsApp à partir des toggles et de la note.
 * Wording strictement passif descriptif (Verrou V4). Aucune intro injonctive.
 */
export function buildWhatsAppMessage(args: {
  preparation: ChefEquipePreparation
  includePassages: boolean
  includeASavoir: boolean
  includeContinuite: boolean
  includeAcces: boolean
  freeNote: string
}): string {
  const { preparation: p, includePassages, includeASavoir, includeContinuite, includeAcces, freeNote } = args
  const firstName = firstNameOf(p.userFullName)
  const dateFr = formatDateShortFr(p.forDate)

  const lines: string[] = []
  lines.push(firstName ? `Salut ${firstName} 👋` : 'Salut 👋')
  lines.push(`Demain ${dateFr} :`)

  if (includePassages && p.blocks.passages.length > 0) {
    for (const passage of p.blocks.passages) {
      const teamSuffix = passage.teamName ? ` · ${passage.teamName}` : ''
      lines.push(
        `• ${passage.time} — ${passage.siteName}${teamSuffix} (${passage.missionShortLabel})`,
      )
    }
  }

  if (includeAcces && p.blocks.accesInfos.length > 0) {
    lines.push('')
    lines.push('Accès :')
    for (const info of p.blocks.accesInfos) {
      lines.push(`• ${info}`)
    }
  }

  if (includeASavoir && p.blocks.aSavoir.length > 0) {
    lines.push('')
    lines.push('À savoir :')
    for (const note of p.blocks.aSavoir) {
      lines.push(`• ${note}`)
    }
  }

  if (includeContinuite && p.blocks.continuite.length > 0) {
    lines.push('')
    for (const line of p.blocks.continuite) {
      lines.push(line)
    }
  }

  const trimmedNote = (freeNote ?? '').trim()
  if (trimmedNote) {
    lines.push('')
    lines.push(trimmedNote)
  }

  return lines.join('\n')
}

/** Construit le lien WhatsApp 1-à-1 cross-platform (Maxim 9).
 *  api.whatsapp.com/send fonctionne mieux que wa.me sur Windows
 *  (pas de page « Continue to Chat » intermédiaire). Sur mobile/Mac
 *  ça ouvre WhatsApp Desktop/Web pareil. */
function buildWhatsAppLink(phone: string, message: string): string {
  // L'endpoint attend le numéro sans le `+` initial.
  const digits = phone.replace(/^\+/, '')
  return `https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`
}

export function ChefEquipeCard({
  preparation,
}: {
  preparation: ChefEquipePreparation
}) {
  const [includePassages, setIncludePassages] = useState(true)
  const [includeAcces, setIncludeAcces] = useState(true)
  const [includeASavoir, setIncludeASavoir] = useState(true)
  const [includeContinuite, setIncludeContinuite] = useState(true)
  const [freeNote, setFreeNote] = useState('')
  const [sent, setSent] = useState(false)

  const remaining = NOTE_MAX - freeNote.length
  const noteTooLong = remaining < 0

  // Rehydrate badge "✓ envoyé ce soir" depuis localStorage (Verrou V6).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const v = window.localStorage.getItem(sentKey(preparation.userId, preparation.forDate))
      if (v === '1') setSent(true)
    } catch {
      // localStorage inaccessible (mode privé) — pas grave, on continue sans badge.
    }
  }, [preparation.userId, preparation.forDate])

  const message = useMemo(
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

  const phoneOk = Boolean(preparation.userPhone)
  const waLink = phoneOk ? buildWhatsAppLink(preparation.userPhone!, message) : null

  const markSent = () => {
    try {
      window.localStorage.setItem(
        sentKey(preparation.userId, preparation.forDate),
        '1',
      )
    } catch {
      // ignore
    }
    setSent(true)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold leading-tight">
              {preparation.userFullName}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {preparation.blocks.passages.length} passage
              {preparation.blocks.passages.length > 1 ? 's' : ''} prévu
              {preparation.blocks.passages.length > 1 ? 's' : ''}
            </p>
          </div>
          {sent && (
            <Badge
              data-testid="sent-badge"
              className="bg-emerald-100 text-emerald-800 inline-flex items-center gap-1"
            >
              <Check className="h-3 w-3" />
              Envoyé ce soir
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bloc passages */}
        <ToggleBlock
          id={`passages-${preparation.userId}`}
          label={`Passages (${preparation.blocks.passages.length})`}
          checked={includePassages}
          onCheckedChange={setIncludePassages}
        >
          {preparation.blocks.passages.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Aucun passage planifié.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {preparation.blocks.passages.map((p, idx) => (
                <li key={idx}>
                  <span className="font-medium tabular-nums">{p.time}</span>{' '}
                  — {p.siteName}
                  {p.teamName && (
                    <span className="text-muted-foreground"> · {p.teamName}</span>
                  )}{' '}
                  <span className="text-muted-foreground">
                    ({p.missionShortLabel})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ToggleBlock>

        {/* Bloc accès — fiche site (code entrée, contact, horaires). */}
        <ToggleBlock
          id={`acces-${preparation.userId}`}
          label={`Accès (${preparation.blocks.accesInfos.length})`}
          checked={includeAcces}
          onCheckedChange={setIncludeAcces}
          disabled={preparation.blocks.accesInfos.length === 0}
        >
          {preparation.blocks.accesInfos.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Aucune info d&apos;accès renseignée sur les sites concernés.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {preparation.blocks.accesInfos.map((a, idx) => (
                <li key={idx}>• {a}</li>
              ))}
            </ul>
          )}
        </ToggleBlock>

        {/* Bloc à savoir */}
        <ToggleBlock
          id={`asavoir-${preparation.userId}`}
          label={`À savoir (${preparation.blocks.aSavoir.length})`}
          checked={includeASavoir}
          onCheckedChange={setIncludeASavoir}
          disabled={preparation.blocks.aSavoir.length === 0}
        >
          {preparation.blocks.aSavoir.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Aucune note récente sur les sites concernés.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {preparation.blocks.aSavoir.map((n, idx) => (
                <li key={idx}>• {n}</li>
              ))}
            </ul>
          )}
        </ToggleBlock>

        {/* Bloc continuité */}
        <ToggleBlock
          id={`continuite-${preparation.userId}`}
          label="Continuité"
          checked={includeContinuite}
          onCheckedChange={setIncludeContinuite}
          disabled={preparation.blocks.continuite.length === 0}
        >
          {preparation.blocks.continuite.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Pas encore de compteur de continuité.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {preparation.blocks.continuite.map((c, idx) => (
                <li key={idx}>{c}</li>
              ))}
            </ul>
          )}
        </ToggleBlock>

        {/* Note libre — 140 chars max (Verrou V5). */}
        <div className="space-y-1.5">
          <label
            htmlFor={`note-${preparation.userId}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Note libre (optionnelle)
          </label>
          <Textarea
            id={`note-${preparation.userId}`}
            value={freeNote}
            onChange={(e) => setFreeNote(e.target.value.slice(0, NOTE_MAX))}
            maxLength={NOTE_MAX}
            placeholder="Ajout factuel ; pas une consigne."
            className="min-h-[60px] text-sm"
            aria-describedby={`note-counter-${preparation.userId}`}
          />
          <div
            id={`note-counter-${preparation.userId}`}
            className={
              'text-[11px] tabular-nums text-right ' +
              (noteTooLong ? 'text-destructive' : 'text-muted-foreground')
            }
          >
            {freeNote.length} / {NOTE_MAX}
          </div>
        </div>

        {/* Aperçu compact */}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Aperçu du message
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[12px] leading-snug font-mono">
{message}
          </pre>
        </details>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {phoneOk ? (
            <a
              href={waLink ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={markSent}
              data-testid="wa-send-link"
              className="inline-flex items-center justify-center h-7 px-2.5 gap-1 rounded-[min(var(--radius-md),12px)] text-[0.8rem] font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Envoyer dans WhatsApp
            </a>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled
                className="cursor-not-allowed"
                data-testid="wa-send-disabled"
              >
                <PhoneOff className="h-4 w-4 mr-1" />
                Envoyer dans WhatsApp
              </Button>
              <Link
                href="/admin/personnes"
                className="inline-flex items-center text-xs text-amber-700 hover:underline"
                data-testid="missing-phone-link"
              >
                Saisir le numéro
                <ChevronRight className="h-3 w-3 ml-0.5" />
              </Link>
            </div>
          )}
          {!phoneOk && (
            <Badge className="bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wider">
              Numéro manquant
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ToggleBlock({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={
        'rounded-md border p-3 ' + (disabled ? 'opacity-60 bg-muted/30' : 'bg-card')
      }
      data-testid={`toggle-block-${id}`}
    >
      <label
        htmlFor={id}
        className="flex items-center justify-between gap-2 cursor-pointer"
      >
        <span className="text-sm font-medium">{label}</span>
        <Switch
          id={id}
          checked={checked && !disabled}
          onCheckedChange={(v) => {
            if (disabled) return
            onCheckedChange(Boolean(v))
          }}
          disabled={disabled}
        />
      </label>
      {checked && !disabled && <div className="mt-2">{children}</div>}
      {(!checked || disabled) && (
        <div className="sr-only">{children}</div>
      )}
    </div>
  )
}
