'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { UUID_RE } = require('./codex-session-manifest');

const WORKER_START_TOLERANCE_MS = 5 * 60 * 1000;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function listCodexProcesses(spawnSyncImpl = spawnSync) {
  if (process.platform !== 'win32') return [];
  const command = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$items=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'codex.exe' -or $_.Name -eq 'node.exe' } | ForEach-Object { $commandBytes=[Text.Encoding]::UTF8.GetBytes([string]$_.CommandLine); [pscustomobject]@{ name=$_.Name; pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; commandLineBase64=[Convert]::ToBase64String($commandBytes); createdAt=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null} } }",
    '@($items) | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawnSyncImpl('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !String(result.stdout || '').trim()) {
    const error = new Error(`Codex process inventory failed (${result.error?.code || result.status || 'empty_output'})`);
    error.cause = result.error || null;
    throw error;
  }
  try {
    const parsed = JSON.parse(String(result.stdout).trim());
    return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
      name: String(item?.name || '').toLowerCase(),
      pid: Number(item?.pid),
      parentPid: Number(item?.parentPid),
      commandLine: item?.commandLineBase64
        ? Buffer.from(String(item.commandLineBase64), 'base64').toString('utf8')
        : String(item?.commandLine || ''),
      createdAt: item?.createdAt ? String(item.createdAt) : null,
    })).filter(item => Number.isInteger(item.pid) && item.pid > 0);
  } catch (error) {
    throw new Error(`Codex process inventory was not valid JSON: ${error.message}`);
  }
}

function normalizedCommandLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isHeadlessCodexExecCommand(commandLine) {
  const command = normalizedCommandLine(commandLine);
  return /(?:^| )exec(?: |$)/.test(command)
    && /(?:^| )--json(?: |$)/.test(command)
    && (command.includes('codex') || command.includes('@openai'));
}

function commandContainsSession(commandLine, sessionId) {
  return UUID_RE.test(String(sessionId || ''))
    && normalizedCommandLine(commandLine).includes(String(sessionId).toLowerCase());
}

function isCodexSessionOwnerCommand(commandLine) {
  const command = normalizedCommandLine(commandLine);
  if (!command || !(command.includes('codex') || command.includes('@openai'))) return false;
  return /(?:^| )resume(?: |$)/.test(command);
}

function isInteractiveCodexResumeCommand(commandLine) {
  const command = normalizedCommandLine(commandLine);
  return isCodexSessionOwnerCommand(command)
    && !isHeadlessCodexExecCommand(command)
    && !/(?:^| )app-server(?: |$)/.test(command);
}

function readWorkerThreadId(filePath, maxBytes = 2 * 1024 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(handle, buffer, 0, length, 0);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.includes('thread.started')) continue;
      try {
        const event = JSON.parse(line);
        const threadId = event?.thread_id || event?.threadId || event?.thread?.id;
        if (UUID_RE.test(String(threadId || ''))) return threadId;
      } catch {}
    }
  } catch {
    return null;
  } finally {
    if (handle != null) try { fs.closeSync(handle); } catch {}
  }
  return null;
}

function workerStdoutPath(entry) {
  return entry?.lastWorkerStdoutPath
    || entry?.workerStdoutPath
    || entry?.workerJsonPath
    || null;
}

function startTimeMatches(processInfo, entry, toleranceMs = WORKER_START_TOLERANCE_MS) {
  const processStarted = Date.parse(processInfo?.createdAt || '');
  const workerStarted = Date.parse(entry?.lastWorkerStartedAt || '');
  return Number.isFinite(processStarted)
    && Number.isFinite(workerStarted)
    && Math.abs(processStarted - workerStarted) <= toleranceMs;
}

function findOwnedHeadlessWorker(entry, options = {}) {
  const sessionId = String(entry?.sessionId || '');
  if (!UUID_RE.test(sessionId)) return null;
  const listProcesses = options.listProcesses || listCodexProcesses;
  const readThreadId = options.readWorkerThreadId || readWorkerThreadId;
  const processes = listProcesses();
  const recordedPids = new Set([
    Number(entry?.lastWorkerPid),
    Number(entry?.lastWorkerNativePid),
  ].filter(pid => Number.isInteger(pid) && pid > 0));
  const loggedThreadId = readThreadId(workerStdoutPath(entry));
  const headless = processes.filter(processInfo => isHeadlessCodexExecCommand(processInfo.commandLine));
  const directlyOwned = headless.filter(processInfo => {
    if (commandContainsSession(processInfo.commandLine, sessionId)) return true;
    return recordedPids.has(processInfo.pid)
      && loggedThreadId === sessionId
      && startTimeMatches(processInfo, entry, options.startToleranceMs);
  });
  if (!directlyOwned.length) return null;

  const directlyOwnedPids = new Set(directlyOwned.map(item => item.pid));
  const roots = directlyOwned.filter(item => !directlyOwnedPids.has(item.parentPid));
  if (roots.length !== 1) {
    const pids = roots.map(item => item.pid).sort((a, b) => a - b).join(', ');
    throw new Error(`Refusing terminal takeover: multiple owned headless roots matched ${sessionId}: ${pids}`);
  }
  // A newly-created `codex exec --json /goal ...` worker does not carry the
  // UUID in its command line. The manifest records its wrapper PID and the
  // worker JSONL proves the UUID; include only exact descendants of that
  // proven wrapper so the native codex.exe is part of the same owner record.
  const ownedPids = new Set(directlyOwned.map(item => item.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of headless) {
      if (!ownedPids.has(processInfo.pid) && ownedPids.has(processInfo.parentPid)) {
        ownedPids.add(processInfo.pid);
        changed = true;
      }
    }
  }
  const owned = headless.filter(item => ownedPids.has(item.pid));
  const proof = directlyOwned.some(item => commandContainsSession(item.commandLine, sessionId))
    ? 'session_uuid_commandline'
    : 'manifest_pid_worker_jsonl';
  return {
    sessionId,
    rootPid: roots[0].pid,
    pids: owned.map(item => item.pid).sort((a, b) => a - b),
    proof,
  };
}

function findRunningCodexSessionPid(sessionId, options = {}) {
  if (!UUID_RE.test(String(sessionId || ''))) return null;
  const listProcesses = options.listProcesses || listCodexProcesses;
  const matches = listProcesses().filter(item => (
    commandContainsSession(item.commandLine, sessionId)
    && isCodexSessionOwnerCommand(item.commandLine)
  ));
  return (matches.find(item => item.name === 'codex.exe') || matches[0] || {}).pid || null;
}

function findInteractiveCodexSessionOwner(sessionId, options = {}) {
  if (!UUID_RE.test(String(sessionId || ''))) return null;
  const listProcesses = options.listProcesses || listCodexProcesses;
  const matches = listProcesses().filter(item => (
    commandContainsSession(item.commandLine, sessionId)
    && isInteractiveCodexResumeCommand(item.commandLine)
  ));
  if (!matches.length) return null;
  const matchedPids = new Set(matches.map(item => item.pid));
  const roots = matches.filter(item => !matchedPids.has(item.parentPid));
  if (roots.length !== 1) {
    const pids = roots.map(item => item.pid).sort((a, b) => a - b).join(', ');
    throw new Error(`Multiple interactive Codex roots matched ${sessionId}: ${pids}`);
  }
  const root = roots[0];
  const native = matches.find(item => item.name === 'codex.exe') || null;
  return {
    sessionId: String(sessionId),
    rootPid: root.pid,
    nativePid: native?.pid || null,
    createdAt: root.createdAt || native?.createdAt || null,
    pids: matches.map(item => item.pid).sort((a, b) => a - b),
    proof: 'exact_interactive_resume_uuid_process_tree',
  };
}

function terminateProcessTree(pid, { force = true, spawnSyncImpl = spawnSync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { status: null };
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    return spawnSyncImpl('taskkill.exe', args, {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
    return { status: 0 };
  } catch (error) {
    return { status: 1, error };
  }
}

function terminateOwnedProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    terminateProcessTree(pid, { force: true });
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); } catch {}
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForProcessesToExit(pids, timeoutMs, options = {}) {
  const isAlive = options.processIsAlive || processIsAlive;
  const pause = options.sleep || sleep;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pids.some(pid => isAlive(pid))) return true;
    await pause(Math.min(200, Math.max(1, deadline - Date.now())));
  }
  return !pids.some(pid => isAlive(pid));
}

async function takeOverOwnedHeadlessWorker(entry, options = {}) {
  const findWorker = options.findWorker || (value => findOwnedHeadlessWorker(value, options));
  const worker = findWorker(entry);
  if (!worker) return { status: 'not_running', worker: null, forced: false };
  const terminate = options.terminateProcessTree || terminateProcessTree;
  const waitForExit = options.waitForProcessesToExit
    || ((pids, timeoutMs) => waitForProcessesToExit(pids, timeoutMs, options));

  terminate(worker.rootPid, { force: false });
  if (await waitForExit(worker.pids, options.gracefulTimeoutMs ?? 5_000)) {
    return { status: 'taken_over', worker, forced: false };
  }
  terminate(worker.rootPid, { force: true });
  if (!await waitForExit(worker.pids, options.forceTimeoutMs ?? 10_000)) {
    throw new Error(`Owned headless worker ${worker.rootPid} did not exit; refusing to start a duplicate TUI`);
  }
  return { status: 'taken_over', worker, forced: true };
}

module.exports = {
  WORKER_START_TOLERANCE_MS,
  commandContainsSession,
  findOwnedHeadlessWorker,
  findInteractiveCodexSessionOwner,
  findRunningCodexSessionPid,
  isCodexSessionOwnerCommand,
  isInteractiveCodexResumeCommand,
  isHeadlessCodexExecCommand,
  listCodexProcesses,
  processIsAlive,
  readWorkerThreadId,
  startTimeMatches,
  takeOverOwnedHeadlessWorker,
  terminateOwnedProcessTree,
  terminateProcessTree,
  waitForProcessesToExit,
  workerStdoutPath,
};
