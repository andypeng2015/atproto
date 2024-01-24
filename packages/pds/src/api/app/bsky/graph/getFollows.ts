import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { authPassthru } from '../../../proxy'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.graph.getFollows({
    auth: ctx.authVerifier.accessOrRole,
    handler: async ({ req, params, auth }) => {
      const requester =
        auth.credentials.type === 'access' ? auth.credentials.did : null
      const res = await ctx
        .getAppviewAgent(requester)
        .api.app.bsky.graph.getFollows(
          params,
          requester
            ? await ctx.appviewAuthHeaders(requester)
            : authPassthru(req),
        )
      return {
        encoding: 'application/json',
        body: res.data,
      }
    },
  })
}
