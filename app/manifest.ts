import type { MetadataRoute } from 'next'

/**
 * MemorIA apparaît dans le menu « Partager » d'Android.
 *
 * C'est la fin de la chasse aux fichiers : Guillaume ne va plus chercher où
 * Android a rangé les photos de WhatsApp. Il partage, il choisit le chantier,
 * c'est importé.
 *
 *     WhatsApp → Partager → MemorIA → chantier → importé
 *
 * `MetadataRoute.Manifest` ne connaît pas `share_target` (la clé est valide
 * dans le manifeste, pas dans le type de Next) — d'où ce type local.
 */
interface ShareTarget {
  action: string
  method: 'POST'
  enctype: 'multipart/form-data'
  params: {
    title?: string
    text?: string
    url?: string
    files: Array<{ name: string; accept: string[] }>
  }
}

const SHARE_TARGET: ShareTarget = {
  action: '/api/partage',
  method: 'POST',
  enctype: 'multipart/form-data',
  params: {
    title: 'title',
    text: 'text',
    url: 'url',
    files: [
      {
        name: 'files',
        // Photos, VOCAUX (un vocal WhatsApp pèse quelques dizaines de Ko) et PDF.
        // La vidéo reste dehors : elle dépasserait la taille qu'une requête de
        // partage peut porter — elle garde ses chemins d'upload dédiés.
        accept: ['image/*', 'audio/*', 'application/pdf'],
      },
    ],
  },
}

export default function manifest(): MetadataRoute.Manifest {
  return {
    ...({ share_target: SHARE_TARGET } as Record<string, unknown>),
    name: 'MemorIA',
    short_name: 'MemorIA',
    description: 'Mémoire opérationnelle de vos chantiers',
    // Racine : laisse `/` router selon rôle + home_preference + appareil
    // (un manager « dashboard » ne doit pas être forcé sur /m à chaque ouverture).
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    orientation: 'portrait-primary',
    lang: 'fr',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // Icône « maskable » : remplit tout le cadre (pas de logo minuscule perdu
      // dans du blanc) sur Android/iOS, tout en respectant la zone de sécurité.
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Mes chantiers',
        url: '/m',
        description: 'Interventions du jour',
      },
    ],
  }
}
