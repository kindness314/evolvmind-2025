import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const host = '127.0.0.1';
const port = Number(process.env.API_PORT || 3000);

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

if (!(await isPortFree(port))) {
  console.error(`Port ${port} is already in use. Stop the old local dev server before starting dev:api.`);
  console.error('On Windows, you can inspect it with: netstat -ano | findstr :' + port);
  process.exit(1);
}

const child = spawn(
  'vercel',
  ['dev', '--listen', `${host}:${port}`, '--yes'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
