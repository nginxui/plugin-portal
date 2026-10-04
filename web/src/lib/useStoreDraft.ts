import type { StoreSourceKind, StoreState } from '@/api/store'
import type { PreviewDoc } from '@/components/MarketPreview.vue'
import { useDebounceFn } from '@vueuse/core'
import { computed, ref } from 'vue'
import { discardDraft, getStore, saveDraft } from '@/api/store'
import { diffDoc } from './storeDiff'

// The user's draft of a plugin's store texts, shared by the store editor, the
// screenshot studio and the translation workbench. Every edit is saved as a
// draft shortly after it is made.
export function useStoreDraft(pluginId: () => string) {
  const state = ref<StoreState | null>(null)
  const failed = ref(false)
  const doc = ref<PreviewDoc>({})
  const readme = ref<string | null>(null)
  const readmeChanged = ref(false)
  const source = ref<Exclude<StoreSourceKind, 'release'>>('repo-branch')
  const savedAt = ref<number | null>(null)
  const problems = ref<string[]>([])
  const saving = ref(false)
  // Texts an AI drafted that no one confirmed yet, as key.locale.
  const ai = ref<string[]>([])

  async function load() {
    try {
      const s = await getStore(pluginId())
      state.value = s
      doc.value = structuredClone(s.draft?.doc ?? s.doc)
      readme.value = s.draft?.readme ?? s.readme
      readmeChanged.value = s.draft?.readme !== undefined && s.draft?.readme !== null
      source.value = s.draft?.source ?? (s.source === 'release' ? 'repo-branch' : s.source)
      savedAt.value = s.draft?.updatedAt ?? null
      ai.value = s.draft?.ai ?? []
      failed.value = false
    }
    catch {
      failed.value = true
    }
  }

  const sourceChanged = computed(() => !!state.value && source.value !== state.value.source)
  const items = computed(() => state.value ? diffDoc(state.value.doc, doc.value) : [])
  const dirty = computed(() => items.value.length > 0 || readmeChanged.value || sourceChanged.value)

  const persist = useDebounceFn(async () => {
    if (!state.value?.canEdit.texts)
      return
    saving.value = true
    try {
      const result = await saveDraft(pluginId(), {
        doc: doc.value,
        ...(readmeChanged.value ? { readme: readme.value } : {}),
        ...(sourceChanged.value ? { source: source.value } : {}),
        ...(ai.value.length ? { ai: ai.value } : {}),
      })
      problems.value = result.problems
      savedAt.value = Math.floor(Date.now() / 1000)
    }
    finally {
      saving.value = false
    }
  }, 700)

  function update(next: PreviewDoc) {
    doc.value = next
    persist()
  }

  /**
   * Sets one text in one language; an empty value removes it. A text an AI
   * drafted stays unconfirmed until it is set again by hand.
   */
  function setText(key: string, locale: string, value: string, drafted = false) {
    const id = `${key}.${locale}`
    ai.value = drafted && value ? [...new Set([...ai.value, id])] : ai.value.filter(k => k !== id)
    const next = structuredClone(doc.value)
    const set = (target: Record<string, string> | undefined) => {
      const out = { ...(target ?? {}) }
      if (value)
        out[locale] = value
      else
        delete out[locale]
      return Object.keys(out).length ? out : undefined
    }
    if (key === 'name' || key === 'description') {
      next[key] = set(next[key])
    }
    else if (key === 'homepage_url') {
      next.homepage_url = value || undefined
    }
    else if (key.startsWith('caption:')) {
      next.screenshots = next.screenshots?.map(s => s.id === key.slice(8) ? { ...s, caption: set(s.caption) } : s)
    }
    else if (key.startsWith('reason:')) {
      const permission = key.slice(7)
      const reasons = { ...next.permission_reasons }
      const texts = set(reasons[permission])
      if (texts)
        reasons[permission] = texts
      else
        delete reasons[permission]
      next.permission_reasons = Object.keys(reasons).length ? reasons : undefined
    }
    update(next)
  }

  function setReadme(value: string) {
    readme.value = value
    readmeChanged.value = true
    persist()
  }

  async function discard() {
    await discardDraft(pluginId())
    await load()
  }

  /** Confirms an AI draft as it is. */
  function confirm(key: string, locale: string) {
    ai.value = ai.value.filter(k => k !== `${key}.${locale}`)
    persist()
  }

  return { ai, confirm, state, failed, doc, readme, readmeChanged, source, sourceChanged, items, dirty, savedAt, saving, problems, load, persist, update, setText, setReadme, discard }
}
