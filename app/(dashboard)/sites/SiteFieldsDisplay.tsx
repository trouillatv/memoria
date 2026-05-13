// Rendu lecture compact des champs structurés "fiche site". Affiche
// uniquement les champs renseignés. Variantes : 'inline' (page sites, plus
// d'espace) et 'compact' (popover briefing, dense).

import { KeyRound, Lock, Phone, Clock, MapPinned } from 'lucide-react'
import type { ReactNode } from 'react'

interface SiteFields {
  access_code: string | null
  alarm_code: string | null
  contact_name: string | null
  contact_phone: string | null
  access_hours: string | null
  access_instructions: string | null
}

export function hasAnySiteField(s: SiteFields): boolean {
  return Boolean(
    s.access_code ||
      s.alarm_code ||
      s.contact_name ||
      s.contact_phone ||
      s.access_hours ||
      s.access_instructions,
  )
}

interface Props {
  site: SiteFields
  variant?: 'inline' | 'compact'
}

export function SiteFieldsDisplay({ site, variant = 'inline' }: Props) {
  if (!hasAnySiteField(site)) return null

  const contact =
    site.contact_name && site.contact_phone
      ? `${site.contact_name} · ${site.contact_phone}`
      : site.contact_name || site.contact_phone || null

  const items: Array<{ icon: typeof KeyRound; label: string; value: string }> = []
  if (site.access_code) {
    items.push({ icon: KeyRound, label: 'Code entrée', value: site.access_code })
  }
  if (site.alarm_code) {
    items.push({ icon: Lock, label: 'Code alarme', value: site.alarm_code })
  }
  if (contact) {
    items.push({ icon: Phone, label: 'Contact', value: contact })
  }
  if (site.access_hours) {
    items.push({ icon: Clock, label: 'Horaires', value: site.access_hours })
  }
  if (site.access_instructions) {
    items.push({
      icon: MapPinned,
      label: 'Accès',
      value: site.access_instructions,
    })
  }

  if (variant === 'compact') {
    return (
      <ul className="space-y-1">
        {items.map((it) => (
          <Row key={it.label} icon={<it.icon className="h-3 w-3 text-muted-foreground/70" aria-hidden />}>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">
              {it.label}
            </span>
            <span className="whitespace-pre-wrap">{it.value}</span>
          </Row>
        ))}
      </ul>
    )
  }

  return (
    <ul className="space-y-1 text-xs text-foreground/85">
      {items.map((it) => (
        <Row
          key={it.label}
          icon={<it.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        >
          <span className="text-muted-foreground mr-1.5">{it.label} :</span>
          <span className="whitespace-pre-wrap">{it.value}</span>
        </Row>
      ))}
    </ul>
  )
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-1.5">
      <span className="shrink-0 self-center">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}
