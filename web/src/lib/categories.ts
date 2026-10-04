import { $gettext } from './gettext'

// The category ids of the catalog entry schema, as the marketplace names them.
export function categoryLabel(id: string): string {
  switch (id) {
    case 'certificates': return $gettext('Certificates')
    case 'dns': return $gettext('DNS')
    case 'security': return $gettext('Security')
    case 'traffic': return $gettext('Traffic')
    case 'monitoring': return $gettext('Monitoring')
    case 'logs': return $gettext('Logs')
    case 'analytics': return $gettext('Analytics')
    case 'notifications': return $gettext('Notifications')
    case 'backup': return $gettext('Backup')
    case 'ai': return $gettext('AI')
    case 'templates': return $gettext('Templates')
    case 'languages': return $gettext('Languages')
    case 'integrations': return $gettext('Integrations')
    case 'tools': return $gettext('Tools')
    default: return id
  }
}

export function categoryIcon(id: string): string {
  switch (id) {
    case 'certificates': return 'i-tabler-certificate'
    case 'dns': return 'i-tabler-world-www'
    case 'security': return 'i-tabler-shield-lock'
    case 'traffic': return 'i-tabler-arrows-exchange'
    case 'monitoring': return 'i-tabler-heartbeat'
    case 'logs': return 'i-tabler-file-text'
    case 'analytics': return 'i-tabler-chart-bar'
    case 'notifications': return 'i-tabler-bell'
    case 'backup': return 'i-tabler-database-export'
    case 'ai': return 'i-tabler-robot'
    case 'templates': return 'i-tabler-template'
    case 'languages': return 'i-tabler-language'
    case 'integrations': return 'i-tabler-plug-connected'
    case 'tools': return 'i-tabler-tool'
    default: return 'i-tabler-tag'
  }
}
