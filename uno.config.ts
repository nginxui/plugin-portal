import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  content: {
    pipeline: { include: [/\.(vue|ts|html)($|\?)/] },
  },
  presets: [
    presetWind3(),
    presetIcons({
      collections: {
        tabler: () => import('@iconify-json/tabler/icons.json').then(i => i.default),
      },
      extraProperties: { 'display': 'inline-block', 'vertical-align': 'middle' },
    }),
  ],
})
