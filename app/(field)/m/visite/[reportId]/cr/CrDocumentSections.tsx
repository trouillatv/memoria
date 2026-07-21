'use client'

// LE CR QUE L'ON CORRIGE (Étape A).
//
// Guillaume : « MemorIA propose → je corrige → je valide. » Cet écran fait le
// deuxième temps, et lui seul. Les sept sections du compte-rendu deviennent
// éditables, une par une, tant que le document est un BROUILLON.
//
// Ce qu'il ne fait pas, volontairement :
//   - il ne crée ni ne modifie AUCUN objet du chantier (une action corrigée ici
//     reste du texte : le document raconte, les objets vivent ailleurs) ;
//   - il ne valide pas encore (Étape B) ;
//   - il ne touche pas au PDF, qui continue de sortir par l'ancien chemin.
//
// « Revenir à la proposition » n'apparaît QUE si MemorIA a réellement proposé
// quelque chose pour cette section, et seulement si le texte a bougé depuis.
// Un bouton qui ne restaurerait rien — ou qui ramènerait au vide — mentirait.

import { useState, useTransition } from 'react'
import { Pencil, RotateCcw, Check, X, Loader2, Lock } from 'lucide-react'
import type { ReportDocumentSection, ReportDocumentStatus } from '@/types/db'
import { saveCrSectionAction, restoreCrSectionAction } from './cr-document-actions'

export function CrDocumentSections({
  reportId,
  sections,
  status,
}: {
  reportId: string
  sections: ReportDocumentSection[]
  status: ReportDocumentStatus
}) {
  const editable = status === 'draft'

  return (
    <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Le compte-rendu</h2>
        {editable ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Brouillon — non validé
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden />
            {status === 'exported' ? 'Exporté' : 'Validé'}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {editable
          ? 'MemorIA a proposé ce texte. Corrigez ce qui doit l’être — vos corrections sont conservées.'
          : 'Ce compte-rendu est figé : il ne se modifie plus.'}
      </p>

      <div className="mt-3 space-y-2.5">
        {sections.map((section) => (
          <SectionRow key={section.key} reportId={reportId} section={section} editable={editable} />
        ))}
      </div>
    </section>
  )
}

function SectionRow({
  reportId,
  section,
  editable,
}: {
  reportId: string
  section: ReportDocumentSection
  editable: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.content)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // La restauration n'a de sens que si MemorIA a proposé un texte ET que ce
  // texte a été modifié depuis. Sinon : pas de bouton, pas de promesse creuse.
  const canRestore =
    editable && section.ai_content !== undefined && section.ai_content !== section.content

  const save = () => {
    setError(null)
    start(async () => {
      const res = await saveCrSectionAction(reportId, section.key, draft)
      if (res.ok) setEditing(false)
      else setError(res.error)
    })
  }

  const restore = () => {
    setError(null)
    start(async () => {
      const res = await restoreCrSectionAction(reportId, section.key)
      if (res.ok) {
        setDraft(section.ai_content ?? '')
        setEditing(false)
      } else setError(res.error)
    })
  }

  return (
    <div data-section={section.key} className="rounded-xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{section.title}</h3>
        {editable && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => { setDraft(section.content); setEditing(true) }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Modifier
            </button>
            {canRestore && (
              <button
                type="button"
                onClick={restore}
                disabled={pending}
                title="Restaurer le texte proposé par MemorIA pour cette section"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Proposition
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            aria-label={`Modifier « ${section.title} »`}
            className="w-full rounded-lg border bg-background p-2 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => { setDraft(section.content); setEditing(false); setError(null) }}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Annuler
            </button>
          </div>
        </div>
      ) : section.content ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {section.content}
        </p>
      ) : (
        // Le vide se dit, il ne s'invente pas : MemorIA n'a rien relevé ici.
        <p className="mt-1.5 text-[12px] italic text-muted-foreground">Rien à ce sujet.</p>
      )}

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  )
}
