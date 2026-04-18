import { WindowManager } from './WindowManager'

/**
 * Process-wide singleton WindowManager. Importing this directly (rather
 * than reaching into src/main/index.ts) avoids circular imports between
 * the IPC handler modules and the Electron app entry point.
 */
export const windowManager = new WindowManager()

export { WindowManager }
export type { PopoutBounds } from './WindowManager'
