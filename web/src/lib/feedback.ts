import { App } from 'antdv-next'
import { $gettext } from './gettext'

/** Tells the user an action failed, for actions with no place of their own for the error. */
export function useFailure() {
  const { message } = App.useApp()
  return (text?: string) => {
    message.error(text ?? $gettext('The action could not be completed. Please try again.'))
  }
}
