const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveBash() {
  if (process.platform !== 'win32') {
    return 'bash';
  }

  const candidates = [
    process.env.GIT_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

const bashPath = resolveBash();
if (!bashPath) {
  console.error(
    'Nie znaleziono bash. Na Windows uruchom Git Bash albo ustaw GIT_BASH. Na serwerze Linux ten skrypt dziala normalnie.'
  );
  process.exit(1);
}

const scriptPath = path.join(__dirname, 'pull-and-build.sh');
const result = spawnSync(bashPath, [scriptPath, ...process.argv.slice(2)], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
