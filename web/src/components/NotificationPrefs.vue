<script setup lang="ts">
import type { Prefs } from '@/api/notifications'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/api/client'
import { getPrefs, savePrefs } from '@/api/notifications'
import { signInUrl } from '@/api/session'
import { useFailure } from '@/lib/feedback'
import { $gettext } from '@/lib/gettext'

// How the user hears about their changes: in the portal and by email. Shown
// in the notification list and on the page of a change.
const emit = defineEmits<{ changed: [] }>()

const failure = useFailure()
const route = useRoute()
const prefs = ref<Prefs | null>(null)
const failed = ref(false)
const emailError = ref('')
getPrefs().then(p => (prefs.value = p)).catch(() => (failed.value = true))

async function save(next: Prefs) {
  const before = prefs.value
  prefs.value = next
  emailError.value = ''
  try {
    await savePrefs(next)
    emit('changed')
  }
  catch (error) {
    if (error instanceof ApiError && (error.code === 'unverified_email' || error.code === 'no_email_access')) {
      prefs.value = { ...next, email: before?.email ?? null }
      emailError.value = $gettext('Choose an address verified on your GitHub account.')
    }
    else {
      prefs.value = before
      failure()
    }
  }
}

// The primary address is taken when mail is turned on without one.
function set(key: 'inApp' | 'emailOnAction' | 'emailOnLive', value: boolean) {
  if (!prefs.value)
    return
  const email = value && key !== 'inApp' && !prefs.value.email ? prefs.value.emails?.[0]?.email ?? null : prefs.value.email
  save({ ...prefs.value, [key]: value, email })
}

function setEmail(value: string) {
  if (prefs.value)
    save({ ...prefs.value, email: value || null })
}

const wantsMail = computed(() => !!prefs.value && (prefs.value.emailOnAction || prefs.value.emailOnLive))
const emailOptions = computed(() => (prefs.value?.emails ?? []).map(e => ({ value: e.email, label: e.primary ? $gettext('%{email} (primary)', { email: e.email }) : e.email })))
// Signing in again asks GitHub for the permission to read the addresses.
const authorizeUrl = computed(() => signInUrl(route.fullPath))
</script>

<template>
  <div class="prefs">
    <template v-if="prefs">
      <div class="group-title">
        {{ $gettext('In the Developer Center') }}
      </div>
      <label class="row">
        <span>{{ $gettext('Tell me in the portal when a change moves') }}</span>
        <ASwitch :checked="prefs.inApp" size="small" @change="(v: boolean) => set('inApp', v)" />
      </label>
      <div class="group-title">
        {{ $gettext('By email') }}
      </div>
      <label class="row">
        <span>{{ $gettext('Email me when I need to act') }}</span>
        <ASwitch :checked="prefs.emailOnAction" size="small" :disabled="!prefs.mail" @change="(v: boolean) => set('emailOnAction', v)" />
      </label>
      <label class="row">
        <span>{{ $gettext('Email me when a listing goes live') }}</span>
        <ASwitch :checked="prefs.emailOnLive" size="small" :disabled="!prefs.mail" @change="(v: boolean) => set('emailOnLive', v)" />
      </label>
      <template v-if="prefs.mail && wantsMail">
        <template v-if="prefs.emails?.length">
          <ASelect
            :value="prefs.email ?? undefined"
            size="small"
            :options="emailOptions"
            :status="emailError ? 'error' : undefined"
            :placeholder="$gettext('Choose an address')"
            :aria-label="$gettext('Email address')"
            @change="(v: string) => setEmail(v)"
          />
          <span v-if="emailError" class="note err">{{ emailError }}</span>
          <span v-else-if="!prefs.email" class="note warn">{{ $gettext('Choose an address to get the mail.') }}</span>
          <span v-else class="note">{{ $gettext('Only addresses verified on your GitHub account can be chosen.') }}</span>
        </template>
        <template v-else-if="prefs.emails">
          <span class="note warn">{{ $gettext('Your GitHub account has no verified address that receives mail. Add one on GitHub, then open this again.') }}</span>
          <a href="https://github.com/settings/emails" target="_blank" rel="noopener" class="note-link">{{ $gettext('Email settings on GitHub') }}</a>
        </template>
        <template v-else>
          <span class="note warn">{{ $gettext('To send mail, the Developer Center needs to read the verified addresses of your GitHub account.') }}</span>
          <a :href="authorizeUrl" class="note-link">{{ $gettext('Sign in again to allow it') }}</a>
        </template>
      </template>
      <span v-if="!prefs.mail" class="note">{{ $gettext('Email is not available yet.') }}</span>
    </template>
    <span v-else-if="failed" class="note">{{ $gettext('The notification settings could not be loaded.') }}</span>
    <ASkeleton v-else active :title="false" :paragraph="{ rows: 3 }" />
  </div>
</template>

<style scoped>
.prefs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}

.group-title {
  font-size: 12px;
  opacity: 0.6;
}

.group-title:not(:first-child) {
  margin-top: 6px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.note {
  font-size: 12px;
  opacity: 0.65;
}

.note-link {
  font-size: 12px;
}

.note.err {
  opacity: 1;
  color: var(--portal-err-text);
}

.note.warn {
  opacity: 1;
  color: var(--portal-warn-text);
}
</style>
