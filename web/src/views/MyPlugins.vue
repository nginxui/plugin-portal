<script setup lang="ts">
import type { Change } from '@/api/changes'
import type { Insights, Installable, PluginSummary } from '@/api/plugins'
import type { Announcement } from '@/api/settings'
import type { SubmitDraft } from '@/lib/submitDrafts'
import { computed, onMounted, ref } from 'vue'
import { getChanges } from '@/api/changes'
import { getInsights, getMyPlugins } from '@/api/plugins'
import { getAnnouncements } from '@/api/settings'
import { changePath, kindLabel } from '@/lib/changeKinds'
import gettext, { $gettext } from '@/lib/gettext'
import { joinList, localized } from '@/lib/labels'
import { localeName } from '@/lib/locales'
import { loadDrafts } from '@/lib/submitDrafts'
import { between, formatDay, formatTime, fromNow, waited } from '@/lib/time'
import { useMoreRepos } from '@/lib/useMoreRepos'

const plugins = ref<PluginSummary[]>([])
const changes = ref<Change[]>([])
const insights = ref<Record<string, Insights>>({})
const installable = ref<Installable[]>([])
const more = useMoreRepos()

// News from maintainers, in the language of the portal or else English.
const announcements = ref<Announcement[]>([])
getAnnouncements().then(r => (announcements.value = r.announcements)).catch(() => {})
const inPortalLanguage = (value: Record<string, string>) => value[gettext.current] ?? value.en ?? ''
const installUrl = ref('')
const loading = ref(true)
const failed = ref(false)
const ownerFilter = ref('all')

// Submissions started and not sent yet whose plugin is not here yet.
const savedDrafts = ref<SubmitDraft[]>([])
loadDrafts().then(list => (savedDrafts.value = list)).catch(() => {})
const drafts = computed(() => savedDrafts.value.filter(d => !plugins.value.some(p => p.repo?.toLowerCase() === d.repo.toLowerCase() || p.id === d.id)))

async function load() {
  loading.value = true
  failed.value = false
  try {
    const [data, mine] = await Promise.all([getMyPlugins(), getChanges().catch(() => ({ changes: [] }))])
    changes.value = mine.changes.filter(c => c.state === 'open' || c.state === 'merged')
    plugins.value = data.plugins
    installable.value = data.installable
    installUrl.value = data.installUrl
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
  // Downloads and completeness come from GitHub and load after the list.
  getInsights()
    .then(r => (insights.value = Object.fromEntries(r.insights.map(i => [i.id, i]))))
    .catch(() => {})
}

onMounted(load)

const owners = computed(() => {
  const counts = new Map<string, number>()
  for (const plugin of plugins.value) {
    const login = plugin.owner?.login
    if (login)
      counts.set(login, (counts.get(login) ?? 0) + 1)
  }
  return counts
})

const ownerOptions = computed(() => [
  { value: 'all', label: `${$gettext('All')} ${plugins.value.length}` },
  ...[...owners.value].map(([login, count]) => ({ value: login, label: `${login} ${count}` })),
])

const summary = computed(() => {
  const orgs = new Set(plugins.value.filter(p => p.owner?.kind === 'organization').map(p => p.owner!.login))
  return orgs.size
    ? $gettext('%{n} plugins, from your account and %{orgs} organizations. Roles come from your permission on each GitHub repository.', { n: String(plugins.value.length), orgs: String(orgs.size) })
    : $gettext('%{n} plugins. Roles come from your permission on each GitHub repository.', { n: String(plugins.value.length) })
})

const shown = computed(() => ownerFilter.value === 'all'
  ? plugins.value
  : plugins.value.filter(p => p.owner?.login === ownerFilter.value))

const changeOf = (id: string) => changes.value.find(c => c.pluginId === id && c.state === 'open')
const nameOf = (id: string | null) => localized(plugins.value.find(p => p.id === id)?.name) || id || ''
const iconOf = (id: string | null) => plugins.value.find(p => p.id === id)?.iconUrl ?? null

interface Todo {
  key: string
  plugin: string
  icon?: string | null
  title: string
  sub: string
  action: string
  to: string
  primary?: boolean
}

// Everything that waits on the user, across all their plugins.
const todos = computed<Todo[]>(() => {
  const out: Todo[] = []
  for (const change of changes.value) {
    if (change.state !== 'open' || change.waitingOn !== 'author')
      continue
    const name = nameOf(change.pluginId) || localized(change.entry?.name)
    if (change.stage === 'review' && change.class !== 'self_service') {
      const sub = change.askedBy && change.askedFor
        ? $gettext('%{name}, @%{login} asked %{time}: %{text}', { name, login: change.askedBy, time: formatTime(change.askedAt ?? change.updatedAt), text: change.askedFor.length > 40 ? `${change.askedFor.slice(0, 40)}…` : change.askedFor })
        : $gettext('%{name}, a maintainer asked for changes %{time}', { name, time: fromNow(change.updatedAt) })
      out.push({ key: change.id, plugin: name, icon: iconOf(change.pluginId), title: $gettext('Answer the review'), sub, action: $gettext('View'), to: changePath(change), primary: true })
    }
    else if (change.stage === 'review') {
      out.push({ key: change.id, plugin: name, icon: iconOf(change.pluginId), title: $gettext('Merge the store change'), sub: $gettext('%{name}, pull request #%{n} waiting %{time}', { name, n: String(change.prNumber ?? ''), time: waited(change.updatedAt) }), action: $gettext('Follow the change'), to: changePath(change) })
    }
    else {
      out.push({ key: change.id, plugin: name, icon: iconOf(change.pluginId), title: $gettext('Fix what the checks found'), sub: $gettext('%{name}, %{kind}', { name, kind: kindLabel(change.kind) }), action: $gettext('View'), to: changePath(change), primary: true })
    }
  }
  for (const plugin of plugins.value) {
    const i = insights.value[plugin.id]
    if (!i || plugin.role === null)
      continue
    const name = localized(plugin.name)
    if (i.screenshots.total > i.screenshots.dark) {
      const missing = i.screenshots.total - i.screenshots.dark
      out.push({ key: `${plugin.id}:dark`, plugin: name, icon: plugin.iconUrl, title: $gettext('Add dark screenshots'), sub: $gettext('%{name}, %{n} screenshots have only a light version', { name, n: String(missing) }), action: $gettext('Screenshot studio'), to: `/plugins/${plugin.id}/screenshots` })
    }
    if (i.untranslated.length) {
      const names = joinList(i.untranslated.slice(0, 5).map(localeName))
      out.push({
        key: `${plugin.id}:i18n`,
        plugin: name,
        icon: plugin.iconUrl,
        title: $gettext('Translate into %{n} more languages', { n: String(i.untranslated.length) }),
        sub: i.untranslated.length > 5 ? $gettext('%{name}, %{list} and more', { name, list: names }) : $gettext('%{name}, %{list}', { name, list: names }),
        action: $gettext('Translation workbench'),
        to: `/plugins/${plugin.id}/translations`,
      })
    }
  }
  return out
})

const recentReleases = computed(() => plugins.value
  .flatMap(p => (insights.value[p.id]?.releases ?? []).map(r => ({ ...r, plugin: localized(p.name), id: p.id })))
  .filter(r => r.publishedAt)
  .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  .slice(0, 5))

const activity = computed(() => plugins.value
  .filter(p => p.repo && typeof insights.value[p.id]?.openIssues === 'number')
  .map(p => ({ id: p.id, name: localized(p.name), icon: p.iconUrl, repo: p.repo!, issues: insights.value[p.id].openIssues ?? 0 })))
</script>

<template>
  <div class="page">
    <AFlex justify="space-between" align="flex-start" gap="middle" wrap>
      <div>
        <h1 class="page-title">
          {{ $gettext('My plugins') }}
        </h1>
        <ATypographyText type="secondary">
          {{ loading ? $gettext('Manage the plugins you list in the catalog and follow changes under review.') : summary }}
        </ATypographyText>
      </div>
      <RouterLink to="/submit">
        <AButton type="primary">
          <span class="i-tabler-plus" />
          {{ $gettext('Submit a plugin') }}
        </AButton>
      </RouterLink>
    </AFlex>

    <AAlert v-if="failed" type="error" show-icon :title="$gettext('Your plugins could not be loaded.')">
      <template #action>
        <AButton size="small" @click="load">
          {{ $gettext('Retry') }}
        </AButton>
      </template>
    </AAlert>

    <AFlex v-if="owners.size > 1" align="center" gap="small" wrap>
      <span class="text-3 op-65">{{ $gettext('Owner') }}</span>
      <ASegmented v-model:value="ownerFilter" :options="ownerOptions" :aria-label="$gettext('Filter by owner')" />
    </AFlex>

    <div class="cols">
      <AFlex vertical gap="middle" class="col-main">
        <ACard v-if="todos.length" :title="$gettext('To do')" :styles="{ body: { padding: '4px 0' } }">
          <template #extra>
            <ATag class="m-0">
              {{ $gettext('%{n} items', { n: String(todos.length) }) }}
            </ATag>
          </template>
          <div v-for="todo in todos" :key="todo.key" class="todo">
            <PluginIcon :src="todo.icon" :name="todo.plugin" :size="28" />
            <div class="min-w-0 flex-1">
              <div>{{ todo.title }}</div>
              <div class="text-3 op-65">
                {{ todo.sub }}
              </div>
            </div>
            <RouterLink :to="todo.to">
              <AButton size="small" :type="todo.primary ? 'primary' : 'default'">
                {{ todo.action }}
              </AButton>
            </RouterLink>
          </div>
        </ACard>

        <ASkeleton v-if="loading" active />
        <ACard v-else-if="!failed && shown.length === 0 && !drafts.length">
          <AEmpty :description="$gettext('You have no role on any listed plugin yet.')">
            <ATypographyText type="secondary" class="text-3">
              {{ $gettext('Plugins appear here when you have admin, maintain, write or triage permission on their repository.') }}
            </ATypographyText>
          </AEmpty>
        </ACard>
        <div v-else-if="!failed" class="grid">
          <PluginCard v-for="plugin in shown" :key="plugin.id" :plugin="plugin" :insights="insights[plugin.id]" :change="changeOf(plugin.id)" />
          <SubmitDraftCard v-for="draft in ownerFilter === 'all' ? drafts : []" :key="draft.repo" :draft="draft" @discard="savedDrafts = savedDrafts.filter(d => d.repo !== draft.repo)" />
        </div>

        <ACard v-if="!failed" :title="$gettext('Repositories you can submit')" :loading="loading">
          <template #extra>
            <a :href="installUrl" target="_blank" rel="noopener" class="text-3">
              {{ $gettext('Install the app on another repository') }}
              <span class="i-tabler-external-link" />
            </a>
          </template>
          <ATypographyParagraph type="secondary" class="text-3">
            {{ $gettext('Repositories you installed the Nginx UI Plugin Catalog app on. With the app installed, new releases reach the catalog within minutes.') }}
          </ATypographyParagraph>
          <AEmpty v-if="installable.length === 0 && more.shown.value.length === 0" :image-style="{ height: '40px' }" :description="$gettext('No repository with the app installed is waiting to be submitted.')" />
          <AFlex v-for="repo in [...installable, ...more.shown.value]" :key="repo.repo" align="center" gap="middle" class="py-2">
            <span class="i-tabler-brand-github text-6 op-65" />
            <div class="flex-1 min-w-0">
              <a :href="`https://github.com/${repo.repo}`" target="_blank" rel="noopener" class="font-600">{{ repo.repo }}</a>
              <div class="text-3 op-65">
                <template v-if="repo.description">
                  {{ repo.description }}
                </template>
                <template v-else-if="repo.source === 'installation'">
                  {{ $gettext('App installed %{time}', { time: fromNow(repo.at) }) }}
                </template>
                <template v-else>
                  {{ $gettext('You administer this repository') }}
                </template>
              </div>
            </div>
            <RouterLink :to="{ path: '/submit', query: { repo: repo.repo } }">
              <AButton>{{ $gettext('Submit as plugin') }}</AButton>
            </RouterLink>
          </AFlex>
          <div v-if="more.hasMore.value" class="mt-2">
            <AButton type="link" class="px-0" :loading="more.loading.value" @click="more.loadMore">
              {{ more.left.value === null ? $gettext('Load other repositories you administer') : $gettext('Load more, %{n} left', { n: String(more.left.value) }) }}
            </AButton>
          </div>
          <div v-else-if="more.left.value === 0 && more.shown.value.length === 0" class="text-3 op-65 mt-2">
            {{ $gettext('No other public repository you administer.') }}
          </div>
          <AAlert v-if="more.failed.value" type="error" show-icon class="mt-2" :title="$gettext('The repositories could not be loaded. Please try again.')" />
        </ACard>
      </AFlex>

      <AFlex vertical gap="middle" class="col-side">
        <ACard :title="$gettext('Recent releases')">
          <div v-if="recentReleases.length" class="timeline">
            <div v-for="release in recentReleases" :key="`${release.id}@${release.version}`" class="tl-item">
              <span class="tl-dot" :class="release.yanked ? 'warn' : release.listed === false ? 'info' : 'ok'" />
              <div class="min-w-0">
                <div>
                  {{ release.yanked ? $gettext('%{name} v%{version} yanked', { name: release.plugin, version: release.version }) : $gettext('%{name} v%{version}', { name: release.plugin, version: release.version }) }}
                </div>
                <div class="text-3 op-65">
                  <template v-if="release.yanked && release.yankReason">
                    {{ $gettext('%{time}, reason: %{reason}', { time: fromNow(release.publishedAt), reason: release.yankReason }) }}
                  </template>
                  <template v-else-if="release.yanked">
                    {{ $gettext('Released %{time}, yanked', { time: fromNow(release.publishedAt) }) }}
                  </template>
                  <template v-else-if="release.listed === false">
                    {{ $gettext('Released %{time}, not listed yet', { time: fromNow(release.publishedAt) }) }}
                  </template>
                  <template v-else-if="release.listedAt && release.publishedAt">
                    {{ $gettext('Released %{time}, listed after %{delay}', { time: fromNow(release.publishedAt), delay: between(release.publishedAt, release.listedAt) }) }}
                  </template>
                  <template v-else>
                    {{ $gettext('Released %{time}, listed in the catalog', { time: fromNow(release.publishedAt) }) }}
                  </template>
                </div>
              </div>
            </div>
          </div>
          <ATypographyText v-else type="secondary" class="text-3">
            {{ $gettext('No releases yet.') }}
          </ATypographyText>
        </ACard>
        <ACard v-if="activity.length" :title="$gettext('Repository activity')">
          <AFlex vertical gap="10">
            <AFlex v-for="item in activity" :key="item.id" justify="space-between" align="center" gap="small">
              <AFlex align="center" gap="small" class="min-w-0">
                <PluginIcon :src="item.icon" :name="item.name" :size="24" />
                <span class="truncate">{{ item.name }}</span>
              </AFlex>
              <a v-if="item.issues" :href="`https://github.com/${item.repo}/issues`" target="_blank" rel="noopener" class="text-3 nowrap">{{ $gettext('%{n} open issues', { n: String(item.issues) }) }}</a>
              <span v-else class="text-3 op-65 nowrap">{{ $gettext('No open issues') }}</span>
            </AFlex>
          </AFlex>
        </ACard>
        <ACard :title="$gettext('Announcements')">
          <AFlex vertical gap="12">
            <div v-for="item in announcements" :key="item.id">
              <div class="font-500 text-3">
                {{ inPortalLanguage(item.title) }}
              </div>
              <div class="text-3 op-65">
                {{ inPortalLanguage(item.text) }}
              </div>
              <div class="text-3 op-50">
                {{ formatDay(item.date) }}
              </div>
            </div>
            <span v-if="!announcements.length" class="text-3 op-65">{{ $gettext('No announcements.') }}</span>
          </AFlex>
        </ACard>
        <ACard :title="$gettext('Getting started')">
          <AFlex vertical gap="10">
            <a href="https://nginxui.com/plugin/overview" target="_blank" rel="noopener" class="link-row"><span class="i-tabler-book" />{{ $gettext('Plugin development guide') }}</a>
            <a href="https://nginxui.com/plugin/signing" target="_blank" rel="noopener" class="link-row"><span class="i-tabler-key" />{{ $gettext('Create the primary key and signer certificates') }}</a>
            <a href="https://github.com/nginxui/plugin-release" target="_blank" rel="noopener" class="link-row"><span class="i-tabler-package" />{{ $gettext('Package and sign with the release action') }}</a>
          </AFlex>
        </ACard>
      </AFlex>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

@media (max-width: 420px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.todo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
}

.todo + .todo {
  border-top: 1px solid var(--portal-border);
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 13px;
}

.tl-item {
  display: flex;
  gap: 10px;
}

.tl-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--portal-border-strong);
}

.tl-dot.ok {
  background: #52c41a;
}

.tl-dot.warn {
  background: #faad14;
}

.tl-dot.info {
  background: var(--portal-primary);
}

.link-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.nowrap {
  white-space: nowrap;
}
</style>
