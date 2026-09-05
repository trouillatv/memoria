'use client'

// P3-mobile Phase 2 — barre d'actions du chantier.
//
// La fiche mobile empilait quatre gros CTA pleine largeur (Préparer visite,
// Préparer réunion, Explorer, Demander à MemorIA) puis une grille de cinq
// boutons « Ajouter… ». Beaucoup de hauteur, aucune hiérarchie : tout criait
// aussi fort. On regroupe en UNE barre de quatre gestes —
// « Préparer | Ajouter | Demander | ••• » — et on garde « Démarrer une visite »
// séparé, plus bas, comme seule action terrain majeure.
//
// PRÉSENTATION SEULE. Aucune fonction n'est recodée : chaque geste ouvre le
// composant existant, via le mode contrôlé ajouté en Phase 2
// (cf. components/ui/use-controllable-open). Les feuilles ne portent aucune
// vérité métier — ce sont des menus.
//
// Les panneaux pilotés sont montés HORS des feuilles : la feuille se referme au
// moment du choix, et le panneau choisi doit survivre à cette fermeture.

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Brain,
  Camera,
  ChevronRight,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  Landmark,
  ListChecks,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Sparkles,
  Truck,
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { QuickActionButton } from '@/components/actions/QuickActionButton'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import { SpontaneousCapturePanel } from './SpontaneousCapturePanel'
import { SiteReportLauncher } from './SiteReportLauncher'
import { DeliverFieldPanel } from './DeliverFieldPanel'
import { AddDocumentPanel } from './AddDocumentPanel'
import { CopilotMobileSheet } from './CopilotMobileSheet'

/** Feuille ouverte (menu). Une seule à la fois. */
type Pane = 'prepare' | 'add' | 'menu' | null
/** Outil de création ouvert, choisi depuis la feuille « Ajouter ». */
type AddTool = 'action' | 'capture' | 'report' | 'delivery' | 'document' | null
/** Brief ouvert, choisi depuis la feuille « Préparer ». */
type PrepareTool = 'visit' | 'meeting' | null

// ── Primitives de présentation ────────────────────────────────────────────────

/** Pilule de la barre. Volontairement PLUS BASSE et plus « toolbar » que les
 *  mini-KPI juste au-dessus : une seule ligne, pas d'ombre, rayon plein. Sinon
 *  la barre se lit comme une deuxième rangée de compteurs. */
function Pill({
  icon: Icon,
  label,
  ariaLabel,
  accent,
  onClick,
}: {
  icon: typeof Plus
  label?: string
  ariaLabel?: string
  accent?: 'violet'
  onClick: () => void
}) {
  const tone =
    accent === 'violet'
      ? 'border-violet-200 bg-violet-50/70 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-300'
      : 'border-border bg-muted/40 text-foreground'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full border py-1.5 text-[12px] font-medium leading-5 transition active:brightness-95 ${label ? 'px-2' : 'px-3.5'} ${tone}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label ? <span className="truncate">{label}</span> : null}
    </button>
  )
}

/** Ligne d'une feuille : icône + titre + description + chevron. Bouton (geste)
 *  ou lien (navigation) — jamais un formulaire à ce niveau.
 *
 *  Deux densités, et la différence est intentionnelle :
 *  - `card` (défaut) pour un CHOIX qui engage un geste (Préparer, Ajouter) ;
 *  - `flat` pour une simple DESTINATION (Le chantier) — lignes séparées par un
 *    filet, sans carte ni pastille, pour que 7 entrées restent un menu et non
 *    sept grosses cartes. */
function SheetRow({
  icon: Icon,
  iconClass,
  title,
  description,
  onClick,
  href,
  variant = 'card',
}: {
  icon: typeof Plus
  iconClass: string
  title: string
  description?: string
  onClick?: () => void
  href?: string
  variant?: 'card' | 'flat'
}) {
  const flat = variant === 'flat'
  const inner = (
    <>
      {flat ? (
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/60">
          <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-snug">{title}</span>
        {description ? (
          <span className="block text-[12px] leading-snug text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  )
  const cls = flat
    ? 'flex w-full items-center gap-3 px-1 py-2.5 text-left active:bg-muted/50'
    : 'flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left active:brightness-95'
  return href ? (
    <Link href={href} className={cls} onClick={onClick}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}

// Les 7 objets du chantier. NON exhaustif volontairement (Vincent 2026-09-05) :
// le « ••• » est une navigation secondaire vers les objets du chantier, pas un
// plan de site. Carte / Terrain / Explorer / Frise restent dans les onglets.
const MENU_ENTRIES: Array<{ seg: string; title: string; icon: typeof Plus; iconClass: string }> = [
  { seg: 'actions',    title: 'Actions',          icon: ListChecks,     iconClass: 'text-orange-600' },
  { seg: 'reserves',   title: 'Réserves',         icon: AlertTriangle,  iconClass: 'text-amber-600' },
  { seg: 'sujets',     title: 'Suivi des sujets', icon: Brain,          iconClass: 'text-violet-600' },
  { seg: 'photos',     title: 'Photos',           icon: ImageIcon,      iconClass: 'text-teal-600' },
  { seg: 'reunions',   title: 'Réunions',         icon: MessagesSquare, iconClass: 'text-sky-600' },
  { seg: 'documents',  title: 'Documents',        icon: FileText,       iconClass: 'text-rose-600' },
  { seg: 'patrimoine', title: 'Patrimoine',       icon: Landmark,       iconClass: 'text-slate-600' },
]

// ── Composant ─────────────────────────────────────────────────────────────────

export function SiteActionBar({
  siteId,
  siteName,
  resumeReportId,
}: {
  siteId: string
  siteName: string
  /** Reprise d'une réunion en attente (`?reprendre=`) : le compte-rendu s'ouvre
   *  d'emblée, exactement comme avant la barre. */
  resumeReportId?: string | null
}) {
  const [pane, setPane] = useState<Pane>(null)
  const [addTool, setAddTool] = useState<AddTool>(resumeReportId ? 'report' : null)
  const [prepareTool, setPrepareTool] = useState<PrepareTool>(null)
  const [askOpen, setAskOpen] = useState(false)

  /** Choisir dans une feuille = refermer la feuille et ouvrir l'outil. */
  function chooseAdd(tool: Exclude<AddTool, null>) {
    setPane(null)
    setAddTool(tool)
  }
  function choosePrepare(tool: Exclude<PrepareTool, null>) {
    setPane(null)
    setPrepareTool(tool)
  }

  const sheetContentClass = 'max-h-[85svh] overflow-y-auto rounded-t-2xl px-4 pb-6'

  return (
    <>
      {/* Le « ••• » n'a pas de libellé : lui laisser une colonne de même largeur
          volait assez de place pour tronquer « Demander » à 390 px (recette).
          Il prend donc sa largeur naturelle, les trois libellés se partagent
          le reste à parts égales. */}
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
        <Pill icon={Brain} label="Préparer" onClick={() => setPane('prepare')} />
        <Pill icon={Plus} label="Ajouter" onClick={() => setPane('add')} />
        <Pill icon={Sparkles} label="Demander" accent="violet" onClick={() => setAskOpen(true)} />
        <Pill icon={MoreHorizontal} ariaLabel="Menu du chantier" onClick={() => setPane('menu')} />
      </div>

      {/* ── Feuille « Préparer » ─────────────────────────────────────────── */}
      <Sheet open={pane === 'prepare'} onOpenChange={(v) => setPane(v ? 'prepare' : null)}>
        <SheetContent side="bottom" className={sheetContentClass}>
          <SheetHeader className="px-0 pb-1">
            <SheetTitle>Préparer</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-2">
            <SheetRow
              icon={Brain}
              iconClass="text-violet-600"
              title="Préparer ma visite"
              description="Ce qu'il faut savoir avant d'y aller"
              onClick={() => choosePrepare('visit')}
            />
            <SheetRow
              icon={MessagesSquare}
              iconClass="text-sky-600"
              title="Préparer ma réunion"
              description="Ce qu'il faut aborder en réunion"
              onClick={() => choosePrepare('meeting')}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Feuille « Ajouter au chantier » ──────────────────────────────── */}
      <Sheet open={pane === 'add'} onOpenChange={(v) => setPane(v ? 'add' : null)}>
        <SheetContent side="bottom" className={sheetContentClass}>
          <SheetHeader className="px-0 pb-1">
            <SheetTitle>Ajouter au chantier</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-2">
            <SheetRow
              icon={Plus}
              iconClass="text-emerald-600"
              title="Action"
              description="Une chose à faire, avec ou sans échéance"
              onClick={() => chooseAdd('action')}
            />
            <SheetRow
              icon={Camera}
              iconClass="text-violet-600"
              title="Note / photo"
              description="Déposer une trace sur ce chantier"
              onClick={() => chooseAdd('capture')}
            />
            <SheetRow
              icon={ClipboardList}
              iconClass="text-sky-600"
              title="Compte-rendu"
              description="Consigner une réunion de chantier"
              onClick={() => chooseAdd('report')}
            />
            <SheetRow
              icon={Truck}
              iconClass="text-amber-600"
              title="Livraison / évacuation"
              description="Ce qui arrive ou ce qui part, avec le bon"
              onClick={() => chooseAdd('delivery')}
            />
            <SheetRow
              icon={FileText}
              iconClass="text-rose-600"
              title="Document PDF"
              description="Plan, devis, attestation reçus sur place"
              onClick={() => chooseAdd('document')}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Feuille « Menu du chantier » ─────────────────────────────────── */}
      <Sheet open={pane === 'menu'} onOpenChange={(v) => setPane(v ? 'menu' : null)}>
        <SheetContent side="bottom" className={sheetContentClass}>
          <SheetHeader className="px-0 pb-1">
            <SheetTitle>Le chantier</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col divide-y">
            {MENU_ENTRIES.map((e) => (
              <SheetRow
                key={e.seg}
                variant="flat"
                icon={e.icon}
                iconClass={e.iconClass}
                title={e.title}
                href={`/m/site/${siteId}/${e.seg}`}
                onClick={() => setPane(null)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Panneaux pilotés ─────────────────────────────────────────────── */}
      {/* Ceux qui portent DÉJÀ leur propre surface plein écran : on ne fait que
          masquer leur déclencheur et leur passer l'ouverture. */}
      <SiteBriefButton
        siteId={siteId}
        variant="mobile"
        mode="visit"
        hideTrigger
        open={prepareTool === 'visit'}
        onOpenChange={(v) => setPrepareTool(v ? 'visit' : null)}
      />
      <SiteBriefButton
        siteId={siteId}
        variant="mobile"
        mode="meeting"
        hideTrigger
        open={prepareTool === 'meeting'}
        onOpenChange={(v) => setPrepareTool(v ? 'meeting' : null)}
      />
      <QuickActionButton
        source="mobile_site"
        siteId={siteId}
        variant="mobile"
        hideTrigger
        open={addTool === 'action'}
        onOpenChange={(v) => setAddTool(v ? 'action' : null)}
      />
      <SpontaneousCapturePanel
        siteId={siteId}
        siteName={siteName}
        hideTrigger
        open={addTool === 'capture'}
        onOpenChange={(v) => setAddTool(v ? 'capture' : null)}
      />
      <SiteReportLauncher
        siteId={siteId}
        siteName={siteName}
        variant="mobile"
        label="Compte-rendu"
        resumeReportId={resumeReportId}
        hideTrigger
        open={addTool === 'report'}
        onOpenChange={(v) => setAddTool(v ? 'report' : null)}
      />
      <CopilotMobileSheet siteId={siteId} siteName={siteName} hideTrigger open={askOpen} onOpenChange={setAskOpen} />

      {/* Ces deux-là rendent un FORMULAIRE en place (ils n'ont jamais eu de
          surface propre) : c'est le parent qui leur en donne une. Leur en-tête
          porte déjà un « fermer » — on n'en ajoute pas un second. */}
      <Sheet open={addTool === 'delivery'} onOpenChange={(v) => setAddTool(v ? 'delivery' : null)}>
        <SheetContent side="bottom" showCloseButton={false} className={sheetContentClass}>
          <div className="pt-4">
            <DeliverFieldPanel siteId={siteId} hideTrigger open onOpenChange={(v) => setAddTool(v ? 'delivery' : null)} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={addTool === 'document'} onOpenChange={(v) => setAddTool(v ? 'document' : null)}>
        <SheetContent side="bottom" showCloseButton={false} className={sheetContentClass}>
          <div className="pt-4">
            <AddDocumentPanel siteId={siteId} hideTrigger open onOpenChange={(v) => setAddTool(v ? 'document' : null)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
