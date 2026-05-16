import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type {
  DbTenderAnalysis,
  DbTenderAnalysisConstraint,
  DbTenderAnalysisRisk,
  DbTenderAnalysisChecklistItem,
} from '@/types/db'
import { SourceList } from './SourceList'

const SEVERITY_STYLES: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
}

const SEVERITY_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
}

interface TenderAnalyseDetailleeProps {
  analysis: DbTenderAnalysis
}

export function TenderAnalyseDetaillee({ analysis }: TenderAnalyseDetailleeProps) {
  const constraints: DbTenderAnalysisConstraint[] = analysis.constraints ?? []
  const risks: DbTenderAnalysisRisk[] = analysis.risks ?? []
  const checklist: DbTenderAnalysisChecklistItem[] = analysis.checklist ?? []

  return (
    <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3">
      {/* Contraintes */}
      <Card>
        <CardHeader>
          <CardTitle>Contraintes</CardTitle>
        </CardHeader>
        <CardContent>
          {constraints.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Aucune contrainte identifiée.</p>
          ) : (
            <ul className="space-y-2">
              {constraints.map((c, i) => (
                <li key={i} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <span className="font-medium">{c.label}</span>
                      {c.detail && (
                        <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                      )}
                      {c.sources && c.sources.length > 0 && <SourceList sources={c.sources} />}
                    </div>
                    {c.required && (
                      <Badge className="text-xs bg-rose-100 text-rose-700 shrink-0">Requis</Badge>
                    )}
                  </div>
                  {c.category && (
                    <span className="text-xs text-muted-foreground">{c.category}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Risques */}
      <Card>
        <CardHeader>
          <CardTitle>Risques</CardTitle>
        </CardHeader>
        <CardContent>
          {risks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Aucun risque identifié.</p>
          ) : (
            <ul className="space-y-2">
              {risks.map((r, i) => (
                <li key={i} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start gap-2">
                    <Badge
                      className={`text-xs shrink-0 ${SEVERITY_STYLES[r.severity]}`}
                    >
                      {SEVERITY_LABELS[r.severity]}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{r.label}</span>
                      {r.detail && (
                        <p className="text-xs text-muted-foreground mt-0.5">{r.detail}</p>
                      )}
                      {r.sources && r.sources.length > 0 && <SourceList sources={r.sources} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Points de différenciation */}
      <Card>
        <CardHeader>
          <CardTitle>Points de différenciation</CardTitle>
        </CardHeader>
        <CardContent>
          {checklist.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Aucun point de différenciation identifié.</p>
          ) : (
            <ul className="space-y-2">
              {checklist.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      item.required
                        ? 'bg-emerald-500'
                        : 'bg-muted-foreground/40'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <span className={item.required ? 'font-medium' : 'text-muted-foreground'}>
                      {item.item}
                    </span>
                    {item.required && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Décisif</span>
                    )}
                    {item.sources && item.sources.length > 0 && <SourceList sources={item.sources} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
