/**
 * Put Docker Desktop's bin directory on PATH for the test worker.
 *
 * Testcontainers reads ~/.docker/config.json, finds `credsStore: "desktop"`, and spawns
 * `docker-credential-desktop` to resolve registry credentials. That helper lives in
 * Docker Desktop's own bin directory, which is added to the user's PATH by the
 * installer -- but a shell (or CI agent) started before the install has a stale PATH,
 * and the spawn fails with ENOENT before any container starts.
 *
 * Docker Desktop on Windows installs per-user by default now, so the old
 * "C:\Program Files\Docker" location cannot be assumed. Both are checked.
 *
 * On Linux/macOS CI the helper is normally already on PATH and this is a no-op.
 */

import { existsSync } from "node:fs";
import path from "node:path";

function candidateDockerBinDirs(): string[] {
  const dirs: string[] = [];

  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData !== undefined) {
    dirs.push(path.join(localAppData, "Programs", "DockerDesktop", "resources", "bin"));
  }

  for (const key of ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]) {
    const root = process.env[key];
    if (root !== undefined) {
      dirs.push(path.join(root, "Docker", "Docker", "resources", "bin"));
    }
  }

  dirs.push("/usr/local/bin", "/opt/homebrew/bin");
  return dirs;
}

const separator = process.platform === "win32" ? ";" : ":";
const currentPath = process.env["PATH"] ?? "";
const alreadyPresent = new Set(currentPath.split(separator).map((p) => p.toLowerCase()));

const missing = candidateDockerBinDirs().filter(
  (dir) => existsSync(dir) && !alreadyPresent.has(dir.toLowerCase()),
);

if (missing.length > 0) {
  process.env["PATH"] = [...missing, currentPath].join(separator);
}
