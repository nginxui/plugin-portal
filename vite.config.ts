import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { AntdvNextResolver } from '@antdv-next/auto-import-resolver'
import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { po } from 'gettext-parser'
import UnoCSS from 'unocss/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

// Turns a gettext catalog into { msgid: msgstr }, leaving out untranslated
// and fuzzy entries so they fall back to the English source.
function gettextCatalogs(): Plugin {
  return {
    name: 'portal-gettext',
    async load(id) {
      if (!id.endsWith('.po'))
        return null
      const parsed = po.parse(await readFile(id))
      const messages: Record<string, string> = {}
      for (const context of Object.values(parsed.translations)) {
        for (const [msgid, entry] of Object.entries(context)) {
          if (!msgid || !entry.msgstr[0] || entry.comments?.flag?.includes('fuzzy'))
            continue
          messages[msgid] = entry.msgstr[0]
        }
      }
      return `export default ${JSON.stringify(messages)}`
    },
  }
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
  },
  plugins: [
    vue(),
    UnoCSS(),
    Components({
      dirs: ['web/src/components'],
      resolvers: [AntdvNextResolver()],
      dts: 'components.d.ts',
    }),
    gettextCatalogs(),
    cloudflare(),
  ],
})
