// Helper PUR (client-safe) : sépare un titre de planning de sa date affichée
// SANS jamais toucher au libellé stocké en base. Le titre extrait (ex.
// « Réception définitive de 28 septembre 2027 ») contient parfois déjà la
// date en toutes lettres — l'afficher une seconde fois à côté est redondant,
// mais retirer ce texte suppose une certitude : on ne retire QUE si le titre
// se termine exactement par le connecteur + la date formatée telle qu'on
// s'apprête à l'afficher. Sinon on garde le titre intact et on accepte la
// redondance plutôt qu'un nettoyage lexical hasardeux.

const dayFullYearFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })

export function formatDatedTitleDate(iso: string): string {
  return dayFullYearFmt.format(new Date(iso + 'T00:00:00Z'))
}

const TRAILING_DATE_CONNECTORS = ['le', 'du', 'de'] as const

export function splitDatedTitle(title: string, iso: string): { title: string; date: string } {
  const date = formatDatedTitleDate(iso)
  for (const connector of TRAILING_DATE_CONNECTORS) {
    const suffix = ` ${connector} ${date}`
    if (title.endsWith(suffix)) {
      return { title: title.slice(0, -suffix.length), date }
    }
  }
  return { title, date }
}
