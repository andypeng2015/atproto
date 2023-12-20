import express from 'express'
import http from 'http'
import { AddressInfo } from 'net'
import events from 'events'
import { createHttpTerminator, HttpTerminator } from 'http-terminator'
import cors from 'cors'
import compression from 'compression'
import { IdResolver } from '@atproto/identity'
import API, { health, wellKnown } from './api'
import * as error from './error'
import { dbLogger, loggerMiddleware } from './logger'
import { ServerConfig } from './config'
import { createServer } from './lexicon'
import { createServices } from './services'
import AppContext from './context'
import { BackgroundQueue } from './background'
import { AtpAgent } from '@atproto/api'
import { Keypair } from '@atproto/crypto'
import Database from './db'
import * as auth from './auth'

export type { ServerConfigValues } from './config'
export { ServerConfig } from './config'
export { Database } from './db'
export { PeriodicModerationEventReversal } from './db/periodic-moderation-event-reversal'
export { AppContext } from './context'

export class OzoneService {
  public ctx: AppContext
  public app: express.Application
  public server?: http.Server
  private terminator?: HttpTerminator
  private dbStatsInterval: NodeJS.Timer

  constructor(opts: { ctx: AppContext; app: express.Application }) {
    this.ctx = opts.ctx
    this.app = opts.app
  }

  static create(opts: {
    db: Database
    config: ServerConfig
    signingKey: Keypair
  }): OzoneService {
    const { db, config, signingKey } = opts
    const app = express()
    app.set('trust proxy', true)
    app.use(cors())
    app.use(loggerMiddleware)
    app.use(compression())

    const idResolver = new IdResolver({
      plcUrl: config.didPlcUrl,
      backupNameservers: config.handleResolveNameservers,
    })

    const backgroundQueue = new BackgroundQueue(db)
    const appviewAgent = new AtpAgent({ service: config.appviewUrl })

    appviewAgent.api.setHeader(
      'authorization',
      auth.buildBasicAuth('admin', config.adminPassword),
    )

    const services = createServices(appviewAgent)

    const ctx = new AppContext({
      db,
      cfg: config,
      appviewAgent,
      services,
      signingKey,
      idResolver,
      backgroundQueue,
    })

    let server = createServer({
      validateResponse: config.debugMode,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024, // 5mb
      },
    })

    server = API(server, ctx)

    app.use(health.createRouter(ctx))
    app.use(wellKnown.createRouter(ctx))
    app.use(server.xrpc.router)
    app.use(error.handler)

    return new OzoneService({ ctx, app })
  }

  async start(): Promise<http.Server> {
    const { db, backgroundQueue } = this.ctx
    this.dbStatsInterval = setInterval(() => {
      dbLogger.info(
        {
          idleCount: db.pool.idleCount,
          totalCount: db.pool.totalCount,
          waitingCount: db.pool.waitingCount,
        },
        'db pool stats',
      )
      dbLogger.info(
        {
          runningCount: backgroundQueue.queue.pending,
          waitingCount: backgroundQueue.queue.size,
        },
        'background queue stats',
      )
    }, 10000)
    const server = this.app.listen(this.ctx.cfg.port)
    this.server = server
    server.keepAliveTimeout = 90000
    this.terminator = createHttpTerminator({ server })
    await events.once(server, 'listening')
    const { port } = server.address() as AddressInfo
    this.ctx.cfg.assignPort(port)
    return server
  }

  async destroy(): Promise<void> {
    await this.terminator?.terminate()
    await this.ctx.backgroundQueue.destroy()
    await this.ctx.db.close()
    clearInterval(this.dbStatsInterval)
  }
}

export default OzoneService