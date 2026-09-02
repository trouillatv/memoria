'use client'

// Ligne d'un site dans la vue globale /sites.
// Modes : lecture (avec contrat lié + compteurs), édition inline, delete protégé.

import { Fragment, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Pencil, Trash2, X, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SiteWithStats } from '@/lib/db/sites'
import { updateSiteGlobalAction, deleteSiteAction } from './actions'
import {
  SiteExtendedFields,
  siteExtendedFromDb,
  applySiteExtendedToFormData,
  hasAnyExtendedField,
} from './SiteExtendedFields'
import { SiteFieldsDisplay, hasAnySiteField } from './SiteFieldsDisplay'
import { EntityLogo } from '@/components/ui/EntityLogo'

interface Props {
  site: SiteWithStats
  inactive?: boolean
}

function formatLastDate(iso: string | null): string {
  if (!iso) return 'jamais'
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

export function SiteGlobalRow({ site, inactive }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(site.name)
  const [address, setAddress] = useState(site.address ?? '')
  const [notes, setNotes] = useState(site.notes ?? '')
  const [clientLogo, setClientLogo] = useState<File | null>(null)
  const [siteLogo, setSiteLogo] = useState<File | null>(null)
  const [extended, setExtended] = useState(siteExtendedFromDb(site))

  function cancel() {
    setName(site.name)
    setAddress(site.address ?? '')
    setNotes(site.notes ?? '')
    setClientLogo(null)
    setSiteLogo(null)
    setExtended(siteExtendedFromDb(site))
    setEditing(false)
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Nom requis')
      return
    }
    const fd = new FormData()
    fd.set('site_id', site.id)
    fd.set('name', name.trim())
    if (address.trim()) fd.set('address', address.trim())
    if (notes.trim()) fd.set('notes', notes.trim())
    if (clientLogo) fd.set('client_logo', clientLogo)
    if (siteLogo) fd.set('site_logo', siteLogo)
    applySiteExtendedToFormData(fd, extended)
    startTransition(async () => {
      const r = await updateSiteGlobalAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Site mis à jour')
        setEditing(false)
        router.refresh()
      }
    })
  }

  async function remove() {
    const ok = window.confirm(
      `Supprimer le site « ${site.name} » ?\n\nCette action est irréversible.`,
    )
    if (!ok) return
    const fd = new FormData()
    fd.set('site_id', site.id)
    startTransition(async () => {
      const r = await deleteSiteAction(fd)
      if (r && 'error' in r && r.error) {
        // Fallback : si jamais une dépendance échappe au check côté UI
        // (race condition, donnée créée entre temps), on garde le toast
        // long pour ne pas perdre le message.
        toast.error(r.error, { duration: 8000 })
      } else {
        toast.success('Site supprimé')
        router.refresh()
      }
    })
  }

  // Delete bloqué côté UI dès qu'il y a une donnée liée (les counts viennent
  // déjà du chargement de la page, donc pas de query supplémentaire). Cohérent
  // avec la doctrine V5 : aucun historique n'est jamais perdu.
  const blockers: string[] = []
  if (site.missions_count > 0) {
    blockers.push(`${site.missions_count} mission${site.missions_count > 1 ? 's' : ''}`)
  }
  if (site.interventions_count > 0) {
    blockers.push(
      `${site.interventions_count} intervention${site.interventions_count > 1 ? 's' : ''}`,
    )
  }
  if (site.site_notes_count > 0) {
    blockers.push(
      `${site.site_notes_count} note${site.site_notes_count > 1 ? 's' : ''} mémoire`,
    )
  }
  const deleteDisabled = blockers.length > 0
  const deleteTitle = deleteDisabled
    ? `Suppression impossible : lié à ${blockers.join(', ')}. ` +
      `Le site basculera automatiquement en « Inactif » 6 mois après ` +
      `sa dernière intervention.`
    : 'Supprimer ce site (aucune donnée liée).'

  const muted = inactive ? 'opacity-60' : ''

  if (editing) {
    return (
      <li className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Éditer le chantier</h3>
          <button
            type="button"
            onClick={cancel}
            className="p-1 rounded hover:bg-muted/50"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Nom du chantier *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border p-2 text-sm"
            maxLength={200}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Adresse</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded border p-2 text-sm"
            maxLength={500}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Notes (optionnel)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border p-2 text-sm"
            rows={2}
            maxLength={2000}
            disabled={pending}
          />
        </div>
        {site.client_id && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Remplacer le logo du client</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setClientLogo(e.target.files?.[0] ?? null)}
              className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
              disabled={pending}
            />
            <p className="text-[10px] text-muted-foreground/70">Partagé par tous les chantiers de ce client.</p>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Image du chantier</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setSiteLogo(e.target.files?.[0] ?? null)}
            className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
            disabled={pending}
          />
          <p className="text-[10px] text-muted-foreground/70">Propre à ce chantier (indépendante du logo client).</p>
        </div>
        <SiteExtendedFields
          state={extended}
          onChange={(patch) => setExtended((s) => ({ ...s, ...patch }))}
          disabled={pending}
          initiallyOpen={hasAnyExtendedField(extended)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !name.trim()}
            className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
          >
            {pending ? 'Sauvegarde...' : 'Enregistrer'}
          </button>
        </div>
      </li>
    )
  }

  const hasFields = hasAnySiteField(site)

  // Métadonnée de chantier : ce qu'il CONTIENT réellement, dans le vocabulaire du
  // modèle ACTUEL (visites terrain · actions · PV importés · dernière visite).
  // Objets réels comptés sans heuristique — jamais de KPI/agrégat. Chaque métrique
  // n'apparaît que si elle est > 0 (pas de « rangée de zéros »). Les compteurs de
  // maintenance (mission/intervention/note) restent en base pour la protection de
  // suppression, mais ne décrivent plus le chantier sur cette ligne.
  const metaParts: React.ReactNode[] = []
  if (site.visites_count > 0) {
    metaParts.push(
      <span className="font-medium text-foreground">
        {site.visites_count} visite{site.visites_count > 1 ? 's' : ''}
      </span>,
    )
  }
  if (site.actions_count > 0) {
    metaParts.push(<span>{site.actions_count} action{site.actions_count > 1 ? 's' : ''}</span>)
  }
  if (site.pv_imported_count > 0) {
    metaParts.push(<span>{site.pv_imported_count} PV importé{site.pv_imported_count > 1 ? 's' : ''}</span>)
  }
  if (site.visites_count > 0) {
    metaParts.push(<span>Dernière visite {formatLastDate(site.last_visit_at)}</span>)
  }

  return (
    <li className={`rounded-lg border bg-card overflow-hidden transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-brand-300 hover:shadow-md hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${muted}`}>
      {/* Cluster A — Identification primaire : nom + badges + actions */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Un seul visuel : l'image PROPRE au chantier en priorité, le logo
                client en repli si le chantier n'en a pas (puis initiales client). */}
            {(site.site_logo_url || site.client_display_name) && (
              <EntityLogo
                src={site.site_logo_url ?? site.client_logo_url}
                label={site.site_logo_url ? site.name : (site.client_display_name ?? site.name)}
                size="xl"
                variant="rounded"
                fallbackColor={site.site_logo_url ? '#dcfce7' : '#dbeafe'}
                alt={site.site_logo_url ? site.name : (site.client_display_name ?? site.name)}
              />
            )}
            <Link
              href={`/sites/${site.id}`}
              className="text-base font-semibold leading-tight hover:underline"
            >
              {site.name}
            </Link>
            {site.contract_name && (
              <Link
                href={`/contracts/${site.contract_id}/sites`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-muted/30 text-[10px] text-muted-foreground hover:bg-muted/60"
              >
                <Building2 className="h-2.5 w-2.5" aria-hidden />
                {site.contract_name}
              </Link>
            )}
            {inactive && (
              <span className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                Inactif
              </span>
            )}
          </div>
          {site.address && (
            <div className="text-xs text-muted-foreground">{site.address}</div>
          )}
          {site.notes && (
            <div className="text-xs text-muted-foreground italic whitespace-pre-wrap">
              {site.notes}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Éditer le chantier"
          >
            <Pencil className="h-3.5 w-3.5" />
            Éditer
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={pending || deleteDisabled}
            title={deleteTitle}
            aria-label={deleteTitle}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Supprimer
          </button>
        </div>
      </div>

      {/* Cluster B — Infos pratiques (séparé visuellement par fond + bordure top) */}
      {hasFields && (
        <div className="border-t bg-slate-50/60 px-4 py-2">
          <SiteFieldsDisplay site={site} />
        </div>
      )}

      {/* Cluster C — Métadonnée : ce que le chantier contient (modèle actuel). */}
      {metaParts.length > 0 && (
        <div className="border-t px-4 py-2 text-[11px] text-muted-foreground tabular-nums flex items-center gap-3 flex-wrap">
          {metaParts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden>·</span>}
              {part}
            </Fragment>
          ))}
        </div>
      )}
    </li>
  )
}
