/** Compact shared treatment for aggregate totals and distinct user counts at phone widths. */
import Card from '@mui/joy/Card'
import Table from '@mui/joy/Table'
import Typography from '@mui/joy/Typography'
import type { AdminMetric } from '@persistent/shared'
import { SectionHeading } from '../../components/SectionHeading.js'

export function MetricTable({ title, subtitle, metrics, labels }: {
  title: string
  subtitle: string
  metrics: AdminMetric[]
  labels: Record<string, string>
}) {
  return (
    <Card variant="outlined">
      <SectionHeading title={title} subtitle={subtitle} />
      {metrics.length === 0 ? <Typography level="body-sm">No data yet.</Typography> : (
        <Table size="sm" aria-label={title} sx={{ '& th:first-of-type': { width: '60%' }, '& td, & th': { whiteSpace: 'normal', overflowWrap: 'anywhere' } }}>
          <thead><tr><th scope="col">Metric</th><th scope="col">Total</th><th scope="col">Users</th></tr></thead>
          <tbody>{metrics.map((metric) => (
            <tr key={metric.key}>
              <th scope="row">{labels[metric.key] ?? metric.key}</th>
              <td>{metric.count.toLocaleString('en-CA')}</td>
              <td>{metric.users.toLocaleString('en-CA')}</td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </Card>
  )
}
