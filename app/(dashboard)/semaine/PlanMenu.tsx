'use client'

// PL5a.1 — « Planifier », deux chemins vers les DEUX objets qui existent.
//
// Guillaume ne doit pas connaître l'architecture de MemorIA pour trouver ce
// qu'il cherche. Il peut penser « mon chantier » (fiche → Roulements) ou
// « je planifie ma semaine » (ici). Les deux mènent au MÊME éditeur de
// roulement — jamais à deux formulaires, jamais à deux sources de vérité.
//
// Le roulement N'EST PAS créé ici : on renvoie vers /sites/{id}/roulements/nouveau,
// la seule route qui existe.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, CalendarClock, Repeat, ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { siteLabel } from '@/lib/labels/site-label'
import {
  CreateInterventionDialog,
  type MissionOption,
  type SiteOption,
  type TeamOption,
} from './CreateInterventionDialog'

export function PlanMenu({
  missions,
  sites,
  teams,
  defaultDate,
  initialSiteId,
}: {
  missions: MissionOption[]
  sites: SiteOption[]
  teams: TeamOption[]
  defaultDate: string
  /** Semaine déjà filtrée sur un chantier → on le préremplit. */
  initialSiteId?: string
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  // PR 1 : arriver depuis une fiche chantier (`/semaine?site=<id>`) ouvre le
  // planificateur DIRECTEMENT, prérempli. Ce comportement est préservé — le menu
  // ne s'interpose pas quand le contexte est déjà là.
  const [interventionOpen, setInterventionOpen] = useState(Boolean(initialSiteId))
  // Choix du chantier, seulement quand le contexte ne le donne pas.
  const [pickingSite, setPickingSite] = useState(false)
  const [siteId, setSiteId] = useState(initialSiteId ?? sites[0]?.id ?? '')

  function goToRoulement() {
    if (initialSiteId) {
      setMenuOpen(false)
      router.push(`/sites/${initialSiteId}/roulements/nouveau`)
      return
    }
    setPickingSite(true)
  }

  return (
    <>
      <Dialog
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next)
          if (!next) setPickingSite(false)
        }}
      >
        <DialogTrigger
          render={
            <Button variant="default" size="sm">
              <Plus className="h-4 w-4" />
              Planifier
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Planifier</DialogTitle>
            <DialogDescription>
              {pickingSite
                ? 'Sur quel chantier ?'
                : 'Une prestation exceptionnelle, ou une organisation qui se répète.'}
            </DialogDescription>
          </DialogHeader>

          {pickingSite ? (
            <div className="space-y-3">
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {sites.length === 0 && <option value="">Aucun chantier</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {siteLabel(s.name, s.clientName)}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <Button
                  disabled={!siteId}
                  onClick={() => {
                    setMenuOpen(false)
                    router.push(`/sites/${siteId}/roulements/nouveau`)
                  }}
                >
                  Ouvrir la grille <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
                <Button variant="ghost" onClick={() => setPickingSite(false)}>
                  Retour
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setInterventionOpen(true)
                }}
                className="flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:bg-muted/40"
              >
                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Une intervention ponctuelle</span>
                  <span className="block text-xs text-muted-foreground">
                    Une prestation exceptionnelle, à une date précise.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={goToRoulement}
                className="flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:bg-muted/40"
              >
                <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Un roulement</span>
                  <span className="block text-xs text-muted-foreground">
                    Une organisation Travail / Repos, répétée sur plusieurs semaines.
                  </span>
                </span>
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Le dialogue existant, désormais piloté par le menu. Son comportement
          d'avant est intact quand on ne lui passe pas `open`. */}
      <CreateInterventionDialog
        missions={missions}
        sites={sites}
        teams={teams}
        defaultDate={defaultDate}
        initialSiteId={initialSiteId}
        open={interventionOpen}
        onOpenChange={setInterventionOpen}
      />
    </>
  )
}
