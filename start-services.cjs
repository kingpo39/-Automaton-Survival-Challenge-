const { spawn } = require('child_process');
const path = require('path');

const root = 'D:\\crewai_projects\\.freebuff';

console.log('Starting dashboard server...');
const dashboard = spawn('node', ['--import', 'tsx', 'src/dashboard-server.ts'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
dashboard.stdout.pipe(process.stdout);
dashboard.stderr.pipe(process.stderr);
console.log('Dashboard PID:', dashboard.pid);
dashboard.unref();

setTimeout(() => {
  console.log('Starting agent...');
  const agent = spawn('node', ['--import', 'tsx', 'src/index.ts', '--run'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agent.stdout.pipe(process.stdout);
  agent.stderr.pipe(process.stderr);
  console.log('Agent PID:', agent.pid);
  agent.unref();
  console.log('Both services started!');
}, 3000);
