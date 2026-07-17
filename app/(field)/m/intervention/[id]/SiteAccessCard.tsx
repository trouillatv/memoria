// Carte "infos pratiques" pour l'écran chef d'équipe.
// Mobile-first + lisible en plein soleil :
//  - codes en text-2xl tracking-widest (lecture rapide à l'arrache)
//  - labels en text-xs slate-700 (contraste AAA)
//  - cadre neutre slate (PAS sky-50 — sky est réservé au badge "Mission en
//    cours" pour éviter le conflit sémantique sur cette même page)
//  - téléphone cliquable (tap-to-call)
//  - repliable via <details> natif : fermée par défaut quand intervention
//    in_progress (l'agent est sur place, n'a plus besoin du code)

import { KeyRound, Lock, Phone, Clock, MapPinned, ChevronDown } from 'lucide-react'

interface Site {
  access_code: string | null
  alarm_code: string | null
  contact_name: string | null
  contact_phone: string | null
  access_hours: string | null
  access_instructions: string | null
}

function hasAny(s: Site): boolean {
  return Boolean(
    s.access_code ||
      s.alarm_code ||
      s.contact_name ||
      s.contact_phone ||
      s.access_hours ||
      s.access_instructions,
  )
}

export function SiteAccessCard({
  site,
  collapsed = false,
}: {
  site: Site
  /** Si true, la carte est repliée par défaut. Utilisé quand l'intervention
   *  est déjà in_progress — l'agent est sur place, accès moins utile. */
  collapsed?: boolean
}) {
  if (!hasAny(site)) return null

  const telHref = site.contact_phone
    ? `tel:${site.contact_phone.replace(/[^+0-9]/g, '')}`
    : null

  return (
    <details
      open={!collapsed}
      className="rounded-lg border-2 border-slate-300 bg-white group [&_summary::-webkit-details-marker]:hidden [&_summary::marker]:hidden"
    >
      <summary className="cursor-pointer select-none flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Accès au chantier
        </h2>
        <ChevronDown
          className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {site.access_code && (
            <CodeBlock icon={KeyRound} label="Code entrée" value={site.access_code} />
          )}
          {site.alarm_code && (
            <CodeBlock icon={Lock} label="Code alarme" value={site.alarm_code} />
          )}
        </div>

        {(site.contact_name || site.contact_phone) && (
          <div className="flex items-center gap-2 text-base text-slate-900">
            <Phone className="h-5 w-5 text-slate-700 shrink-0" aria-hidden />
            <div className="min-w-0">
              {site.contact_name && (
                <div className="font-semibold">{site.contact_name}</div>
              )}
              {telHref ? (
                <a
                  href={telHref}
                  className="text-slate-900 underline underline-offset-2 active:text-slate-600 text-lg font-medium tabular-nums"
                >
                  {site.contact_phone}
                </a>
              ) : null}
            </div>
          </div>
        )}

        {site.access_hours && (
          <div className="flex items-start gap-2 text-sm text-slate-900">
            <Clock className="h-5 w-5 text-slate-700 mt-0.5 shrink-0" aria-hidden />
            <span className="font-medium">{site.access_hours}</span>
          </div>
        )}

        {site.access_instructions && (
          <div className="flex items-start gap-2 text-sm text-slate-900">
            <MapPinned className="h-5 w-5 text-slate-700 mt-0.5 shrink-0" aria-hidden />
            <span className="whitespace-pre-wrap">{site.access_instructions}</span>
          </div>
        )}
      </div>
    </details>
  )
}

function CodeBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof KeyRound
  label: string
  value: string
}) {
  return (
    <div className="rounded border-2 border-slate-200 bg-slate-50 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-700 font-medium">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-widest text-slate-900">
        {value}
      </div>
    </div>
  )
}
