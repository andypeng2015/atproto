import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import {
  authPassthru,
  proxy,
  proxyAppView,
  resultPassthru,
} from '../../../proxy'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.graph.getListMutes({
    auth: ctx.authVerifier.access,
    handler: async ({ params, auth, req }) => {
      const proxied = await proxy(
        ctx,
        auth.credentials.audience,
        async (agent) => {
          const result = await agent.api.app.bsky.graph.getListMutes(
            params,
            authPassthru(req),
          )
          return resultPassthru(result)
        },
      )
      if (proxied !== null) {
        return proxied
      }

      const requester = auth.credentials.did
      const res = await proxyAppView(ctx, async (agent) =>
        agent.api.app.bsky.graph.getListMutes(
          params,
          await ctx.serviceAuthHeaders(requester),
        ),
      )
      return {
        encoding: 'application/json',
        body: res.data,
      }
    },
  })
}