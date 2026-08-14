'use client'

// AJOUTER UNE PERSONNE TERRAIN À UNE ÉQUIPE (Lot 1, mig 244).
//
// Deux gestes, une intention (« qui travaille sur le terrain ? ») :
//   1. RECHERCHER une personne déjà connue de l'organisation → la rattacher
//      (jamais recréer un doublon) ;
//   2. sinon CRÉER un agent interne (sans compte, entreprise optionnelle).
//
// Aucun compte, e-mail d'invitation ou rôle n'est créé : une fiche company_contacts
// (is_internal_agent = true) + une appartenance team_field_members, rien d'autre.

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
import {
  addFieldPersonToTeamAction,
  attachFieldPersonToTeamAction,
  searchOrgFieldPersonsAction,
} from '../actions'

export function AddFieldPersonDialog({ teamId, teamName }: { teamId: string; teamName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Recherche d'une personne existante (anti-doublon).
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FieldPersonSearchResult[] | null>(null)

  // Création d'un nouvel agent.
  const [fullName, setFullName] = useState('')
  const [job, setJob] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  function reset() {
    setQuery(''); setResults(null)
    setFullName(''); setJob(''); setCompanyName(''); setEmail(''); setPhone('')
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

  function attach(contactId: string, name: string) {
    startTransition(async () => {
      const r = await attachFieldPersonToTeamAction({ teamId, contactId })
      if (!r.ok) { toast.error(r.error ?? 'Rattachement impossible'); return }
      toast.success(`${name} ajouté·e à l’équipe`)
      reset(); setOpen(false); router.refresh()
    })
  }

  function create() {
    if (fullName.trim().length < 1) { toast.error('Le nom est requis'); return }
    startTransition(async () => {
      const r = await addFieldPersonToTeamAction({
        teamId,
        fullName: fullName.trim(),
        job: job.trim() || undefined,
        companyName: companyName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      })
      if (!r.ok) { toast.error(r.error ?? 'Création impossible'); return }
      toast.success(`${fullName.trim()} créé·e et ajouté·e à l’équipe`)
      reset(); setOpen(false); router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <DialogTrigger
        render={
          /* LE GESTE PRINCIPAL (arbitrage Vincent 2026-08-14) : « ajouter
             Vanessa à mon équipe » = elle fait partie de l'équipe — pas
             « créer un utilisateur avec des permissions ». Exister dans
             l'organisation ≠ avoir un compte logiciel. */
          <Button size="sm" data-testid={`add-field-person-trigger-${teamId}`}>
            <UserPlus /> Ajouter un membre
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter une personne terrain — {teamName}</DialogTitle>
          <DialogDescription>
            Un agent qui travaille sur le terrain, sans compte de connexion. Cherchez
            d’abord s’il existe déjà, sinon créez-le.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 1 — Rechercher un existant */}
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
                <p className="text-[13px] text-muted-foreground italic">
                  Aucune personne connue à ce nom — créez-la ci-dessous.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {results.map((p) => (
                    <li key={p.contactId} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {p.fullName}
                          {p.job && <span className="text-muted-foreground font-normal"> — {p.job}</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.email, p.phone].filter(Boolean).join(' · ') || (p.isInternalAgent ? 'Agent interne' : 'Contact')}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => attach(p.contactId, p.fullName)} disabled={pending}>
                        <Check /> Ajouter
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          {/* 2 — Créer un nouvel agent */}
          <div className="space-y-2 border-t pt-4">
            <Label className="text-xs text-muted-foreground">Ou créer un nouvel agent</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nom complet (obligatoire)" disabled={pending} />
            <div className="grid grid-cols-2 gap-2">
              <Input value={job} onChange={(e) => setJob(e.target.value)} placeholder="Métier (ex. maçon)" disabled={pending} />
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Entreprise (facultatif)" disabled={pending} />
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (facultatif)" disabled={pending} />
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone (facultatif)" disabled={pending} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Aucun compte ni e-mail d’invitation n’est créé. Cette personne pourra être citée
              et rendue responsable d’une action.
            </p>
            <Button type="button" onClick={create} disabled={pending || fullName.trim().length < 1} className="w-full">
              <UserPlus /> Créer et ajouter à l’équipe
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
