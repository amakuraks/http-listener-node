import { server } from '../src/server.ts';

/**
 * app.listen() is asynchronous: server.address() returns null until the 'listening'
 * event fires. Reading the port straight away yields 0, and every fetch then fails with
 * EADDRNOTAVAIL against 127.0.0.1:0. Tests must wait for the bind to complete.
 */
export async function baseUrl(): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
  }

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (port === 0) throw new Error('server did not bind to a port');
  return `http://127.0.0.1:${port}`;
}

/** The bound address, once listening. Used by the loopback-binding assertion. */
export async function boundAddress(): Promise<string> {
  await baseUrl();
  const address = server.address();
  return typeof address === 'object' && address ? address.address : '';
}
