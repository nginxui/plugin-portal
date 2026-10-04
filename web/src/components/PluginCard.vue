<script setup lang="ts">
import type { Change } from '@/api/changes'
import type { Insights, PluginSummary } from '@/api/plugins'
import { computed } from 'vue'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES } from '@/lib/hostLocales'
import { localized, roleLabel, stateTag, storeSourceLabel, trustLabel } from '@/lib/labels'
import { fromNow, waited } from '@/lib/time'

const props = defineProps<{ plugin: PluginSummary, insights?: Insights, change?: Change }>()

const name = computed(() => localized(props.plugin.name))
const state = computed(() => {
  if (props.change?.waitingOn === 'author')
    return { label: $gettext('Needs changes'), color: 'warning' }
  if (props.plugin.state !== 'listed' && props.change)
    return { label: $gettext('In review'), color: 'processing' }
  return stateTag(props.plugin.state)
})
const base = computed(() => `/plugins/${props.plugin.id}`)

// Review progress of a plugin that is not listed yet.
const steps = computed(() => {
  const c = props.change
  if (!c || props.plugin.state === 'listed')
    return null
  const order = ['submitted', 'checks', 'review', 'merged']
  const at = Math.max(order.indexOf(c.stage), 0)
  return [
    $gettext('Submitted'),
    $gettext('Checks passed'),
    $gettext('Maintainer review'),
    $gettext('Listed'),
  ].map((label, i) => ({
    label,
    state: i < at || (i === 0) ? 'done' : i === at ? (c.waitingOn === 'author' ? 'warn' : 'cur') : 'todo',
  }))
})

const downloads = computed(() => props.insights?.downloads.map(d => d.count) ?? [])
const latestDownloads = computed(() => props.insights?.downloads.at(-1)?.count ?? 0)
const translated = computed(() => props.insights?.translated.length ?? 0)
const shots = computed(() => props.insights?.screenshots)

const notes = computed(() => [
  props.plugin.owner && $gettext('Owner %{owner}, your role: %{role}.', { owner: props.plugin.owner.login, role: roleLabel(props.plugin.role) }),
  props.insights && $gettext('Store texts: %{source}.', { source: storeSourceLabel(props.insights.storeSource) }),
  props.insights?.minHostVersion && $gettext('Needs Nginx UI %{version} or later.', { version: props.insights.minHostVersion }),
].filter(Boolean).join(' '))
</script>

<template>
  <section class="pcard">
    <div class="pcard-head">
      <PluginIcon :src="plugin.iconUrl" :name="name" :size="40" />
      <div class="min-w-0 flex-1">
        <AFlex gap="6" align="center" wrap>
          <RouterLink :to="base" class="font-600 title">
            {{ name }}
          </RouterLink>
          <ATag :color="state.color" class="m-0">
            {{ state.label }}
          </ATag>
          <ATag v-if="trustLabel(plugin.trust)" class="m-0">
            {{ trustLabel(plugin.trust) }}
          </ATag>
        </AFlex>
        <div class="mono text-3 op-65 ellipsis">
          {{ plugin.id }}
        </div>
      </div>
    </div>

    <div class="pcard-body">
      <template v-if="steps">
        <div>
          <div class="steps" aria-hidden="true">
            <span v-for="step in steps" :key="step.label" :class="step.state" />
          </div>
          <div class="step-labels">
            <span v-for="step in steps" :key="step.label" :class="step.state">{{ step.label }}</span>
          </div>
        </div>
        <div class="facts">
          <div class="fact">
            <div class="fact-label">
              {{ $gettext('Submitted version') }}
            </div>
            <div class="fact-value">
              {{ change?.entry?.version ? `v${change.entry.version}` : plugin.version ? `v${plugin.version}` : '—' }}
            </div>
          </div>
          <div class="fact">
            <div class="fact-label">
              {{ $gettext('Waiting') }}
            </div>
            <div class="fact-value">
              {{ waited(change?.updatedAt) }}
            </div>
          </div>
        </div>
        <AAlert v-if="change?.waitingOn === 'author'" type="warning" show-icon :title="change.stage === 'checks' ? $gettext('The checks found problems. Fix them in a new release, then run the checks again.') : $gettext('A maintainer asked for changes. See the review on the change page.')" />
      </template>

      <template v-else>
        <div class="facts">
          <div class="fact">
            <div class="fact-label">
              {{ $gettext('Newest version') }}
            </div>
            <div class="fact-value">
              {{ plugin.version ? `v${plugin.version}` : '—' }}
            </div>
          </div>
          <div class="fact">
            <div class="fact-label">
              {{ $gettext('Released') }}
            </div>
            <div class="fact-value">
              {{ plugin.releasedAt ? fromNow(plugin.releasedAt) : '—' }}
            </div>
          </div>
          <div class="fact">
            <div class="fact-label">
              {{ $gettext('Platforms') }}
            </div>
            <div class="fact-value">
              {{ insights?.platforms ? String(insights.platforms) : $gettext('All') }}
            </div>
          </div>
        </div>
        <div v-if="downloads.length > 1">
          <AFlex justify="space-between" class="text-3">
            <span class="op-65">{{ $gettext('Downloads GitHub counts, last %{n} versions', { n: String(downloads.length) }) }}</span>
            <span class="font-500">{{ $gettext('%{n} for this version', { n: String(latestDownloads) }) }}</span>
          </AFlex>
          <SparkLine :values="downloads" />
        </div>
        <template v-if="insights">
          <CoverageMeter :label="$gettext('Languages')" :percent="translated / HOST_LOCALES.length * 100" :text="`${translated} / ${HOST_LOCALES.length}`" />
          <CoverageMeter
            v-if="shots && shots.total"
            :label="$gettext('Screenshots')"
            :percent="shots.dark / shots.total * 100"
            :text="$gettext('%{dark} of %{total} with dark', { dark: String(shots.dark), total: String(shots.total) })"
          />
          <CoverageMeter :label="$gettext('README')" :percent="insights.readme ? 100 : 0" :text="insights.readme ? $gettext('Provided') : $gettext('Missing')" />
        </template>
        <div class="text-3 op-65">
          {{ notes }}
        </div>
      </template>
    </div>

    <div class="pcard-foot">
      <template v-if="plugin.state === 'listed'">
        <RouterLink :to="base">
          <AButton type="text" size="small">
            {{ $gettext('Store') }}
          </AButton>
        </RouterLink>
        <RouterLink :to="`${base}/preflight`">
          <AButton type="text" size="small">
            {{ $gettext('Preflight') }}
          </AButton>
        </RouterLink>
        <RouterLink :to="`${base}/versions`">
          <AButton type="text" size="small">
            {{ $gettext('Versions') }}
          </AButton>
        </RouterLink>
        <AButton v-if="plugin.catalogUrl" type="text" size="small" :href="plugin.catalogUrl" target="_blank">
          {{ $gettext('Catalog page') }}
          <span class="i-tabler-external-link" />
        </AButton>
      </template>
      <template v-else>
        <RouterLink v-if="change" :to="`/changes/${change.id}`">
          <AButton type="text" size="small">
            {{ $gettext('Follow the review') }}
          </AButton>
        </RouterLink>
        <RouterLink :to="base">
          <AButton type="text" size="small">
            {{ $gettext('Manage') }}
          </AButton>
        </RouterLink>
      </template>
    </div>
  </section>
</template>

<style scoped>
.pcard {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  background: var(--portal-card);
  min-width: 0;
}

.pcard-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--portal-border);
}

.title {
  color: inherit;
}

.title:hover {
  color: var(--portal-primary);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pcard-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  flex: 1;
}

.facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.fact {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--portal-faint);
  box-shadow: inset 0 0 0 1px var(--portal-border);
  min-width: 0;
}

.fact-label {
  font-size: 12px;
  opacity: 0.65;
}

.fact-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.steps span {
  height: 4px;
  border-radius: 2px;
  background: var(--portal-border-strong);
}

.steps .done {
  background: #52c41a;
}

.steps .cur {
  background: var(--portal-primary);
}

.steps .warn {
  background: #faad14;
}

.step-labels {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 6px;
  font-size: 12px;
}

.step-labels .todo {
  opacity: 0.5;
}

.step-labels .warn {
  color: #d48806;
  font-weight: 500;
}

.step-labels .cur {
  color: var(--portal-primary);
  font-weight: 500;
}

.pcard-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--portal-border);
}
</style>
