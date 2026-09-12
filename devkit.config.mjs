/**
 * What devkit cannot derive about this repo: its ports, migration table, local configuration, and
 * the environment its dev servers read. Shared checkout naming, databases, proxying, and baseline
 * mechanics live in @ryanewen/devkit.
 *
 * Counterpart: `scripts/dev/run-dev.mjs`, the only caller of `preflight()`.
 */
/** Fixed listeners inside every checkout container; Compose receives these through `env()`. */
export const DEV_PORTS = Object.freeze({
  api: '4000',
  web: '5173'
})

export default {
  /** Web is first because the proxy routes to the first port in each checkout's derived block. */
  ports: ['web'],

  /** Pin the PostgreSQL server version this project expects. */
  database: { engine: 'postgres', version: '16.13-bookworm' },

  /** Prisma migration history lets doctor and baseline refresh compare schema state. */
  migrationsTable: '_prisma_migrations',

  /** Persistent has no checkout-local runtime files that need to travel with a database snapshot. */
  baselinePaths: [],

  /** A linked worktree needs the primary checkout's ignored local configuration on first start. */
  worktreeFiles: ['.env'],

  /** Open the proxied UI only after its API is ready to serve the application. */
  browser: { path: '/', healthPath: '/api/health' },

  /**
   * CLIENT_ORIGIN is the proxied origin the browser uses, which also makes its hostname the
   * WebAuthn relying-party id. Devkit itself supplies the host bind and allowed-host values.
   */
  env: ({ url }) => ({
    API_PORT: DEV_PORTS.api,
    CLIENT_ORIGIN: url,
    VITE_DEV_PORT: DEV_PORTS.web,
    VITE_API_PORT: DEV_PORTS.api
  })
}
