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

/** How long ago, without the suffix, for a "waiting" column. */
export function waited(value: number | null | undefined): string {
  if (!value)
    return ''
  return dayjs.unix(value).locale(locale()).fromNow(true)
}

/** A short date and time, such as "Oct 3 14:20". */
export function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined)
    return ''
  const time = typeof value === 'number' ? dayjs.unix(value) : dayjs(value)
  return time.locale(locale()).format(locale() === 'zh-cn' ? 'M月D日 HH:mm' : 'MMM D HH:mm')
}
