// P0-2B (mandat Vincent 2026-09-15) : le gate par site a été retiré des deux
// adaptateurs Live Writer (native + historique), qui s'exécutent désormais
// systématiquement. Ce module ne sert plus la production — il ne subsiste que
// pour ne pas casser des scripts ponctuels hors-session (_p6_check_flag.ts,
// _p6_import_cr011.ts, _p6_import_cr012.ts) qui importent encore cette
// fonction. Signalé à Vincent plutôt que supprimé (CLAUDE.md §14/§21).
export function isTrackedPointLiveWriterEnabledForSite(_siteId: string): boolean {
  return true
}
