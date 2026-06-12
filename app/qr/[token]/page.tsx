// Page publique /qr/[token] — journal du chantier sans login.
// Accessible à toute personne ayant scanné le QR Code du chantier.
// Mobile-first. Audit silencieux (access_count).

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { MapPin, Users, Camera, AlertTriangle, Building2, CheckCircle2, Clock } from 'lucide-react'
import { getSiteByQrToken, recordQrAccess } from '@/lib/db/site-qr'
import { getSiteJournal, type JournalEntry, type JournalIntervention } from '@/lib/db/site-journal'

interface PageProps {
  params: Promise<{ token: string }>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FR_MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]
const FR_DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

function formatDayHeading(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const day = FR_DAYS[utc.getUTCDay()]
  return `${day} ${d} ${FR_MONTHS[m - 1]} ${y}`
}

const STATUS_LABEL: Record<string, string> = {
  validated: 'Validée',
  completed: 'Exécutée',
  in_progress: 'En cours',
  skipped: 'Sautée',
}

const STATUS_DOT: Record<string, string> = {
  validated: 'bg-green-500',
  completed: 'bg-emerald-500',
  in_progress: 'bg-amber-500',
  skipped: 'bg-muted-foreground/40',
}

// ── Carte intervention ────────────────────────────────────────────────────────

function InterventionCard({ intv }: { intv: JournalIntervention }) {
  const statusLabel = STATUS_LABEL[intv.status] ?? intv.status
  const dotClass = STATUS_DOT[intv.status] ?? 'bg-muted-foreground/40'

  return (
    <div className="border rounded-xl p-4 space-y-2.5 bg-card">
      {/* Mission + statut */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm leading-snug flex-1">{intv.missionName}</p>
        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${dotClass}`} title={statusLabel} />
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {intv.teamName && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {intv.teamName}
          </span>
        )}
        {intv.participantCount > 0 && (
          <span>{intv.participantCount} intervenant{intv.participantCount > 1 ? 's' : ''}</span>
        )}
        {intv.photoCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Camera className="h-3 w-3" />
            {intv.photoCount} photo{intv.photoCount > 1 ? 's' : ''}
          </span>
        )}
        {intv.anomaliesOpen > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
            <AlertTriangle className="h-3 w-3" />
            {intv.anomaliesOpen} anomalie{intv.anomaliesOpen > 1 ? 's' : ''}
          </span>
        )}
        {intv.anomaliesOpen === 0 && intv.anomaliesResolved > 0 && (
          <span className="inline-flex items-center gap-1 text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            résolue{intv.anomaliesResolved > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Entreprises */}
      {intv.companies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {intv.companies.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              <Building2 className="h-2.5 w-2.5 shrink-0" />
              {c.company_name}
            </span>
          ))}
        </div>
      )}

      {/* Notes */}
      {intv.notes && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic leading-relaxed">
          {intv.notes.length > 200 ? intv.notes.slice(0, 200) + '…' : intv.notes}
        </p>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function QrPublicPage({ params }: PageProps) {
  const { token } = await params

  const site = await getSiteByQrToken(token)
  if (!site) notFound()

  // Audit silencieux
  recordQrAccess(token).catch(() => {})

  const entries: JournalEntry[] = await getSiteJournal(site.id, { limit: 60 })

  const totalInterventions = entries.reduce((acc, e) => acc + e.interventions.length, 0)

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Noumea',
  })

  return (
    <div className="min-h-screen bg-background">
      {/* En-tête */}
      <div className="border-b bg-card px-4 py-5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            MemorIA
          </span>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {exportDate}
          </span>
        </div>
        <h1 className="text-xl font-semibold leading-tight">{site.name}</h1>
        {site.address && (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {site.address}
          </p>
        )}
        <p className="text-xs text-muted-foreground pt-0.5">
          Journal du chantier · {totalInterventions} intervention{totalInterventions !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Journal */}
      <div className="px-4 py-4 space-y-6 max-w-2xl mx-auto">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Aucune intervention enregistrée pour ce chantier.
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.date} className="space-y-3">
              {/* En-tête jour */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{formatDayHeading(entry.date)}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.interventions.length} intervention{entry.interventions.length > 1 ? 's' : ''}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Interventions du jour */}
              <div className="space-y-2">
                {entry.interventions.map((intv) => (
                  <InterventionCard key={intv.id} intv={intv} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Accès en lecture seule · Propulsé par{' '}
          <span className="font-semibold">MemorIA</span>
        </p>
      </div>
    </div>
  )
}
