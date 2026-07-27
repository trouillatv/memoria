'use client'

// AJOUTER UN INTERVENANT depuis la surface Acteurs (parcours transversal).
//
// Guillaume crée une personne métier SANS ouvrir d'équipe précise :
//   1. il cherche d'abord un doublon (réutiliser, jamais recréer) ;
//   2. sinon il crée la personne (nom, métier, type, entreprise/e-mail/tel facultatifs) ;
//   3. il la rattache éventuellement à une ou plusieurs équipes ;
//   4. il arrive directement sur la fiche créée.
// Aucun compte Auth, aucun rôle applicatif.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Search, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { FieldPersonSearchResult } from '@/lib/db/team-field-members'
import { searchOrgFieldPersonsAction } from '../equipes/actions'
import { createIntervenantAction } from './create-actions'

// Rôle / fonction DURABLE de la personne (company_contacts.function), réutilisé
// partout ensuite (casting, mémoire, CR, préparation de visite). Suggestions
// libres — la saisie reste ouverte. ⚠ distinct du rôle de casting (contexte de
// chantier, jamais une propriété permanente de la personne).
const ROLE_SUGGESTIONS = [
  'Conducteur de travaux', 'Chef de chantier', 'Chef d’équipe', 'Maître d’œuvre (MOE)',
  'Maître d’ouvrage (MOA)', 'Coordinateur SPS', 'Architecte', 'Bureau d’études',
  'Économiste', 'Électricien', 'Plombier', 'Maçon', 'Peintre', 'Menuisier',
]

export function AddIntervenantDialog({ teams }: { teams: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Anti-doublon.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FieldPersonSearchResult[] | null>(null)

  // Création.
  const [fullName, setFullName] = useState('')
  const [job, setJob] = useState('')
  const [isInternalAgent, setIsInternalAgent] = useState(true)
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [teamIds, setTeamIds] = useState<string[]>([])

  function reset() {
    setQuery(''); setResults(null)
    setFullName(''); setJob(''); setIsInternalAgent(true); setCompanyName(''); setEmail(''); setPhone(''); setTeamIds([])
  }

  function runSearch() {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    startTransition(async () => {
      const r = await searchOrgFieldPersonsAction({ query: q })
      if (!r.ok) { toast.error(r.error ?? 'Recherche impossible'); return }
      setResults(r.results ?? [])
    })
  }

  function toggleTeam(id: string) {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  function reuse(contactId: string) {
    setOpen(false); reset()
    router.push(`/intervenants/personne/${contactId}`)
  }

  function create() {
    if (fullName.trim().length < 1) { toast.error('Le nom est requis'); return }
    startTransition(async () => {
      const r = await createIntervenantAction({
        fullName: fullName.trim(),
        job: job.trim() || undefined,
        companyName: companyName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        isInternalAgent,
        teamIds: teamIds.length ? teamIds : undefined,
      })
      if (!r.ok || !r.contactId) { toast.error(r.error ?? 'Création impossible'); return }
      if (r.teamsFailed && r.teamsFailed > 0) {
        toast.warning(`Personne créée, mais ${r.teamsFailed} rattachement${r.teamsFailed > 1 ? 's' : ''} d’équipe a échoué.`)
      } else {
        toast.success(`${fullName.trim()} créé·e`)
      }
      const id = r.contactId
      setOpen(false); reset()
      router.push(`/intervenants/personne/${id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <DialogTrigger render={<Button size="sm"><UserPlus /> Ajouter un acteur</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un acteur</DialogTitle>
          <DialogDescription>
            Une personne métier sans compte de connexion. Cherchez d’abord si elle existe,
            sinon créez-la puis rattachez-la éventuellement à une ou plusieurs équipes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 1 — Réutiliser un existant */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Chercher une personne déjà connue</Label>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } }}
                placeholder="Nom…"
                disabled={pending}
              />
              <Button type="button" variant="outline" onClick={runSearch} disabled={pending || query.trim().length < 2}>
                <Search /> Chercher
              </Button>
            </div>
            {results !== null && (
              results.length === 0 ? (
                <p className="text-[13px] text-muted-foreground italic">Aucune personne connue à ce nom — créez-la ci-dessous.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {results.map((p) => (
                    <li key={p.contactId} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {p.fullName}{p.job && <span className="font-normal text-muted-foreground"> — {p.job}</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.email, p.phone].filter(Boolean).join(' · ') || (p.isInternalAgent ? 'Agent interne' : 'Contact')}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => reuse(p.contactId)} disabled={pending}>
                        <Check /> Réutiliser
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          {/* 2 — Créer */}
          <div className="space-y-2.5 border-t pt-4">
            <Label className="text-xs text-muted-foreground">Ou créer un nouvel acteur</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nom complet (obligatoire)" disabled={pending} />

            {/* Type — agent interne / contact externe. */}
            <div className="flex gap-2">
              <TypeToggle active={isInternalAgent} onClick={() => setIsInternalAgent(true)} label="Agent interne" disabled={pending} />
              <TypeToggle active={!isInternalAgent} onClick={() => setIsInternalAgent(false)} label="Contact externe" disabled={pending} />
            </div>

            {/* Rôle / fonction — champ de premier plan : réutilisé partout ensuite. */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Rôle / fonction</Label>
              <Input
                value={job}
                onChange={(e) => setJob(e.target.value)}
                placeholder="ex. Conducteur de travaux, MOE, Électricien…"
                list="acteur-role-suggestions"
                disabled={pending}
              />
              <datalist id="acteur-role-suggestions">
                {ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Entreprise (facultatif)" disabled={pending} />
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone (facultatif)" disabled={pending} />
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (facultatif)" disabled={pending} className="col-span-2" />
            </div>

            {/* Rattachement facultatif à des équipes. */}
            {teams.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Ajouter à une ou plusieurs équipes (facultatif)</Label>
                <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
                  {teams.map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                      <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} disabled={pending} className="accent-brand-600" />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Aucun compte ni e-mail d’invitation n’est créé. La personne pourra être citée et
              rendue responsable d’une action quand son équipe est mobilisée sur le chantier.
            </p>
            <Button type="button" onClick={create} disabled={pending || fullName.trim().length < 1} className="w-full">
              <UserPlus /> Créer l’acteur
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TypeToggle({ active, onClick, label, disabled }: { active: boolean; onClick: () => void; label: string; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-brand-300 bg-brand-50/60 text-brand-800 dark:border-brand-700/60 dark:bg-brand-600/10 dark:text-brand-200'
          : 'border-border/60 text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}
