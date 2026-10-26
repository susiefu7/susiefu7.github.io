// npm run dev -- [--project path]
// Runs the API server (restarting on change) and the Vite dev server together.
import { spawn } from 'node:child_process';

const passthrough = process.argv.slice(2);
const children = [
  spawn('npx', ['tsx', 'watch', 'server/index.ts', ...passthrough], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', stop));
