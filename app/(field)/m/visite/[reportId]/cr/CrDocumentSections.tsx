'use client'

// LE CR QUE L'ON CORRIGE (Étape A).
//
// Guillaume : « MemorIA propose → je corrige → je valide. » Cet écran fait le
// deuxième temps, et lui seul. Les sept sections du compte-rendu deviennent
// éditables, une par une, tant que le document est un BROUILLON.
//
// L'ÉDITION NE RECONSTRUIT PLUS LA PAGE (Vincent, 2026-07-21). Enregistrer
// passait par `revalidatePath` : la page entière se refabriquait et le
// conducteur repartait en haut — sur mobile, corriger la sixième section
// devenait pénible, et le bloc semblait avoir disparu. Désormais les deux
// gestes rendent le document PERSISTÉ, et l'écran adopte cette réponse
// localement. Rien d'autre ne bouge : ni la position, ni les autres sections,
// ni l'analyse (qui n'est plus montée en auto ici).
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

import { useState } from 'react'
import { Pencil, RotateCcw, Check, X, Loader2, Lock } from 'lucide-react'
import type { ReportDocumentSection, ReportDocumentStatus } from '@/types/db'
import { saveCrSectionAction, restoreCrSectionAction, type PersistedCrDocument } from './cr-document-actions'

export function CrDocumentSections({
  reportId,
  sections: initialSections,
  status: initialStatus,
}: {
  reportId: string
  sections: ReportDocumentSection[]
  status: ReportDocumentStatus
}) {
  // La vérité affichée vient du serveur, puis de CE QU'IL A ÉCRIT à chaque
  // geste. Pas de rafraîchissement global, donc pas de saut en haut de page.
  const [sections, setSections] = useState(initialSections)
  const [status, setStatus] = useState(initialStatus)
  const editable = status === 'draft'

  const adopt = (doc: PersistedCrDocument) => {
    setSections(doc.sections)
    setStatus(doc.status)
  }

  /** LE TEXTE S'AFFICHE AVANT LE RÉSEAU (Vincent, 2026-07-21). Attendre deux
   *  secondes avant de voir sa propre correction donne l'impression d'un écran
   *  figé. On applique localement tout de suite ; le serveur confirme ensuite,
   *  et sa réponse fait autorité (ou rend la main en cas d'échec). */
  const applyLocal = (key: string, content: string) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)))
  }

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
          <SectionRow
            key={section.key}
            reportId={reportId}
            section={section}
            editable={editable}
            onPersisted={adopt}
            onApplyLocal={applyLocal}
          />
        ))}
      </div>
    </section>
  )
}

function SectionRow({
  reportId,
  section,
  editable,
  onPersisted,
  onApplyLocal,
}: {
  reportId: string
  section: ReportDocumentSection
  editable: boolean
  onPersisted: (doc: PersistedCrDocument) => void
  onApplyLocal: (key: string, content: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.content)
  const [error, setError] = useState<string | null>(null)
  // Le pending est PAR SECTION : corriger le résumé ne gèle pas les six autres.
  const [pending, setPending] = useState(false)
  // « Enregistré » — la confirmation discrète que le serveur a bien pris.
  const [justSaved, setJustSaved] = useState(false)

  // La restauration n'a de sens que si MemorIA a proposé un texte ET que ce
  // texte a été modifié depuis. Sinon : pas de bouton, pas de promesse creuse.
  const canRestore =
    editable && section.ai_content !== undefined && section.ai_content !== section.content

  const save = async () => {
    if (pending) return // anti double-clic : jamais deux écritures concurrentes
    const previous = section.content
    // 1. L'écran obéit TOUT DE SUITE : le texte corrigé s'affiche, la section
    //    se referme, et l'attente réseau se dit à côté sans rien bloquer.
    setEditing(false)
    setJustSaved(false)
    onApplyLocal(section.key, draft)
    setPending(true)
    setError(null)
    // 2. Le serveur confirme — et sa réponse fait autorité.
    const res = await saveCrSectionAction(reportId, section.key, draft)
    setPending(false)
    if (res.ok) {
      onPersisted(res.document)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    } else {
      // 3. Échec : on rend la main sans rien perdre — le texte saisi retourne
      //    dans l'éditeur ouvert, la section retrouve son état d'avant.
      onApplyLocal(section.key, previous)
      setDraft(draft)
      setEditing(true)
      setError(res.error)
    }
  }

  const restore = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    const res = await restoreCrSectionAction(reportId, section.key)
    setPending(false)
    if (res.ok) {
      setEditing(false)
      onPersisted(res.document)
    } else {
      setError(res.error)
    }
  }

  return (
    <div data-section={section.key} className="rounded-xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{section.title}</h3>
        {editable && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            {pending && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Enregistrement…
              </span>
            )}
            {!pending && justSaved && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" aria-hidden /> Enregistré
              </span>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => { setDraft(section.content); setEditing(true) }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
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
              {pending ? 'Enregistrement…' : 'Enregistrer'}
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
