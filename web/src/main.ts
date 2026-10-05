import { bundledText, setMarketText } from '@nginxui/plugin-market-ui'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import gettext from './lib/gettext'
import { router } from './router'
import '@nginxui/plugin-market-ui/style.css'
import 'virtual:uno.css'
import './style.css'

// Marketplace views follow the interface language unless a preview picks another.
setMarketText((msgid, params) => bundledText(gettext.current)(msgid, params))

createApp(App)
  .use(createPinia())
  .use(gettext)
  .use(router)
  .mount('#app')
