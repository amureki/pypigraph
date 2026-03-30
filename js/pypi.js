import { ROOT_ID, parsePep508, normalizeName, errorPackage } from "./utils.js";

// --- Concurrency limiter ---
function semaphore(max) {
  let active = 0;
  const queue = [];
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try { resolve(await fn()); } catch (e) { reject(e); } finally {
          active--;
          if (queue.length) queue.shift()();
        }
      };
      if (active < max) run(); else queue.push(run);
    });
  };
}

const limit = semaphore(8);

// --- PyPI fetcher ---
const cache = new Map();

export async function fetchPackageInfo(name) {
  const normalized = normalizeName(name);
  if (cache.has(normalized)) return cache.get(normalized);

  const promise = (async () => {
    try {
      const resp = await fetch(`https://pypi.org/pypi/${normalized}/json`);
      if (!resp.ok) return errorPackage(normalized);
      const data = await resp.json();
      const info = data.info;
      const requires = (info.requires_dist ?? [])
        .map(parsePep508)
        .filter(d => !d.marker.includes("extra ==") && !d.marker.includes("extra=="));

      let size = 0;
      const urls = data.urls ?? [];
      const wheel = urls.find(u => u.packagetype === "bdist_wheel");
      const sdist = urls.find(u => u.packagetype === "sdist");
      size = (wheel || sdist)?.size || 0;

      const uploadTime = (wheel || sdist)?.upload_time_iso_8601 || "";
      const releaseDate = uploadTime ? uploadTime.split("T")[0] : "";

      const licenseClassifier = (info.classifiers ?? []).find(c => c.startsWith("License ::"));
      let license = info.license_expression
        || (licenseClassifier ? licenseClassifier.split(" :: ").pop() : "")
        || info.license
        || "";
      if (license.length > 80) license = license.slice(0, 80) + "...";

      return {
        name: info.name,
        version: info.version,
        summary: info.summary || "",
        license,
        size,
        releaseDate,
        projectUrls: info.project_urls || {},
        requiresPython: info.requires_python || "",
        dependencies: requires,
        error: false,
      };
    } catch {
      return errorPackage(normalized);
    }
  })();

  cache.set(normalized, promise);
  return promise;
}

export function clearCache() {
  cache.clear();
}

// --- PEP 440 version comparison (simplified) ---
function parseVersion(v) {
  return v.replace(/\.?(dev|alpha|beta|rc|post|a|b|c)\d*/gi, "")
    .split(".").map(Number);
}

function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function satisfiesSpec(version, specifier) {
  if (!specifier) return true;
  const parts = specifier.split(",").map(s => s.trim());
  for (const part of parts) {
    const m = part.match(/^(~=|==|!=|<=?|>=?|===)(.+)$/);
    if (!m) continue;
    const [, op, target] = m;
    const cmp = compareVersions(version, target);
    if (op === ">=" && cmp < 0) return false;
    if (op === ">" && cmp <= 0) return false;
    if (op === "<=" && cmp > 0) return false;
    if (op === "<" && cmp >= 0) return false;
    if (op === "==" && cmp !== 0) return false;
    if (op === "!=" && cmp === 0) return false;
    if (op === "~=") {
      if (cmp < 0) return false;
      const tv = parseVersion(target);
      tv[tv.length - 2] = (tv[tv.length - 2] || 0) + 1;
      const upper = tv.map(String).join(".");
      if (compareVersions(version, upper) >= 0) return false;
    }
  }
  return true;
}

// --- Graph builder ---
export async function buildGraph(rootDeps, projectName, maxDepth, onProgress) {
  const edgeSet = new Set();
  const edges = [];
  const nodes = new Map();

  nodes.set(ROOT_ID, { name: projectName, version: "", depth: 0, error: false, size: 0, license: "", dependencies: [], summary: "" });

  function addEdge(from, to) {
    const key = `${from}->${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to });
  }

  async function resolve(depName, parentKey, depth, specifier) {
    if (depth > maxDepth) return;
    const key = normalizeName(depName);
    addEdge(parentKey, key);
    if (nodes.has(key)) return;
    nodes.set(key, null); // reserve to prevent duplicate fetches

    onProgress(`Fetching ${depName}... (${nodes.size - 1} packages)`);
    const info = await limit(() => fetchPackageInfo(key));
    const pinnedBehind = specifier && info.version && !info.error
      ? !satisfiesSpec(info.version, specifier) : false;
    nodes.set(key, { ...info, depth, specifier: specifier || "", pinnedBehind });

    await Promise.all(
      info.dependencies.map(d => resolve(d.name, key, depth + 1, d.specifier))
    );
  }

  await Promise.all(
    rootDeps.map(d => resolve(d.name, ROOT_ID, 1, d.specifier))
  );

  return { nodes, edges };
}
