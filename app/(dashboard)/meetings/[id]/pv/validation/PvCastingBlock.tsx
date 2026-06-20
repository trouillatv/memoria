'use client'

// CASTING DU CHANTIER (mig 137) — qui est qui : rôle → entreprise → contact.
// Donnée SITE (réutilisée par tous les CR du chantier), saisie ici depuis la revue.
// Une fois rempli, la colonne ACTION affiche « ETV · BatiSud » et les relances
// pourront viser le vrai contact. Registres entreprises/contacts peuplés au passage.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, User, Phone, Plus, X, Loader2 } from 'lucide-react'
import { addSiteIntervenantAction, deleteSiteIntervenantAction } from '../../pv-actions'
import type { SiteIntervenant } from '@/lib/db/site-intervenants'

const ROLES = ['ETV', 'MOA', 'MOE', 'BET', 'OPC', 'SPS', 'FSH', 'CLUB']

function Row({ reportId, it }: { reportId: string; it: SiteIntervenant }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function remove() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await deleteSiteIntervenantAction(reportId, it.id)
        if (r.ok) router.refresh(); else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }
  const tel = it.contactPhone || it.contactMobile
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{it.role}</span>
      <span className="inline-flex items-center gap-1 font-medium"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{it.companyShort || it.companyName}</span>
      {it.contactName && <span className="inline-flex items-center gap-1 text-muted-foreground"><User className="h-3 w-3" />{it.contactName}</span>}
      {tel && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Phone className="h-3 w-3" />{tel}</span>}
      <button type="button" disabled={pending} title="Retirer du casting" onClick={remove}
        className="ml-auto shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </li>
  )
}

function AddIntervenant({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [role, setRole] = useState('')
  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await addSiteIntervenantAction(reportId, {
          role, companyName: company, contactName: contact, contactPhone: phone, contactEmail: email,
        })
        if (r.ok) { setRole(''); setCompany(''); setContact(''); setPhone(''); setEmail(''); router.refresh() }
        else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input list="casting-roles" value={role} onChange={(e) => setRole(e.target.value.toUpperCase())} placeholder="Rôle (ETV…)"
          className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <datalist id="casting-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Entreprise (ex. « BatiSud »)"
          className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact (optionnel)"
          className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone"
          className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
          className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="button" disabled={pending || !role.trim() || !company.trim()} onClick={add}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Intervenant
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}

export function PvCastingBlock({ reportId, intervenants }: { reportId: string; intervenants: SiteIntervenant[] }) {
  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" /> Casting du chantier ({intervenants.length})
      </h2>
      <p className="text-[11px] text-muted-foreground">Qui est qui sur ce chantier — alimente la colonne ACTION (« ETV · BatiSud ») et les relances.</p>
      {intervenants.length > 0 && (
        <ul className="space-y-1">{intervenants.map((it) => <Row key={it.id} reportId={reportId} it={it} />)}</ul>
      )}
      <AddIntervenant reportId={reportId} />
    </section>
  )
}
