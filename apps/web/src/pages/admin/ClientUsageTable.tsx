/** Recent session groups describe adoption, not device or installation counts. */
import Card from '@mui/joy/Card'
import Table from '@mui/joy/Table'
import Typography from '@mui/joy/Typography'
import type { AdminStats } from '@persistent/shared'
import { SectionHeading } from '../../components/SectionHeading.js'

const appLabels = { browser: 'Web browser', pwa: 'Installed PWA', android: 'Android app', windows: 'Windows app' }
const platformLabels = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', unknown: 'Unknown OS' }

export function ClientUsageTable({ clients }: { clients: AdminStats['clients'] }) {
  return (
    <Card variant="outlined">
      <SectionHeading title="Apps and platforms" subtitle="Sessions active within 30 days. Users may appear in multiple groups." />
      <Typography level="body-sm">
        Clients report their app, platform and web version on opening or returning to the app.
        Older sessions remain unknown until they report. These are session counts, not device counts.
        Browser OS detection is approximate; iPads may identify as macOS.
      </Typography>
      {clients.length === 0 ? <Typography level="body-sm">No recent sessions.</Typography> : (
        <Table size="sm" aria-label="Apps and platforms" sx={{ '& th:first-of-type': { width: '52%' }, '& th:nth-of-type(2)': { width: '20%' }, '& td, & th': { whiteSpace: 'normal', overflowWrap: 'anywhere' } }}>
          <thead><tr><th scope="col">App / platform / version</th><th scope="col">Users</th><th scope="col">Sessions</th></tr></thead>
          <tbody>{clients.map((client) => (
            <tr key={JSON.stringify([client.app, client.platform, client.webVersion, client.nativeVersion])}>
              <th scope="row">
                {client.app ? appLabels[client.app] : 'Unknown app'} / {client.platform ? platformLabels[client.platform] : 'Unknown OS'}
                <Typography level="body-xs">Web: {client.webVersion ?? 'Not reported'}</Typography>
                {(client.app === 'android' || client.app === 'windows') && (
                  <Typography level="body-xs">Native: {client.nativeVersion ?? 'Not reported'}</Typography>
                )}
              </th>
              <td>{client.users.toLocaleString('en-CA')}</td><td>{client.sessions.toLocaleString('en-CA')}</td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </Card>
  )
}
