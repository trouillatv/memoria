// Scindé dans la refonte admin 2026-06-15 :
//   - « Usage réel » + feed d'activité → /admin/activite
//   - « Monitoring IA » (coûts) → /admin/depenses-ia
// Les composants de ce dossier (AdoptionTab, AIHealthSection, AIMemorySection)
// restent utilisés par les nouvelles pages. La santé opérationnelle a été
// retirée de l'admin (indicateurs métier/manager).
import { redirect } from 'next/navigation'
export default function AdminMonitoringRedirect() { redirect('/admin/activite') }
