<script setup lang="ts">
import type { Draft } from '@/api/submit'
import { computed, ref } from 'vue'
import { $gettext } from '@/lib/gettext'
import { keyState } from '@/lib/keys'

const props = defineProps<{ draft: Draft, publicKey: string, stacked?: boolean }>()

const command = computed(() => `nginx-ui plugin key init --id ${props.draft.id}`)
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(command.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  }
  catch {}
}

type Tone = 'success' | 'warning' | 'danger' | 'secondary'

const pasted = computed<{ tone: Tone, text: string }>(() => {
  switch (keyState(props.publicKey, props.draft.signer).state) {
    case 'match': return { tone: 'success', text: $gettext('Pasted, matches the certificate') }
    case 'unchecked': return { tone: 'success', text: $gettext('Pasted') }
    case 'empty': return { tone: 'secondary', text: $gettext('Not pasted yet') }
    default: return { tone: 'danger', text: $gettext('Check the key under the field') }
  }
})

const certificate = computed<{ tone: Tone, text: string }>(() => {
  const signer = props.draft.signer
  if (!signer?.signingKeyId || !signer.primaryKeyId)
    return { tone: 'warning', text: $gettext('Not in %{tag}', { tag: props.draft.tag }) }
  if (signer.pluginId !== props.draft.id)
    return { tone: 'danger', text: $gettext('Issued for another plugin') }
  return { tone: 'success', text: $gettext('Found in %{tag}', { tag: props.draft.tag }) }
})

const icons: Record<Tone, string> = {
  success: 'i-tabler-check',
  warning: 'i-tabler-alert-triangle',
  danger: 'i-tabler-alert-circle',
  secondary: 'i-tabler-clock',
}
</script>

<template>
  <div class="guide">
    <div class="terminal">
      <div class="term-bar">
        <span class="dots" aria-hidden="true"><i /><i /><i /></span>
        <span class="term-title">{{ $gettext('Run once in a terminal with Nginx UI') }}</span>
        <button type="button" class="term-copy" @click="copy">
          <span :class="copied ? 'i-tabler-check' : 'i-tabler-copy'" />
          {{ copied ? $gettext('Copied') : $gettext('Copy') }}
        </button>
      </div>
      <div class="term-body">
        <span class="prompt">$</span> {{ command }}
      </div>
    </div>

    <ATypographyParagraph type="secondary" class="text-3 mb-0">
      {{ $gettext('It creates five files. Put each one in its place:') }}
    </ATypographyParagraph>

    <div class="places" :class="{ stacked }">
      <section class="place">
        <div class="place-head">
          <h4><span class="i-tabler-forms" />{{ $gettext('This page') }}</h4>
          <p class="place-where">
            {{ $gettext('The primary public key field') }}
          </p>
        </div>
        <div class="place-body">
          <div class="files">
            <code>primary.pub</code>
          </div>
          <span class="status" :class="pasted.tone"><span :class="icons[pasted.tone]" />{{ pasted.text }}</span>
        </div>
      </section>

      <section class="place">
        <div class="place-head">
          <h4><span class="i-tabler-brand-github" />{{ $gettext('Plugin repository') }}</h4>
          <p class="place-where">
            {{ $gettext('The root and the release environment') }}
          </p>
        </div>
        <div class="place-body">
          <div class="group">
            <div class="files">
              <code>plugin.signer</code>
              <code>plugin.signer.minisig</code>
            </div>
            <span class="status" :class="certificate.tone"><span :class="icons[certificate.tone]" />{{ certificate.text }}</span>
          </div>
          <div class="group">
            <div class="files">
              <code>signing.key</code>
            </div>
            <p class="place-note">
              {{ $gettext('Add it as the secret PLUGIN_SIGNING_KEY of the release environment, then delete the local copy.') }}
            </p>
          </div>
        </div>
      </section>

      <section class="place offline">
        <div class="place-head">
          <h4><span class="i-tabler-lock" />{{ $gettext('Your offline backup') }}</h4>
          <p class="place-where">
            {{ $gettext('A password manager or offline storage') }}
          </p>
        </div>
        <div class="place-body">
          <div class="files">
            <code>primary.key</code>
          </div>
          <span class="status warning"><span class="i-tabler-alert-triangle" />{{ $gettext('Without it no new certificate can be issued') }}</span>
        </div>
      </section>
    </div>

    <div class="after">
      <span>{{ $gettext('Then publish every release with nginxui/plugin-release, which signs the packages when a version tag is pushed.') }}</span>
      <a href="https://github.com/nginxui/plugin-release" target="_blank" rel="noopener">nginxui/plugin-release</a>
      <a href="https://nginxui.com/plugin/signing" target="_blank" rel="noopener">{{ $gettext('Signing and trust') }}</a>
    </div>
  </div>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* The terminal stays dark in both themes, like a real one. */
.terminal {
  border-radius: 8px;
  overflow: hidden;
  background: #0d1117;
  color: #e6edf3;
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  font-size: 12px;
}

.dots {
  display: flex;
  gap: 6px;
}

.dots i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff5f57;
}

.dots i:nth-child(2) {
  background: #febc2e;
}

.dots i:nth-child(3) {
  background: #28c840;
}

.term-title {
  flex: 1;
  min-width: 0;
  color: #8b949e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.term-copy {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 6px;
  color: #c9d1d9;
  cursor: pointer;
  border: 1px solid #30363d;
}

.term-copy:hover,
.term-copy:focus-visible {
  background: #21262d;
}

.term-body {
  padding: 12px 14px;
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
}

.prompt {
  color: #3fb950;
  user-select: none;
}

.after {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
}

.after > span {
  opacity: 0.65;
}

.places {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.places.stacked {
  grid-template-columns: 1fr;
}

/* In the drawer each place is a row: where on the left, files on the right. */
.places.stacked .place {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  column-gap: 20px;
  align-items: start;
}

.places.stacked .place-where {
  margin-bottom: 0;
}

.group + .group {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--portal-border);
}

@media (max-width: 520px) {
  .places.stacked .place {
    grid-template-columns: 1fr;
  }

  .places.stacked .place-where {
    margin-bottom: 12px;
  }
}

.place {
  display: flex;
  flex-direction: column;
  padding: 14px;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
}

.place.offline {
  border-style: dashed;
}

.place h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.place h4 > span {
  opacity: 0.6;
}

.place-where {
  margin: 2px 0 12px;
  font-size: 12px;
  opacity: 0.65;
}

.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.files code {
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--portal-border);
  background: var(--portal-faint);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.status {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
}

.status > span {
  flex: none;
  margin-top: 2px;
}

.status.success {
  color: #389e0d;
}

.status.warning {
  color: #d48806;
}

.status.danger {
  color: #cf1322;
}

.status.secondary {
  opacity: 0.6;
}

:global(html.dark) .status.success {
  color: #6abe39;
}

:global(html.dark) .status.warning {
  color: #e8b339;
}

:global(html.dark) .status.danger {
  color: #e86e6b;
}

.place-note {
  margin: 6px 0 0;
  font-size: 12px;
  opacity: 0.65;
}
</style>
