import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.getActorFeeds({
    auth: ctx.authVerifier.access,
    handler: async ({ auth, params }) => {
      const requester = auth.credentials.did
      const res = await ctx
        .getAppviewAgent(requester)
        .api.app.bsky.feed.getActorFeeds(
          params,
          await ctx.appviewAuthHeaders(requester),
        )
      return {
        encoding: 'application/json',
        body: res.data,
      }
    },
  })
}
