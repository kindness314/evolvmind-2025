import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const host = '127.0.0.1';
const apiPort = Number(process.env.API_PORT || 3000);
const webPort = Number(process.env.WEB_PORT || 5173);

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

const requiredPorts = [apiPort, webPort];
const busyPorts = [];

for (const port of requiredPorts) {
  if (!(await isPortFree(port))) busyPorts.push(port);
}

if (busyPorts.length > 0) {
  console.error(`Required local dev port(s) already in use: ${busyPorts.join(', ')}`);
  console.error('Stop the old local dev server before starting dev:full.');
  console.error('On Windows, inspect a port with: netstat -ano | findstr :<port>');
  process.exit(1);
}

const commands = [
  {
    name: 'api',
    command: 'vercel',
    args: ['dev', '--listen', `${host}:${apiPort}`, '--yes'],
  },
  {
    name: 'web',
    command: 'vite',
    args: ['--host', host, '--port', String(webPort), '--strictPort'],
  },
];

let shuttingDown = false;

const children = commands.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const other of children) {
      if (other !== child && !other.killed) other.kill();
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(`[${name}] failed to start:`, error.message);
  });

  return child;
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`\nEvolvMind local dev is starting:`);
console.log(`- Frontend: http://${host}:${webPort}/`);
console.log(`- API:      http://${host}:${apiPort}/api/*`);
console.log(`\nOpen the frontend URL in your browser. Do not use the Vercel dev frontend URL directly.\n`);
