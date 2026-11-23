'use strict';
/**
 * Ending helper programs, with everything they started.
 * On Windows a plain kill only reaches the first program, so taskkill /T is used.
 * Children that must not outlive the app are tracked here and ended on quit.
 */
const cp = require('child_process');

const tracked = new Set();

/** Ends a process and everything it started (on Windows, a venv python.exe is a launcher). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.killedTree) return;
  child.killedTree = true;
  if (process.platform === 'win32' && child.pid) {
    // the whole tree first: once the launcher is gone, its child can't be found from it
    let k;
    try {
      k = cp.spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (_) {}
    if (k) {
      k.on('error', () => child.kill());
      k.on('exit', () => child.kill());
      return;
    }
  }
  try {
    child.kill();
  } catch (_) {}
}

/** Remembers a child until it exits, so quitting can end it. */
function track(child) {
  if (!child) return child;
  tracked.add(child);
  const done = () => tracked.delete(child);
  child.once('exit', done);
  child.once('error', done);
  return child;
}

/** Ends every tracked child (and what it started). */
function killTracked() {
  for (const c of [...tracked]) killTree(c);
  tracked.clear();
}

/**
 * Ends any program with this name left from a crashed or hung earlier run (Windows only).
 * Waits for it, so the sound cable is free before the next start. Failures are ignored.
 */
function killLeftovers(imageName) {
  if (process.platform !== 'win32') return false;
  try {
    cp.spawnSync('taskkill', ['/IM', imageName, '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 4000 });
  } catch (_) {}
  return true;
}

module.exports = { killTree, track, killTracked, killLeftovers };
