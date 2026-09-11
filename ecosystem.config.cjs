// PM2 process definition for Request Tester.
//
// Must be .cjs, not .js: package.json sets "type": "module" and PM2 loads
// ecosystem files with require(), so a .js file fails to load.
//
//   pm2 start ecosystem.config.cjs
//   pm2 logs request-tester
//   pm2 stop request-tester

module.exports = {
  apps: [
    {
      name: 'request-tester',

      // PM2 7 runs .ts directly on Node >= 22.18 via native type stripping.
      // No ts-node, no build step, no dist/.
      script: 'src/server.ts',

      // REQUIRED. PM2 does not read .env itself, and the app reads its config
      // purely from process.env. Without this it exits immediately with
      // "Missing required environment variable: DATABASE_HOST".
      // Credentials stay in .env (gitignored) rather than in this committed file.
      node_args: ['--env-file=.env'],

      // Single process. Cluster mode would work (all state is in the database),
      // but each instance opens its own pool of 5 connections, for a tool
      // serving one developer's test traffic.
      instances: 1,
      exec_mode: 'fork',

      // --- Restart behaviour ---
      autorestart: true,

      // Crash-loop protection. If the database is unreachable or .env is missing,
      // the app exits at startup by design (src/config.ts fails fast). Without
      // these three, PM2 would restart it forever at full speed and bury the real
      // error in log noise.
      min_uptime: '10s', // shorter than this counts as a failed start
      max_restarts: 10, // then give up and stay stopped
      restart_delay: 4000, // breathing room for the database to come back

      // A 50mb capture spikes memory while it is encoded and stored.
      max_memory_restart: '500M',

      // MUST exceed the 5s escape hatch in the shutdown handler (src/server.ts).
      // PM2's default is 1600ms, which would kill the process mid-shutdown and
      // leak a database connection on every restart.
      //
      // WINDOWS CAVEAT (verified): PM2 hard-terminates on Windows rather than
      // delivering SIGINT/SIGTERM, so the shutdown handler does NOT run there and
      // this value has no effect. It matters on Linux/macOS, which is where this
      // would actually be deployed. Left in deliberately.
      kill_timeout: 6000,

      // --- Logs ---
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true, // timestamp every line

      // Never enable watch here. Use `npm run dev` for development; watch mode
      // would restart on log writes.
      watch: false,
    },
  ],
};
