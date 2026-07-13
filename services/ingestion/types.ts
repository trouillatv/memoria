// Moteur d'ingestion universel — contrat d'entrée (mig 184).
//
// UNE chaîne, plusieurs portes. La visite en direct et l'import (ZIP WhatsApp,
// upload, partage OS, WhatsApp Business) aboutissent au MÊME écran de tri. On
// n'écrit pas « un import WhatsApp » : on écrit un moteur dont chaque source
// n'est qu'un ADAPTATEUR qui remplit ce contrat. Cf. docs/ingestion-engine.md.

/** Porte d'entrée. 'live' n'utilise PAS ce moteur (capture directe) — listé pour
 *  la traçabilité `site_reports.source`. Les autres passent par ingestBatch. */
export type IngestSource = 'live' | 'whatsapp_zip' | 'upload' | 'os_share' | 'whatsapp_cloud'

/** Le type MÉTIER d'un média, aligné sur VisitCaptureKind (le PDF est stocké en
 *  pièce 'file' ; on le distingue ici pour le futur traitement). */
export type IngestKind = 'photo' | 'video' | 'vocal' | 'pdf' | 'note'

/** Un élément brut à ingérer. L'adaptateur le fabrique ; le moteur s'occupe du
 *  reste (dédup, chronologie, session, upload, capture). */
export interface IngestItem {
  /** Octets du média. Absent pour une note (texte seul). */
  bytes?: Uint8Array
  filename: string
  mime: string
  kind: IngestKind
  /** L'instant RÉEL (EXIF / horodatage _chat.txt / mtime). NULL → le moteur
   *  retombe sur l'ordre de réception. C'est lui qui « remet dans l'ordre ». */
  capturedAt: string | null
  /** Note libre / ligne de chat (kind='note'), ou légende. */
  text?: string | null
  lat?: number | null
  lng?: number | null
}

export interface IngestContext {
  siteId: string
  createdBy: string | null
  source: IngestSource
  /**
   * La visite CIBLE, quand l'utilisateur en a choisi une.
   *
   * Sans elle, le moteur DÉCOUPE le lot en sessions et crée les visites. Avec
   * elle, tout le lot rejoint CETTE visite — additivement : le contenu déjà
   * présent n'est jamais remplacé, et un fichier déjà ingéré est sauté
   * (idempotence par contenu, cf. `contentUuid`).
   */
  reportId?: string | null
}

export interface IngestSession {
  reportId: string
  startedAt: string
  captureCount: number
}

export interface IngestResult {
  sessions: IngestSession[]
  /** Captures RÉELLEMENT créées (hors doublons). */
  created: number
  /** Éléments ignorés car déjà ingérés (ré-import idempotent). */
  skippedDuplicates: number
}
