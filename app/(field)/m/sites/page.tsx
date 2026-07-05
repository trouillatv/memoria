import { redirect } from 'next/navigation'

// « Sites » a fusionné avec « Chantiers » (mêmes dossiers, une seule liste tant
// que la proximité GPS n'existe pas). On redirige pour ne pas casser les liens.
export default function FieldSitesPage() {
  redirect('/m/chantiers')
}
