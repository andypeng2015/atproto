import { AtpAgent } from '@atproto/api'
import { IdResolver } from '@atproto/identity'

import { BsyncClient } from '../bsync.js'
import { ServerConfig } from '../config.js'
import { DataPlaneClient } from '../data-plane/index.js'
import { FeatureGates } from '../feature-gates.js'
import { ParsedLabelers } from '../util.js'
import { Views } from '../views/index.js'
import { Hydrator } from './hydrator.js'

export class HydrateCtx {
  labelers = this.vals.labelers
  viewer = this.vals.viewer !== null ? serviceRefToDid(this.vals.viewer) : null
  includeTakedowns = this.vals.includeTakedowns
  include3pBlocks = this.vals.include3pBlocks

  constructor(
    private vals: HydrateCtxVals,
    readonly dataplane: DataPlaneClient,
    readonly hydrator: Hydrator,
    readonly views: Views,
    readonly cfg: ServerConfig,
    readonly featureGates: FeatureGates,
    readonly bsyncClient: BsyncClient,
    readonly idResolver: IdResolver,
    readonly suggestionsAgent: AtpAgent | undefined,
    readonly searchAgent: AtpAgent | undefined,
  ) {}

  copy<V extends Partial<HydrateCtxVals>>(vals?: V): HydrateCtx & V {
    return new HydrateCtx(
      { ...this.vals, ...vals },
      this.dataplane,
      this.hydrator,
      this.views,
      this.cfg,
      this.featureGates,
      this.bsyncClient,
      this.idResolver,
      this.suggestionsAgent,
      this.searchAgent,
    ) as HydrateCtx & V
  }

  /** @deprecated use the context itself instead */
  get hydrateCtx() {
    return this
  }
}

export type HydrateCtxVals = {
  labelers: ParsedLabelers
  viewer: string | null
  includeTakedowns?: boolean
  include3pBlocks?: boolean
}

// service refs may look like "did:plc:example#service_id". we want to extract the did part "did:plc:example".
export function serviceRefToDid(serviceRef: string) {
  const idx = serviceRef.indexOf('#')
  return idx !== -1 ? serviceRef.slice(0, idx) : serviceRef
}
