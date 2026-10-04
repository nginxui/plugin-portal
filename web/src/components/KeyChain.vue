<script setup lang="ts">
import type { Draft } from '@/api/submit'
import { computed } from 'vue'
import { $gettext } from '@/lib/gettext'
import { keyState } from '@/lib/keys'

// One line under the primary public key field: the pasted key, the key that
// signed the certificate of the release and the signing key it certifies,
// with their real ids, so a wrong key shows where the chain breaks.
const props = defineProps<{ draft: Draft, publicKey: string }>()

const short = (id: string | null | undefined) => id ? id.slice(0, 8) : ''

const state = computed(() => keyState(props.publicKey, props.draft.signer))
const signer = computed(() => props.draft.signer)
const forThisPlugin = computed(() => signer.value?.pluginId === props.draft.id)
</script>

<template>
  <div v-if="state.state !== 'empty'" class="chain" :class="{ broken: state.state === 'mismatch' || state.state === 'signing' || state.state === 'invalid' }">
    <template v-if="state.state === 'invalid'">
      <span class="i-tabler-alert-circle bad" />
      <span>{{ $gettext('This is not a minisign public key. Paste the whole content of primary.pub.') }}</span>
    </template>
    <template v-else-if="state.state === 'unchecked'">
      <span class="i-tabler-info-circle op-60" />
      <span>{{ $gettext('Key %{id}. The release has no certificate to check it against.', { id: short(state.id) }) }}</span>
    </template>
    <template v-else>
      <span class="link">
        <span class="op-65">{{ $gettext('Your key') }}</span>
        <code>{{ short(state.id) }}</code>
      </span>
      <span class="arrow" :class="state.state === 'match' ? 'good' : 'bad'">
        <span :class="state.state === 'match' ? 'i-tabler-arrow-right' : 'i-tabler-x'" />
      </span>
      <span class="link">
        <span class="op-65">{{ $gettext('Certificate signer') }}</span>
        <code>{{ short(signer?.primaryKeyId) }}</code>
      </span>
      <span class="arrow" :class="forThisPlugin ? 'good' : 'bad'">
        <span :class="forThisPlugin ? 'i-tabler-arrow-right' : 'i-tabler-x'" />
      </span>
      <span class="link">
        <span class="op-65">{{ $gettext('Signing key') }}</span>
        <code>{{ short(signer?.signingKeyId) }}</code>
      </span>
      <span v-if="state.state === 'match' && forThisPlugin" class="verdict good">
        <span class="i-tabler-check" />{{ $gettext('The chain matches') }}
      </span>
      <span v-else-if="state.state === 'signing'" class="verdict bad">
        {{ $gettext('You pasted the signing key. Paste primary.pub instead.') }}
      </span>
      <span v-else-if="state.state === 'mismatch'" class="verdict bad">
        {{ $gettext('This key did not issue the certificate of %{tag}.', { tag: draft.tag }) }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: -12px 0 20px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--portal-border);
  font-size: 12px;
}

.chain.broken {
  border-color: #ffccc7;
  background: #fff2f0;
}

:global(html.dark) .chain.broken {
  border-color: #58181c;
  background: #2c1618;
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.link code {
  font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.arrow {
  display: inline-flex;
  font-size: 14px;
}

.verdict {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-weight: 500;
}

.good {
  color: #389e0d;
}

.bad {
  color: #cf1322;
}

:global(html.dark) .good {
  color: #6abe39;
}

:global(html.dark) .bad {
  color: #e86e6b;
}
</style>
