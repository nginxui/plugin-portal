import antfu from '@antfu/eslint-config'

export default antfu({
  vue: true,
  typescript: true,
  ignores: ['components.d.ts', 'worker/worker-configuration.d.ts', 'migrations/**'],
})
