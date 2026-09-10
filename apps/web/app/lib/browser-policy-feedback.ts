import { createBrowserPolicy } from '@common-arcade/studio'

export const { feedback: transitionFeedback } = createBrowserPolicy()
export type BrowserFeedback = ReturnType<typeof transitionFeedback>
