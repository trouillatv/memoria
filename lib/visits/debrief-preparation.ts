type VisitPreparationInput = {
  photos: number
  videos: number
  vocals: number
  notes: number
}

export type VisitSourceItem = {
  label: string
}

export function buildVisitPreparationCopy(input: VisitPreparationInput) {
  const mediaCount = input.photos + input.videos
  const hasVocal = input.vocals > 0
  const hasNotes = input.notes > 0

  if (!mediaCount && !hasVocal && !hasNotes) {
    return {
      title: 'Rien a preparer pour le moment',
      body: 'Aucune capture exploitable n a ete enregistree pour cette visite.',
    }
  }

  if (!hasVocal && !hasNotes) {
    return {
      title: 'Captures classees',
      body: 'MemorIA peut conserver les medias de la visite, mais il manque un commentaire pour preparer un compte rendu detaille.',
    }
  }

  if (hasVocal && mediaCount > 0) {
    return {
      title: 'Compte rendu pret a creer',
      body: 'Les photos et videos peuvent etre rapprochees de votre commentaire vocal pour preparer une premiere version.',
    }
  }

  if (hasVocal) {
    return {
      title: 'Commentaire vocal utilisable',
      body: 'MemorIA peut preparer une premiere synthese a partir de votre commentaire.',
    }
  }

  return {
    title: 'Notes utilisables',
    body: 'MemorIA peut preparer une premiere version a partir des notes saisies pendant la visite.',
  }
}

export function buildVisitSourceItems(input: VisitPreparationInput) {
  const used: VisitSourceItem[] = []
  const missing: VisitSourceItem[] = []

  if (input.photos > 0) used.push({ label: `${input.photos} photo${input.photos > 1 ? 's' : ''}` })
  else missing.push({ label: 'aucune photo' })

  if (input.videos > 0) used.push({ label: `${input.videos} video${input.videos > 1 ? 's' : ''}` })
  else missing.push({ label: 'aucune video' })

  if (input.vocals > 0) used.push({ label: input.vocals > 1 ? `${input.vocals} vocaux` : 'commentaire vocal' })
  else missing.push({ label: 'aucun commentaire vocal' })

  if (input.notes > 0) used.push({ label: `${input.notes} note${input.notes > 1 ? 's' : ''}` })
  else missing.push({ label: 'aucune note' })

  used.push({ label: 'date de visite' }, { label: 'chantier' })

  return { used, missing }
}

export function estimatePreparationQuality(input: VisitPreparationInput) {
  let score = 1
  if (input.vocals > 0) score += 2
  if (input.notes > 0) score += 1
  if (input.photos + input.videos > 0) score += 1
  if (input.photos + input.videos >= 8) score += 1
  return Math.min(5, score)
}

export function describePreparationConfidence(level: number) {
  if (level >= 5) {
    return {
      label: 'Confiance elevee',
      body: 'Les sources disponibles devraient permettre une premiere version riche.',
    }
  }
  if (level >= 4) {
    return {
      label: 'Bonne base de travail',
      body: 'La premiere version devrait etre utile, avec une relecture attentive.',
    }
  }
  if (level >= 2) {
    return {
      label: 'Base limitee',
      body: 'MemorIA peut aider, mais il faudra probablement completer certains passages.',
    }
  }
  return {
    label: 'Peu de matiere',
    body: 'Il manque des commentaires ou des notes pour preparer un compte rendu detaille.',
  }
}
