import { fetchFailureHandler } from '@atproto/fetch'
import { dpopFetchWrapper } from '@atproto/fetch-dpop'
import { JwtPayload, unsafeDecodeJwt } from '@atproto/jwk'
import { OAuthServer, TokenSet } from './oauth-server.js'
import { SessionGetter } from './session-getter.js'

export class OAuthClient {
  readonly dpopFetch: (request: Request) => Promise<Response>

  constructor(
    private readonly server: OAuthServer,
    public readonly sessionId: string,
    private readonly sessionGetter: SessionGetter,
  ) {
    const dpopFetch = dpopFetchWrapper({
      fetch,
      iss: server.clientMetadata.client_id,
      key: server.dpopKey,
      alg: server.dpopAlg,
      sha256: async (v) => server.crypto.sha256(v),
      nonceCache: server.dpopNonceCache,
      isAuthServer: false,
    })

    this.dpopFetch = (request) => dpopFetch(request).catch(fetchFailureHandler)
  }

  /**
   * @param refresh See {@link SessionGetter.getSession}
   */
  async getTokenSet(refresh?: boolean): Promise<TokenSet> {
    const { tokenSet } = await this.sessionGetter.getSession(
      this.sessionId,
      refresh,
    )
    return tokenSet
  }

  async getUserinfo(): Promise<{
    userinfo?: JwtPayload
    expired?: boolean
    scope?: string
    iss: string
    aud: string
    sub: string
  }> {
    const tokenSet = await this.getTokenSet()

    return {
      userinfo: tokenSet.id_token
        ? unsafeDecodeJwt(tokenSet.id_token).payload
        : undefined,
      expired:
        tokenSet.expires_at == null
          ? undefined
          : new Date(tokenSet.expires_at).getTime() < Date.now() - 5e3,
      scope: tokenSet.scope,
      iss: tokenSet.iss,
      aud: tokenSet.aud,
      sub: tokenSet.sub,
    }
  }

  async signOut() {
    try {
      const tokenSet = await this.getTokenSet(false)
      await this.server.revoke(tokenSet.access_token)
    } finally {
      await this.sessionGetter.delStored(this.sessionId)
    }
  }

  async request(
    pathname: string,
    init?: RequestInit,
    refreshCredentials?: boolean,
  ): Promise<Response> {
    const tokenSet = await this.getTokenSet(refreshCredentials)
    const headers = new Headers(init?.headers)
    headers.set(
      'Authorization',
      `${tokenSet.token_type} ${tokenSet.access_token}`,
    )
    const request = new Request(new URL(pathname, tokenSet.aud), {
      ...init,
      headers,
    })

    return this.dpopFetch(request).catch((err) => {
      if (!refreshCredentials && isTokenExpiredError(err)) {
        return this.request(pathname, init, true)
      }

      throw err
    })
  }
}

/**
 * @todo Actually implement this
 */
function isTokenExpiredError(_err: unknown) {
  // TODO: Detect access_token expired 401
  return false
}