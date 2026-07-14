'use client'

// Bloc de champs structurés "fiche site" — partagé entre les 3 formulaires
// (création contrat-scope, édition contrat-scope, édition globale).
// Tous les champs sont facultatifs. Garde le formulaire principal léger en
// repliant tout dans un <details> qui s'ouvre seulement si l'user veut.

import type { ReactNode } from 'react'

interface State {
  access_code: string
  alarm_code: string
  contact_name: string
  contact_phone: string
  access_hours: string
  access_instructions: string
}

interface Props {
  state: State
  onChange: (patch: Partial<State>) => void
  disabled?: boolean
  /** Forcer l'ouverture du fieldset si au moins un champ est rempli. */
  initiallyOpen?: boolean
}

export function SiteExtendedFields({ state, onChange, disabled, initiallyOpen }: Props) {
  return (
    <details
      open={initiallyOpen}
      className="rounded border bg-muted/20 group"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <span className="font-medium">Informations pratiques (optionnel)</span>
        <span className="text-[10px] text-muted-foreground/70">
          code d&apos;entrée, contact, horaires, accès
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">
        <Row>
          <Field label="Code d'entrée">
            <input
              value={state.access_code}
              onChange={(e) => onChange({ access_code: e.target.value })}
              className="w-full rounded border p-2 text-sm"
              maxLength={200}
              disabled={disabled}
            />
          </Field>
          <Field label="Code alarme">
            <input
              value={state.alarm_code}
              onChange={(e) => onChange({ alarm_code: e.target.value })}
              className="w-full rounded border p-2 text-sm"
              maxLength={200}
              disabled={disabled}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Contact chantier (nom)">
            <input
              value={state.contact_name}
              onChange={(e) => onChange({ contact_name: e.target.value })}
              className="w-full rounded border p-2 text-sm"
              maxLength={200}
              disabled={disabled}
            />
          </Field>
          <Field label="Contact chantier (téléphone)">
            <input
              value={state.contact_phone}
              onChange={(e) => onChange({ contact_phone: e.target.value })}
              className="w-full rounded border p-2 text-sm"
              maxLength={50}
              disabled={disabled}
            />
          </Field>
        </Row>
        <Field label="Horaires d'accès">
          <input
            value={state.access_hours}
            onChange={(e) => onChange({ access_hours: e.target.value })}
            className="w-full rounded border p-2 text-sm"
            maxLength={200}
            placeholder="ex. Lun-Ven 7h-19h, Sam 8h-12h"
            disabled={disabled}
          />
        </Field>
        <Field label="Instructions d'accès">
          <textarea
            value={state.access_instructions}
            onChange={(e) => onChange({ access_instructions: e.target.value })}
            className="w-full rounded border p-2 text-sm"
            rows={2}
            maxLength={1000}
            placeholder="étage, ascenseur, parking, boîte à clés..."
            disabled={disabled}
          />
        </Field>
      </div>
    </details>
  )
}

/** Helper interne — un champ avec label + slot pour input/textarea. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 flex-1 min-w-0">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 flex-wrap sm:flex-nowrap">{children}</div>
}

export function emptySiteExtendedState(): State {
  return {
    access_code: '',
    alarm_code: '',
    contact_name: '',
    contact_phone: '',
    access_hours: '',
    access_instructions: '',
  }
}

export function siteExtendedFromDb(site: {
  access_code: string | null
  alarm_code: string | null
  contact_name: string | null
  contact_phone: string | null
  access_hours: string | null
  access_instructions: string | null
}): State {
  return {
    access_code: site.access_code ?? '',
    alarm_code: site.alarm_code ?? '',
    contact_name: site.contact_name ?? '',
    contact_phone: site.contact_phone ?? '',
    access_hours: site.access_hours ?? '',
    access_instructions: site.access_instructions ?? '',
  }
}

export function applySiteExtendedToFormData(fd: FormData, s: State): void {
  if (s.access_code.trim()) fd.set('access_code', s.access_code.trim())
  if (s.alarm_code.trim()) fd.set('alarm_code', s.alarm_code.trim())
  if (s.contact_name.trim()) fd.set('contact_name', s.contact_name.trim())
  if (s.contact_phone.trim()) fd.set('contact_phone', s.contact_phone.trim())
  if (s.access_hours.trim()) fd.set('access_hours', s.access_hours.trim())
  if (s.access_instructions.trim())
    fd.set('access_instructions', s.access_instructions.trim())
}

export function hasAnyExtendedField(s: State): boolean {
  return (
    s.access_code.trim() !== '' ||
    s.alarm_code.trim() !== '' ||
    s.contact_name.trim() !== '' ||
    s.contact_phone.trim() !== '' ||
    s.access_hours.trim() !== '' ||
    s.access_instructions.trim() !== ''
  )
}
