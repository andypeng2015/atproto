import { CID } from 'multiformats/cid'
import { AtUri } from '@atproto/syntax'
import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import {
  isRepoRef,
  isRepoBlobRef,
} from '../../../../lexicon/types/com/atproto/admin/defs'
import { isMain as isStrongRef } from '../../../../lexicon/types/com/atproto/repo/strongRef'
import { AuthRequiredError, InvalidRequestError } from '@atproto/xrpc-server'

export default function (server: Server, ctx: AppContext) {
  server.com.atproto.admin.updateSubjectStatus({
    auth: ctx.authVerifier.roleOrAdminService,
    handler: async ({ input, auth }) => {
      const access = auth.credentials
      // if less than moderator access then cannot perform a takedown
      if (!access.moderator) {
        throw new AuthRequiredError(
          'Must be a full moderator to update subject state',
        )
      }
      const { subject, takedown } = input.body
      if (takedown) {
        if (isRepoRef(subject)) {
          await Promise.all([
            ctx.services
              .account(ctx.db)
              .updateAccountTakedownStatus(subject.did, takedown),
            ctx.services.auth(ctx.db).revokeRefreshTokensByDid(subject.did),
          ])
        } else if (isStrongRef(subject)) {
          const uri = new AtUri(subject.uri)
          await ctx.actorStore.transact(uri.hostname, (store) =>
            store.record.updateRecordTakedownStatus(uri, takedown),
          )
        } else if (isRepoBlobRef(subject)) {
          await ctx.actorStore.transact(subject.did, (store) =>
            store.repo.blob.updateBlobTakedownStatus(
              CID.parse(subject.cid),
              takedown,
            ),
          )
        } else {
          throw new InvalidRequestError('Invalid subject')
        }
      }
      return {
        encoding: 'application/json',
        body: {
          subject,
          takedown,
        },
      }
    },
  })
}
