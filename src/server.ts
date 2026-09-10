import express from 'express';
import path from 'node:path';
import { config } from './config.ts';
import listenRoutes from './routes/listen.ts';
import requestsRoutes from './routes/requests.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { securityHeaders } from './middleware/securityHeaders.ts';

const app = express();

// VERIFIED: Express sends "x-powered-by: Express" on every response by default,
// advertising the stack for free. Nothing needs it.
app.disable('x-powered-by');

// Applied globally, before any route, so no response can escape it.
app.use(securityHeaders);

app.set('view engine', 'ejs');
app.set('views', path.join(import.meta.dirname, 'views'));

// Mounted under /assets so it can never shadow /listen or /requests.
app.use('/assets', express.static(path.join(import.meta.dirname, 'public')));

app.use(listenRoutes);
app.use(requestsRoutes);

app.get('/', (_req, res) => res.redirect('/requests'));

// Order is load-bearing: 404 catches unmatched routes, then the error handler
// terminates the chain. Both must come after every route.
app.use((_req, res) => {
  res.status(404).render('not-found');
});
app.use(errorHandler);

// Bind to config.host (loopback by default), never every interface.
const server = app.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`Request Tester listening on http://${config.host}:${port}`);
  console.log('  Listener  ANY  /listen/*');
  console.log('  Dashboard GET  /requests');
  if (config.host === '0.0.0.0' || config.host === '::') {
    console.warn('  ! Bound to ALL interfaces with no authentication.');
    console.warn('    Captured Authorization headers are readable by anyone on this network.');
  }
});

export { app, server };
