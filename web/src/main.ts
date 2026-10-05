import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import gettext from './lib/gettext'
import { router } from './router'
import '@nginxui/plugin-market-ui/style.css'
import 'virtual:uno.css'
import './style.css'

createApp(App)
  .use(createPinia())
  .use(gettext)
  .use(router)
  .mount('#app')
