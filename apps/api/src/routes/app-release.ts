/**
 * Retired direct-flavor updater endpoint. Old bundled clients still call it, so
 * retain the null response instead of offering the Play APK, whose package and
 * signer cannot update a ca.persistent.app installation. New installs use Play.
 * This compatibility response is public and contains no user data.
 */
import { Router } from 'express'

export const appReleaseRouter = Router()

appReleaseRouter.get('/latest-release', (_request, response) => {
  response.json(null)
})
