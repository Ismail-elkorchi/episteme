import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inputError, limitError, resourceBusyError, throwIfAborted } from "./errors.js";

const LOCK_SUFFIX = ".episteme.lock";

export async function writeFileAtomic(filePath, data, encoding) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let mode = 0o666;
  try {
    mode = (await fs.stat(filePath)).mode & 0o777;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx", mode);
    await handle.writeFile(data, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readJsonInput(inputPath, {
  maxBytes,
  stdin = process.stdin,
  label = "JSON input",
  signal,
} = {}) {
  const buffer = inputPath === "-"
    ? await readBoundedStream(stdin, maxBytes, label, signal)
    : await readBoundedFile(inputPath, maxBytes, label, signal);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw inputError(`${label} is not valid JSON`, { path: inputPath }, error);
  }
}

export async function withOutputLocks(targets, operation, { command } = {}) {
  const normalized = [...new Set(targets.filter(Boolean).map((target) => path.resolve(target)))].sort();
  const token = randomUUID();
  const acquired = [];
  let operationError = null;
  try {
    for (const target of normalized) {
      acquired.push(await acquireOutputLock(target, { token, command }));
    }
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let releaseError = null;
    for (const lock of acquired.reverse()) {
      try {
        await releaseOutputLock(lock);
      } catch (error) {
        releaseError ??= error;
      }
    }
    if (releaseError && !operationError) throw releaseError;
  }
}

async function acquireOutputLock(target, { token, command }) {
  const lockPath = path.join(path.dirname(target), `.${path.basename(target)}${LOCK_SUFFIX}`);
  const hostname = localHostname();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let created = false;
    try {
      await fs.mkdir(lockPath);
      created = true;
      const owner = {
        token,
        pid: process.pid,
        hostname,
        command: command || null,
        target,
        acquiredAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify(owner), "utf8");
      return { lockPath, token };
    } catch (error) {
      if (created) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      const owner = await readLockOwner(lockPath);
      if (attempt === 0 && owner && owner.hostname === hostname && !(await isProcessAlive(owner.pid))) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }
      throw resourceBusyError(`Output is locked: ${target}`, {
        target,
        owner: owner ? {
          pid: owner.pid,
          hostname: owner.hostname,
          command: owner.command,
          acquiredAt: owner.acquiredAt,
        } : null,
      }, error);
    }
  }
  throw resourceBusyError(`Output is locked: ${target}`, { target });
}

async function releaseOutputLock({ lockPath, token }) {
  const owner = await readLockOwner(lockPath);
  if (owner?.token === token) {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function readLockOwner(lockPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

async function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    await fs.readFile("/proc/self/stat", "utf8");
    try {
      await fs.readFile(`/proc/${pid}/stat`, "utf8");
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
    }
  } catch {
    // Non-Linux systems fall back to the portable signal-zero probe.
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

function localHostname() {
  if (process.env.HOSTNAME) return process.env.HOSTNAME;
  try {
    return os.hostname();
  } catch {
    return null;
  }
}

async function readBoundedFile(filePath, maxBytes, label, signal) {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (error) {
    throw inputError(`Unable to read ${label}: ${filePath}`, { path: filePath }, error);
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw inputError(`${label} is not a regular file`, { path: filePath });
    if (stats.size > maxBytes) throw inputLimit(label, stats.size, maxBytes);
    const chunks = [];
    let total = 0;
    const scratch = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1));
    while (total <= maxBytes) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        scratch,
        0,
        Math.min(scratch.length, maxBytes + 1 - total),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw inputLimit(label, total, maxBytes);
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close().catch(() => {});
  }
}

async function syncDirectory(directoryPath) {
  let handle;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EBADF", "EISDIR", "EPERM", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readBoundedStream(stream, maxBytes, label, signal) {
  const chunks = [];
  let total = 0;
  const iterator = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      const { value, done } = await nextWithSignal(iterator, signal);
      if (done) break;
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += buffer.byteLength;
      if (total > maxBytes) throw inputLimit(label, total, maxBytes);
      chunks.push(buffer);
    }
  } catch (error) {
    if (signal?.aborted) {
      Promise.resolve(iterator.return?.()).catch(() => {});
    }
    throw error;
  }
  throwIfAborted(signal);
  return Buffer.concat(chunks, total);
}

function nextWithSignal(iterator, signal) {
  throwIfAborted(signal);
  if (!signal) return iterator.next();
  return new Promise((resolve, reject) => {
    const abort = () => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(iterator.next()).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function inputLimit(label, actual, limit) {
  return limitError(`${label} exceeds the ${limit}-byte input limit`, { actual, limit });
}

export function createProgressReporter({ command, mode = "auto", json = false, stream = process.stderr }) {
  const enabled = mode === "always" || (mode === "auto" && stream.isTTY === true);
  if (!enabled) return () => {};
  return (event) => {
    const record = { type: "progress", command, ...event };
    if (json) {
      stream.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const count = Number.isInteger(record.current) && Number.isInteger(record.total)
      ? ` (${record.current}/${record.total})`
      : "";
    stream.write(`${terminalSafe(record.stage)}: ${terminalSafe(record.message)}${count}\n`);
  };
}

function terminalSafe(value) {
  return String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, "");
}
