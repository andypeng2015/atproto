'use strict' /* eslint-disable */

require('dd-trace') // Only works with commonjs
  .init({ logInjection: true })
  .tracer.use('express', {
    hooks: {
      request: (span, req) => {
        maintainXrpcResource(span, req)
      },
    },
  })

// Tracer code above must come before anything else
const path = require('path')
const assert = require('assert')
const { CloudfrontInvalidator } = require('@atproto/aws')
const {
  Database,
  ServerConfig,
  BskyAppView,
  ViewMaintainer,
  makeAlgos,
} = require('@atproto/bsky')

const main = async () => {
  const env = getEnv()
  // Migrate using credentialed user
  const migrateDb = Database.postgres({
    url: env.dbMigratePostgresUrl,
    schema: env.dbPostgresSchema,
    poolSize: 2,
  })
  await migrateDb.migrateToLatestOrThrow()
  // Use lower-credentialed user to run the app.
  // Only db primary configured: services all queries, 1 pool.
  // Only db non-primary configured: services any query that doesn't require a primary, 1 pool.
  // Both db primary and non-primary configured: services all queries only using primary when needed, 2 pools.
  // Neither db primary nor non-primary configured: not allowed, wont startup.
  const dbPrimary = env.dbPrimaryPostgresUrl
    ? Database.postgres({
        isPrimary: true,
        url: env.dbPrimaryPostgresUrl,
        schema: env.dbSchema,
        poolSize: env.dbPrimaryPoolSize || env.dbPoolSize,
        poolMaxUses: env.dbPoolMaxUses,
        poolIdleTimeoutMs: env.dbPoolIdleTimeoutMs,
      })
    : undefined
  const db = env.dbPostgresUrl
    ? Database.postgres({
        url: env.dbPostgresUrl,
        schema: env.dbSchema,
        poolSize: env.dbPoolSize,
        poolMaxUses: env.dbPoolMaxUses,
        poolIdleTimeoutMs: env.dbPoolIdleTimeoutMs,
      })
    : dbPrimary
  assert(db, 'missing configuration for db')
  const cfg = ServerConfig.readEnv({
    port: env.port,
    version: env.version,
    repoProvider: env.repoProvider,
    dbPostgresUrl: env.dbPostgresUrl || env.dbPrimaryPostgresUrl,
    dbPrimaryPostgresUrl: env.dbPrimaryPostgresUrl,
    dbPostgresSchema: env.dbPostgresSchema,
    publicUrl: env.publicUrl,
    didPlcUrl: env.didPlcUrl,
    imgUriSalt: env.imgUriSalt,
    imgUriKey: env.imgUriKey,
    imgUriEndpoint: env.imgUriEndpoint,
    blobCacheLocation: env.blobCacheLocation,
  })
  const cfInvalidator = env.cfDistributionId
    ? new CloudfrontInvalidator({
        distributionId: env.cfDistributionId,
        pathPrefix: cfg.imgUriEndpoint && new URL(cfg.imgUriEndpoint).pathname,
      })
    : undefined
  const algos = env.feedPublisherDid ? makeAlgos(env.feedPublisherDid) : {}
  const bsky = BskyAppView.create({
    db,
    dbPrimary: dbPrimary.asPrimary(),
    config: cfg,
    imgInvalidator: cfInvalidator,
    algos,
  })
  const viewMaintainer = new ViewMaintainer(migrateDb)
  const viewMaintainerRunning = viewMaintainer.run()
  await bsky.start()
  // Graceful shutdown (see also https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/)
  process.on('SIGTERM', async () => {
    await bsky.destroy()
    viewMaintainer.destroy()
    await viewMaintainerRunning
    await migrateDb.close()
  })
}

const getEnv = () => ({
  port: parseInt(process.env.PORT),
  version: process.env.BSKY_VERSION,
  repoProvider: process.env.REPO_PROVIDER,
  dbPostgresUrl: process.env.DB_POSTGRES_URL,
  dbMigratePostgresUrl:
    process.env.DB_MIGRATE_POSTGRES_URL || process.env.DB_POSTGRES_URL,
  dbPostgresSchema: process.env.DB_POSTGRES_SCHEMA || undefined,
  dbPoolSize: maybeParseInt(process.env.DB_POOL_SIZE),
  dbPoolMaxUses: maybeParseInt(process.env.DB_POOL_MAX_USES),
  dbPoolIdleTimeoutMs: maybeParseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS),
  dbPrimaryPostgresUrl: process.env.DB_PRIMARY_POSTGRES_URL,
  dbPrimaryPoolSize: maybeParseInt(process.env.DB_PRIMARY_POOL_SIZE),
  publicUrl: process.env.PUBLIC_URL,
  didPlcUrl: process.env.DID_PLC_URL,
  imgUriSalt: process.env.IMG_URI_SALT,
  imgUriKey: process.env.IMG_URI_KEY,
  imgUriEndpoint: process.env.IMG_URI_ENDPOINT,
  blobCacheLocation: process.env.BLOB_CACHE_LOC,
  cfDistributionId: process.env.CF_DISTRIBUTION_ID,
  feedPublisherDid: process.env.FEED_PUBLISHER_DID,
})

const maybeParseInt = (str) => {
  const parsed = parseInt(str)
  return isNaN(parsed) ? undefined : parsed
}

const maintainXrpcResource = (span, req) => {
  // Show actual xrpc method as resource rather than the route pattern
  if (span && req.originalUrl?.startsWith('/xrpc/')) {
    span.setTag(
      'resource.name',
      [
        req.method,
        path.posix.join(req.baseUrl || '', req.path || '', '/').slice(0, -1), // Ensures no trailing slash
      ]
        .filter(Boolean)
        .join(' '),
    )
  }
}

main()
