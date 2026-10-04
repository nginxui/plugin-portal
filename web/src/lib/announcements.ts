import { $gettext } from './gettext'

// News for authors on My plugins, newest first.
export function announcements() {
  return [
    { date: '2026-10-05', title: $gettext('Store texts in every Nginx UI language'), text: $gettext('Names, descriptions and screenshot captions follow the 14 interface languages of Nginx UI. A language a plugin leaves out shows English.') },
    { date: '2026-10-04', title: $gettext('Name changes are reviewed'), text: $gettext('A changed name in any language goes to review before it is listed.') },
  ]
}
