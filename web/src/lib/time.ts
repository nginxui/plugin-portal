import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import gettext from './gettext'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)

function locale() {
  return gettext.current === 'zh_CN' ? 'zh-cn' : 'en'
}

export function fromNow(value: string | number | null | undefined): string {
  if (value === null || value === undefined)
    return ''
  const time = typeof value === 'number' ? dayjs.unix(value) : dayjs(value)
  return time.locale(locale()).fromNow()
}

export function formatDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined)
    return ''
  const time = typeof value === 'number' ? dayjs.unix(value) : dayjs(value)
  return time.format('YYYY-MM-DD')
}
