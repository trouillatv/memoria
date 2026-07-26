import Link from 'next/link'
import { ScanSearch } from 'lucide-react'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getAoExperience } from '@/lib/db/ao-experience'
import { listTenderEngagementProvenance } from '@/lib/db/tender-engagement-provenance'
import { engagementSourceDisplay, summarizeEngagementSources, type EngagementSourceDisplay } from '@/lib/tenders/engagement-source-display'
import { EngagementCurationView } from '../engagement-curation-view'
import { AoExperiencePanel } from './AoExperiencePanel'
import { ExtractEngagementsButton } from './ExtractEngagementsButton'
import { ResetEngagementsButton } from './ResetEngagementsButton'
import { BackButton } from './BackButton'

export default async function TenderEngagementsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDeskUser()
  const { id } = await params
  const engagements = await listEngagementsByTender(id)
  // A3 — confronte les libellés de cet AO à l'expérience accumulée (sujets de l'org).
  // TODO M3 : prend la première org de l'utilisateur — à adapter quand getAoExperience
  // acceptera plusieurs orgs.
  const orgId = (await getOrgIdsOfUser().catch(() => [])) [0] ?? null // TODO M4-UX-multiorg : getAoExperience ne supporte pas encore plusieurs orgs
  const experience = engagements.length > 0
    ? await getAoExperience(orgId, engagements.map((e) => e.short_label)).catch(() => [])
    : []

  // Source affichée = provenance structurée persistée (presenter partagé, unique
  // source de vérité pour libellé + valeur de filtre). Jamais de déduction texte.
  const provenanceRows = engagements.length > 0 ? await listTenderEngagementProvenance(id) : []
  const sourceDisplays: Record<string, EngagementSourceDisplay> = Object.fromEntries(
    provenanceRows.map((r) => [r.engagementId, engagementSourceDisplay({
      sourceType: r.sourceType,
      tenderDocumentId: r.rawTenderDocumentId,
      documentExists: r.documentExists,
      documentFilename: r.filename,
      page: r.pageNumber,
    })]),
  )

  return (
    <div className="space-y-4 w-full">
      <BackButton />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Engagements ({engagements.length})</h1>
          <p className="text-xs text-muted-foreground">
            Engagements extraits depuis le dossier et la mémoire technique. À curer puis activer via le wizard de conversion en contrat.
          </p>
        </div>
        {engagements.length === 0 && <ExtractEngagementsButton tenderId={id} />}
        {engagements.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <ResetEngagementsButton tenderId={id} />
            <Link href={`/tenders/${id}/audit`}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
              <ScanSearch className="h-3.5 w-3.5" /> Audit documentaire
            </Link>
          </div>
        )}
      </div>

      {engagements.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border p-4">
          Aucun engagement extrait. Cliquez ci-dessus pour lancer l&apos;extraction IA.
        </p>
      ) : (
        <>
          {(() => {
            // KPI qualité de la provenance — « ⚠️ non localisé » est le SEUL vrai
            // indicateur de faiblesse (sur un dossier extrait par pièce, il doit
            // être à 0). Mémoire / manuel sont informatifs, pas des échecs.
            const q = summarizeEngagementSources(Object.values(sourceDisplays))
            return (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-[11px]">
                <span className="font-semibold text-muted-foreground uppercase tracking-widest">Provenance</span>
                <span>📘 {q.aoLocalises} rattaché{q.aoLocalises > 1 ? 's' : ''} à une pièce</span>
                {q.memoire > 0 && <span>✍️ {q.memoire} mémoire</span>}
                {q.manuel > 0 && <span>✏️ {q.manuel} manuel{q.manuel > 1 ? 's' : ''}</span>}
                {q.documentIndisponible > 0 && <span className="text-amber-700">📕 {q.documentIndisponible} document indisponible</span>}
                <span className={q.nonLocalises > 0 ? 'font-semibold text-rose-700' : 'text-emerald-700'}>
                  {q.nonLocalises > 0 ? `⚠️ ${q.nonLocalises} source${q.nonLocalises > 1 ? 's' : ''} non localisée${q.nonLocalises > 1 ? 's' : ''}` : '✓ 0 source non localisée'}
                </span>
              </div>
            )
          })()}
          <AoExperiencePanel terms={experience} />
          <EngagementCurationView engagements={engagements} sourceDisplays={sourceDisplays} />
        </>
      )}
    </div>
  )
}
