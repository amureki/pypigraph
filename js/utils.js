export const ROOT_ID = "__root__";

export function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

export function parsePep508(raw) {
  const match = raw.match(
    /^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)(\[([^\]]+)\])?\s*([^;]*?)(\s*;.*)?$/
  );
  if (!match) return { name: raw.trim(), extras: [], specifier: "", marker: "", raw };
  return {
    name: match[1],
    extras: match[4] ? match[4].split(",").map(e => e.trim()) : [],
    specifier: (match[5] || "").trim(),
    marker: match[6] ? match[6].replace(/^\s*;\s*/, "").trim() : "",
    raw,
  };
}

export function normalizeName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export function formatSize(bytes) {
  if (!bytes || bytes === 0) return "?";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function classifyLicense(license) {
  if (!license || license === "Unknown") return "license-unknown";
  return license.match(/MIT|BSD|Apache|ISC|PSF|LGPL|MPL/i) ? "license-ok" : "license-warn";
}

export function errorPackage(name) {
  return { name, version: "?", summary: "", license: "", size: 0, releaseDate: "", dependencies: [], error: true };
}

export function isDarkMode() {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function escapeDot(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
