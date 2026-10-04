import type { Check } from '@/api/submit'
import { $gettext } from './gettext'

export function checkTitle(check: Check): string {
  switch (check.key) {
    case 'repository': return $gettext('Repository')
    case 'claim': return $gettext('Permission to submit')
    case 'release': return $gettext('Release')
    case 'manifest': return $gettext('plugin.json')
    case 'plugin_id': return $gettext('Plugin ID')
    case 'name': return $gettext('Name')
    case 'package': return $gettext('Packages')
    case 'license': return $gettext('License')
    case 'signer': return $gettext('Signer certificate')
    default: return check.key
  }
}

export function checkDetail(check: Check): string {
  // Every parameter a text may use, so each call has what its text names.
  const p = { id: '', owner: '', repo: '', version: '', tag: '', word: '', count: '', name: '', license: '', key: '', ...check.params }
  switch (`${check.key}:${check.reason ?? ''}`) {
    case 'repository:': return $gettext('%{repo} is a public repository.', p)
    case 'repository:not_found': return $gettext('The repository does not exist or is not public.')
    case 'repository:private': return $gettext('The repository is private. The catalog lists public repositories only.')
    case 'repository:blocked': return $gettext('This repository may not be listed. Contact the maintainers if you think this is a mistake.')
    case 'repository:archived': return $gettext('The repository is archived.')
    case 'claim:installation': return $gettext('You installed the Nginx UI Plugin Catalog app on this repository.')
    case 'claim:admin': return $gettext('You have admin permission on this repository.')
    case 'claim:no_admin': return $gettext('Only an admin of the repository can submit it. Ask an admin to submit it, or to install the Nginx UI Plugin Catalog app.')
    case 'release:': return $gettext('Version %{version}, the newest stable release.', p)
    case 'release:prerelease': return $gettext('Version %{version} is a prerelease. The listing starts with it until a stable release is published.', p)
    case 'release:none': return $gettext('The repository has no GitHub Release with a version tag such as v1.0.0 yet.')
    case 'manifest:': return $gettext('Read from the release %{tag}.', p)
    case 'manifest:missing': return $gettext('There is no plugin.json at the root of the repository at %{tag}.', p)
    case 'manifest:invalid': return $gettext('plugin.json at %{tag} is not valid JSON.', p)
    case 'plugin_id:': return p.id
    case 'plugin_id:pattern': return $gettext('The plugin ID %{id} does not follow the naming rule, for example io.github.<owner>.<name>.', p)
    case 'plugin_id:reserved_namespace': return $gettext('The com.nginxui namespace is reserved for the plugins of the Nginx UI project.')
    case 'plugin_id:owner_mismatch': return $gettext('The plugin ID %{id} names another GitHub owner than %{owner}.', p)
    case 'plugin_id:blocked': return $gettext('This plugin ID may not be listed. Contact the maintainers if you think this is a mistake.')
    case 'plugin_id:listed': return $gettext('A plugin with this ID is listed already.')
    case 'plugin_id:pending': return $gettext('A submission of this plugin is already under review.')
    case 'name:': return p.name
    case 'name:missing': return $gettext('plugin.json has no name.')
    case 'name:reserved': return $gettext('The name holds "%{word}", which no name may hold. Only the plugins of the Nginx UI project are official.', p)
    case 'package:': return $gettext('%{count} packages in the release.', p)
    case 'package:missing': return $gettext('The release has no package named %{name} or one per platform.', p)
    case 'license:': return p.license
    case 'signer:': return $gettext('Issued by the primary key %{key}.', p)
    case 'signer:missing': return $gettext('There is no plugin.signer at %{tag}. Create the keys as described in the next step and publish a new release.', p)
    case 'signer:other_plugin': return $gettext('The certificate was issued for %{id}, not for this plugin.', p)
    case 'license:missing': return $gettext('GitHub detects no license in the repository. The listing shows none.')
    default: return check.reason ?? ''
  }
}
