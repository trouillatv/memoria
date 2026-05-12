import { listActivityLogs } from '@/lib/db/activity-logs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActivityLogTable } from './ActivityLogTable'

export default async function AdminMonitoringPage() {
  const logs = await listActivityLogs({ limit: 100 })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Activité récente. Les 100 dernières actions tracées.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Activity logs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ActivityLogTable logs={logs} />
        </CardContent>
      </Card>
    </div>
  )
}
