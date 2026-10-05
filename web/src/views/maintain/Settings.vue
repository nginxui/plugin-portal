<script setup lang="ts">
import type { Announcement, AnnouncementInput, MailInput, PortalSettings } from '@/api/settings'
import { computed, onMounted, ref } from 'vue'
import { ApiError } from '@/api/client'
import { clearBot, clearMail, createAnnouncement, deleteAnnouncement, getSettings, saveBot, saveMail, testMail, updateAnnouncement } from '@/api/settings'
import { useFailure } from '@/lib/feedback'
import gettext, { $gettext } from '@/lib/gettext'
import { formatDay } from '@/lib/time'

// Settings of the portal kept in its database: announcements for authors, the
// mail service and the bot account. Secrets can be replaced, never read back.

const failure = useFailure()
const data = ref<PortalSettings | null>(null)
const loading = ref(true)
const failed = ref(false)
const EMPTY_MAIL: MailInput = { kind: 'http', from: '', url: '', key: '', host: '', port: 587, user: '', password: '' }
const mail = ref<MailInput>({ ...EMPTY_MAIL })
const bot = ref({ login: '', token: '' })

async function load() {
  loading.value = true
  try {
    data.value = await getSettings()
    fillMail()
    bot.value = { login: data.value.bot.login, token: '' }
    failed.value = false
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}
onMounted(load)

function fillMail() {
  const m = data.value!.mail
  mail.value = { kind: m.kind, from: m.from, url: m.url, key: '', host: m.host, port: m.port || 587, user: m.user, password: '' }
}

const inPortalLanguage = (value: Record<string, string>) => value[gettext.current] ?? value.en ?? ''

function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : ''
  switch (code) {
    case 'date': return $gettext('Enter a date.')
    case 'title': return $gettext('Enter an English title of at most 80 characters.')
    case 'text': return $gettext('Enter an English text of at most 400 characters.')
    case 'url': return $gettext('Enter the address of the mail service, starting with https://.')
    case 'from': return $gettext('Enter the sender as an email address, with a name if you like.')
    case 'key': return $gettext('Enter the API key of the mail service.')
    case 'host': return $gettext('Enter the host name of the SMTP server.')
    case 'port': return $gettext('Enter a port of the SMTP server other than 25, usually 465 or 587.')
    case 'password': return $gettext('Enter the password of the SMTP account.')
    case 'to': return $gettext('Enter an email address to send the test to.')
    case 'send_failed': return data.value?.mail.activeKind === 'smtp'
      ? $gettext('The SMTP server did not take the test mail. Check the host, the port, the account and the sender.')
      : $gettext('The mail service did not accept the test mail. Check the address, the sender and the key.')
    case 'login': return $gettext('Enter the GitHub account of the bot.')
    case 'token': return $gettext('Enter an access token of the bot account.')
    case 'token_login': return $gettext('The token belongs to another GitHub account.')
    case 'token_invalid': return $gettext('GitHub did not accept the token.')
    default: return $gettext('The settings could not be saved. Please try again.')
  }
}

function status(active: 'settings' | 'env' | null) {
  if (active === 'settings')
    return { color: 'success', text: $gettext('In use') }
  if (active === 'env')
    return { color: 'processing', text: $gettext('From the Worker config') }
  return { color: 'default', text: $gettext('Not set up') }
}

// Announcements

const editing = ref<(AnnouncementInput & { id: number | null }) | null>(null)
const announcementSaving = ref(false)
const announcementError = ref('')

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startCreate() {
  editing.value = { id: null, date: today(), title: { en: '', zh_CN: '' }, text: { en: '', zh_CN: '' } }
  announcementError.value = ''
}

function startEdit(item: Announcement) {
  editing.value = { id: item.id, date: item.date, title: { en: '', zh_CN: '', ...item.title }, text: { en: '', zh_CN: '', ...item.text } }
  announcementError.value = ''
}

async function saveAnnouncement() {
  if (!editing.value)
    return
  announcementSaving.value = true
  announcementError.value = ''
  try {
    const { id, ...input } = editing.value
    if (id === null)
      await createAnnouncement(input)
    else
      await updateAnnouncement(id, input)
    editing.value = null
    await load()
  }
  catch (error) {
    announcementError.value = errorText(error)
  }
  finally {
    announcementSaving.value = false
  }
}

async function removeAnnouncement(item: Announcement) {
  try {
    await deleteAnnouncement(item.id)
  }
  catch {
    failure()
  }
  await load()
}

// Mail

const mailSaving = ref(false)
const mailError = ref('')
const testTo = ref('')
const testing = ref(false)
const testResult = ref<{ ok: boolean, text: string } | null>(null)

// The port as typed, kept a number in the form.
const portText = computed({
  get: () => String(mail.value.port || ''),
  set: (value: string) => (mail.value.port = Number(value.replace(/\D/g, '')) || 0),
})

async function submitMail() {
  mailSaving.value = true
  mailError.value = ''
  try {
    const view = await saveMail(mail.value)
    data.value = { ...data.value!, ...view }
    fillMail()
  }
  catch (error) {
    mailError.value = errorText(error)
  }
  finally {
    mailSaving.value = false
  }
}

async function removeMail() {
  try {
    const view = await clearMail()
    data.value = { ...data.value!, ...view }
    mail.value = { ...EMPTY_MAIL }
  }
  catch {
    failure()
  }
}

async function sendTest() {
  testing.value = true
  testResult.value = null
  try {
    await testMail(testTo.value.trim())
    testResult.value = { ok: true, text: $gettext('The test mail was sent.') }
  }
  catch (error) {
    // What the mail service said, so a wrong key or sender shows as such.
    const detail = error instanceof ApiError ? error.detail : {}
    const said = [detail.status ? `HTTP ${detail.status}` : '', typeof detail.message === 'string' ? detail.message : ''].filter(Boolean).join(': ')
    testResult.value = { ok: false, text: said ? $gettext('%{text} The mail service answered: %{answer}', { text: errorText(error), answer: said }) : errorText(error) }
  }
  finally {
    testing.value = false
  }
}

// Bot

const botSaving = ref(false)
const botError = ref('')

async function submitBot() {
  botSaving.value = true
  botError.value = ''
  try {
    const view = await saveBot(bot.value)
    data.value = { ...data.value!, ...view }
    bot.value.token = ''
  }
  catch (error) {
    botError.value = errorText(error)
  }
  finally {
    botSaving.value = false
  }
}

async function removeBot() {
  try {
    const view = await clearBot()
    data.value = { ...data.value!, ...view }
    bot.value = { login: '', token: '' }
  }
  catch {
    failure()
  }
}
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('Settings') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('Announcements for authors, and the services the portal sends mail and opens pull requests with. Changes are kept in the audit log.') }}
      </ATypographyText>
    </div>

    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The settings could not be loaded.')">
      <template #action>
        <AButton size="small" @click="load">
          {{ $gettext('Retry') }}
        </AButton>
      </template>
    </AAlert>

    <AFlex v-else vertical gap="middle">
      <ACard :title="$gettext('Announcements')" :loading="loading">
        <template #extra>
          <AButton type="primary" size="small" @click="startCreate">
            <span class="i-tabler-plus" />{{ $gettext('New announcement') }}
          </AButton>
        </template>
        <ATypographyParagraph type="secondary" class="text-3">
          {{ $gettext('Shown on My plugins, the newest five first, in the language of the portal or else in English.') }}
        </ATypographyParagraph>
        <AEmpty v-if="!data?.announcements.length" :description="$gettext('No announcements.')" />
        <div v-for="item in data?.announcements ?? []" :key="item.id" class="row">
          <div class="min-w-0 flex-1">
            <div class="font-500">
              {{ inPortalLanguage(item.title) }}
            </div>
            <div class="text-3 op-65">
              {{ inPortalLanguage(item.text) }}
            </div>
            <div class="text-3 op-50 mt-1">
              {{ formatDay(item.date) }}<template v-if="!item.title.zh_CN || !item.text.zh_CN">
                {{ $gettext(', no Chinese version') }}
              </template>
            </div>
          </div>
          <AFlex gap="small">
            <AButton size="small" @click="startEdit(item)">
              {{ $gettext('Edit') }}
            </AButton>
            <APopconfirm :title="$gettext('Remove this announcement?')" :ok-text="$gettext('Remove')" :cancel-text="$gettext('Cancel')" @confirm="removeAnnouncement(item)">
              <AButton size="small" danger>
                {{ $gettext('Remove') }}
              </AButton>
            </APopconfirm>
          </AFlex>
        </div>
      </ACard>

      <div class="below-row">
        <ACard :title="$gettext('Mail service')" :loading="loading">
          <template v-if="data" #extra>
            <ATag :color="status(data.mail.active).color" class="m-0">
              {{ status(data.mail.active).text }}
            </ATag>
          </template>
          <ATypographyParagraph type="secondary" class="text-3">
            {{ $gettext('Authors who turn on email get mail about the progress of their changes.') }}
          </ATypographyParagraph>
          <AForm layout="vertical">
            <AFormItem :label="$gettext('Send through')">
              <ASegmented v-model:value="mail.kind" :options="[{ value: 'http', label: $gettext('HTTP API') }, { value: 'smtp', label: 'SMTP' }]" />
            </AFormItem>
            <template v-if="mail.kind === 'http'">
              <AFormItem :label="$gettext('Address')" required :extra="$gettext('The API takes from, to, subject and text as JSON with a bearer key, as Resend and similar services do.')">
                <AInput v-model:value="mail.url" class="mono" placeholder="https://api.resend.com/emails" />
              </AFormItem>
              <AFormItem :label="$gettext('API key')" required :extra="$gettext('Kept encrypted and never sent to a browser.')">
                <AInputPassword v-model:value="mail.key" :placeholder="data?.mail.kind === 'http' && data.mail.keySet ? $gettext('Saved, can only be replaced') : ''" autocomplete="off" />
              </AFormItem>
            </template>
            <template v-else>
              <AFlex gap="small">
                <AFormItem :label="$gettext('Server')" required class="flex-1">
                  <AInput v-model:value="mail.host" class="mono" placeholder="smtp.example.com" />
                </AFormItem>
                <AFormItem :label="$gettext('Port')" required class="w-28">
                  <AAutoComplete v-model:value="portText" :options="[{ value: '465' }, { value: '587' }]" class="mono" />
                </AFormItem>
              </AFlex>
              <div class="text-3 op-65 smtp-note">
                {{ mail.port === 465 ? $gettext('Port 465 is encrypted with TLS from the start.') : $gettext('The connection is encrypted with STARTTLS before signing in; a server without it is refused. Port 25 cannot be used.') }}
              </div>
              <AFormItem :label="$gettext('Account')" :extra="$gettext('Leave empty for a server that takes mail without signing in.')">
                <AInput v-model:value="mail.user" autocomplete="off" />
              </AFormItem>
              <AFormItem v-if="mail.user" :label="$gettext('Password')" required :extra="$gettext('Kept encrypted and never sent to a browser. Gmail and many company mail services need an app password.')">
                <AInputPassword v-model:value="mail.password" :placeholder="data?.mail.kind === 'smtp' && data.mail.passwordSet && mail.user === data.mail.user ? $gettext('Saved, can only be replaced') : ''" autocomplete="new-password" />
              </AFormItem>
            </template>
            <AFormItem :label="$gettext('Sender')" required>
              <AInput v-model:value="mail.from" placeholder="Nginx UI <portal@nginxui.com>" />
            </AFormItem>
            <AAlert v-if="mailError" type="error" show-icon class="mb-3" :title="mailError" />
            <AFlex gap="small">
              <AButton type="primary" :loading="mailSaving" @click="submitMail">
                {{ $gettext('Save') }}
              </AButton>
              <APopconfirm v-if="data?.mail.active === 'settings'" :title="$gettext('Remove the mail service settings?')" :ok-text="$gettext('Remove')" :cancel-text="$gettext('Cancel')" @confirm="removeMail">
                <AButton danger>
                  {{ $gettext('Remove') }}
                </AButton>
              </APopconfirm>
            </AFlex>
          </AForm>
          <template v-if="data?.mail.active">
            <ADivider class="my-4" />
            <div class="text-3 mb-2">
              {{ $gettext('Send a test mail') }}
            </div>
            <AFlex gap="small">
              <AInput v-model:value="testTo" :placeholder="$gettext('Email address')" @press-enter="sendTest" />
              <AButton :loading="testing" :disabled="!testTo.trim()" @click="sendTest">
                {{ $gettext('Send') }}
              </AButton>
            </AFlex>
            <div v-if="testResult" class="text-3 mt-2" :class="testResult.ok ? 'c-ok' : 'c-err'">
              {{ testResult.text }}
            </div>
          </template>
        </ACard>

        <ACard :title="$gettext('Bot account')" :loading="loading">
          <template v-if="data" #extra>
            <ATag :color="status(data.bot.active).color" class="m-0">
              {{ status(data.bot.active).text }}
            </ATag>
          </template>
          <ATypographyParagraph type="secondary" class="text-3">
            {{ $gettext('When authors send store changes through the bot, it opens a pull request on their repository from a fork of its own, and the author merges it. The token needs the public_repo scope.') }}
          </ATypographyParagraph>
          <AForm layout="vertical">
            <AFormItem :label="$gettext('GitHub account')" required>
              <AInput v-model:value="bot.login" placeholder="nginxui-bot" />
            </AFormItem>
            <AFormItem :label="$gettext('Access token')" required :extra="$gettext('Kept encrypted and never sent to a browser.')">
              <AInputPassword v-model:value="bot.token" :placeholder="data?.bot.tokenSet ? $gettext('Saved, can only be replaced') : ''" autocomplete="off" />
            </AFormItem>
            <AAlert v-if="botError" type="error" show-icon class="mb-3" :title="botError" />
            <AFlex gap="small">
              <AButton type="primary" :loading="botSaving" @click="submitBot">
                {{ $gettext('Save') }}
              </AButton>
              <APopconfirm v-if="data?.bot.tokenSet" :title="$gettext('Remove the bot account settings?')" :ok-text="$gettext('Remove')" :cancel-text="$gettext('Cancel')" @confirm="removeBot">
                <AButton danger>
                  {{ $gettext('Remove') }}
                </AButton>
              </APopconfirm>
            </AFlex>
          </AForm>
        </ACard>
      </div>
    </AFlex>

    <AModal :open="!!editing" :title="editing?.id ? $gettext('Edit the announcement') : $gettext('New announcement')" :confirm-loading="announcementSaving" :ok-text="$gettext('Publish')" :cancel-text="$gettext('Cancel')" @ok="saveAnnouncement" @cancel="editing = null">
      <AForm v-if="editing" layout="vertical">
        <AFormItem :label="$gettext('Date')" required>
          <AInput v-model:value="editing.date" type="date" />
        </AFormItem>
        <AFormItem :label="$gettext('Title in English')" required>
          <AInput v-model:value="editing.title.en" :maxlength="80" show-count />
        </AFormItem>
        <AFormItem :label="$gettext('Text in English')" required>
          <ATextarea v-model:value="editing.text.en" :maxlength="400" show-count :rows="3" />
        </AFormItem>
        <AFormItem :label="$gettext('Title in Simplified Chinese')">
          <AInput v-model:value="editing.title.zh_CN" :maxlength="80" show-count />
        </AFormItem>
        <AFormItem :label="$gettext('Text in Simplified Chinese')" :extra="$gettext('Without a Chinese version, the English shows.')">
          <ATextarea v-model:value="editing.text.zh_CN" :maxlength="400" show-count :rows="3" />
        </AFormItem>
      </AForm>
      <AAlert v-if="announcementError" type="error" show-icon :title="announcementError" />
    </AModal>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--portal-border);
}

.smtp-note {
  margin: -16px 0 16px;
}

.c-ok {
  color: var(--portal-ok-text);
}

.c-err {
  color: var(--portal-err-text);
}
</style>
