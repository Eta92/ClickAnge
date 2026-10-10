// pm2 process definition for production — `npm run prod` (see package.json).
// pm2 restarts the server whenever it exits, so a crash no longer stops the
// auto-close checks and email queue until someone touches a file (nodemon's behaviour).
module.exports = {
  apps: [
    {
      name: 'clickange',
      script: 'app.ts',
      // dotenv/config reads .env from the working directory
      cwd: __dirname,
      node_args: '-r ts-node/register',
      // the in-memory caches (offers, bookings) need a single instance
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // back off when it crashes repeatedly (e.g. Mongo down at boot) instead of looping
      exp_backoff_restart_delay: 1000,
      // a restart within this window of starting counts as unstable
      min_uptime: '10s',
      max_restarts: 50,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
