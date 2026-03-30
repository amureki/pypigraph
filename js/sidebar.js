import { ROOT_ID, escapeHtml, normalizeName, formatSize, classifyLicense } from "./utils.js";
import { depthColors } from "./graph.js";

// --- Tab switching ---
export function switchTab(name) {
  document.querySelectorAll(".sidebar-tab").forEach(t => {
    const isActive = t.dataset.tab === name;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive);
  });
  document.querySelectorAll(".tab-panel").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
}

// --- Status / Error ---
function showMsg(el, msg) {
  el.textContent = msg;
  el.classList.toggle("active", !!msg);
}

export function showStatus(msg) { showMsg(document.getElementById("status"), msg); }
export function showError(msg) { showMsg(document.getElementById("error"), msg); }

// --- Stats ---
export function computeStats(graph) {
  let direct = 0, transitive = 0, errors = 0, totalSize = 0;
  const licenses = new Map();
  const depthCounts = new Map();
  let fresh = 0, aging = 0, stale = 0, ancient = 0, noDate = 0;

  for (const [id, node] of graph.nodes) {
    if (!node || id === ROOT_ID) continue;
    if (node.depth === 1) direct++; else transitive++;
    if (node.error) errors++;
    totalSize += node.size || 0;
    const lic = node.license || "Unknown";
    licenses.set(lic, (licenses.get(lic) || 0) + 1);
    depthCounts.set(node.depth, (depthCounts.get(node.depth) || 0) + 1);

    if (!node.releaseDate) { noDate++; }
    else {
      const days = (Date.now() - new Date(node.releaseDate).getTime()) / 86400000;
      if (days < 90) fresh++;
      else if (days < 365) aging++;
      else if (days < 730) stale++;
      else ancient++;
    }
  }

  return { direct, transitive, errors, totalSize, licenses, depthCounts, freshness: { fresh, aging, stale, ancient, noDate } };
}

export function renderStatsBar(stats) {
  const bar = document.getElementById("stats-bar");
  bar.innerHTML = [
    `<span class="stat"><b>${stats.direct}</b> direct</span>`,
    `<span class="stat"><b>${stats.transitive}</b> transitive</span>`,
    `<span class="stat"><b>${stats.direct + stats.transitive}</b> total</span>`,
    `<span class="stat"><b>${formatSize(stats.totalSize)}</b> size</span>`,
    stats.errors > 0 ? `<span class="stat" style="color:#dc2626"><b>${stats.errors}</b> errors</span>` : "",
  ].join("");
  bar.classList.add("active");
}

function packagesByLicense(graph) {
  const map = new Map();
  for (const [id, node] of graph.nodes) {
    if (!node || id === ROOT_ID) continue;
    const lic = node.license || "Unknown";
    if (!map.has(lic)) map.set(lic, []);
    map.get(lic).push({ id, name: node.name });
  }
  return map;
}

export function renderGraphTab(graph, stats) {
  const tab = document.getElementById("tab-graph");
  const pkgsByLic = packagesByLicense(graph);
  const sortedLicenses = [...stats.licenses.entries()].sort((a, b) => b[1] - a[1]);

  const licRows = sortedLicenses.map(([lic, count], i) => {
    const pkgs = pkgsByLic.get(lic) || [];
    const pkgItems = pkgs.map(p =>
      `<li data-pkg-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</li>`
    ).join("");
    return `<tr class="license-row" data-lic-idx="${i}"><td class="${classifyLicense(lic)}">${escapeHtml(lic || "Unknown")}</td><td>${count}</td></tr>` +
      `<tr class="license-packages" data-lic-idx="${i}"><td colspan="2"><ul>${pkgItems}</ul></td></tr>`;
  }).join("");

  // Depth distribution bars
  const maxDepth = Math.max(...stats.depthCounts.keys());
  const maxCount = Math.max(...stats.depthCounts.values());
  let depthBars = "";
  for (let d = 1; d <= maxDepth; d++) {
    const c = stats.depthCounts.get(d) || 0;
    const pct = maxCount > 0 ? (c / maxCount * 100) : 0;
    const color = depthColors[Math.min(d, depthColors.length - 1)];
    depthBars += `<div class="stat-bar-row"><span class="stat-bar-label">depth ${d}</span><div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="stat-bar-count">${c}</span></div>`;
  }

  // Freshness summary
  const f = stats.freshness;
  const freshnessItems = [
    { label: "< 3 months", count: f.fresh, color: "#22c55e" },
    { label: "< 1 year", count: f.aging, color: "#84cc16" },
    { label: "< 2 years", count: f.stale, color: "#f59e0b" },
    { label: "2+ years", count: f.ancient, color: "#dc2626" },
  ].filter(i => i.count > 0);
  let freshnessBars = "";
  const maxFresh = Math.max(...freshnessItems.map(i => i.count), 1);
  for (const item of freshnessItems) {
    const pct = (item.count / maxFresh * 100);
    freshnessBars += `<div class="stat-bar-row"><span class="stat-bar-label">${item.label}</span><div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%;background:${item.color}"></div></div><span class="stat-bar-count">${item.count}</span></div>`;
  }

  // Top 5 largest packages
  const sorted = [...graph.nodes.entries()]
    .filter(([id, n]) => n && id !== ROOT_ID && n.size > 0)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);
  const topList = sorted.map(([id, n]) =>
    `<li><span class="pkg-name" data-pkg-id="${escapeHtml(id)}">${escapeHtml(n.name)}</span><span class="pkg-size">${formatSize(n.size)}</span></li>`
  ).join("");

  tab.innerHTML = `
    <dl class="graph-stats">
      ${stats.errors > 0 ? `<dt>Fetch errors</dt><dd style="color:#dc2626">${stats.errors}</dd>` : ""}
      <dt>Depth distribution</dt>
      <dd>${depthBars}</dd>
      <dt>Freshness</dt>
      <dd>${freshnessBars}</dd>
      ${sorted.length > 0 ? `<dt>Largest packages</dt><dd><ul class="top-list">${topList}</ul></dd>` : ""}
      <dt>Licenses (${stats.licenses.size} unique)</dt>
      <dd><table class="license-table">${licRows}</table></dd>
    </dl>
  `;

  tab.querySelectorAll(".license-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = row.dataset.licIdx;
      const detail = tab.querySelector(`.license-packages[data-lic-idx="${idx}"]`);
      row.classList.toggle("expanded");
      detail.classList.toggle("active");
    });
  });

  tab.querySelectorAll("[data-pkg-id]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      showModule(el.dataset.pkgId, graph);
    });
  });
}

// --- Module detail ---
function detailRow(label, value, extraClass = "") {
  return `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value ${extraClass}">${value}</div></div>`;
}

export function showModule(nodeId, graph) {
  if (!graph) return;
  const node = graph.nodes.get(nodeId);
  if (!node || nodeId === ROOT_ID) return;

  const tab = document.getElementById("tab-module");

  const usedBy = graph.edges.filter(e => e.to === nodeId).map(e => {
    const n = graph.nodes.get(e.from);
    return { id: e.from, name: n ? n.name : e.from };
  });

  const pypiUrl = `https://pypi.org/project/${encodeURIComponent(normalizeName(node.name))}/`;
  const urls = node.projectUrls || {};
  const linksHtml = Object.entries(urls).map(([k, v]) => {
    const safeUrl = v.match(/^https?:\/\//) ? v : "#";
    return `<a href="${escapeHtml(safeUrl)}" target="_blank">${escapeHtml(k)}</a>`;
  }).join(" &middot; ");

  const deps = node.dependencies || [];
  const depsHtml = deps.length === 0
    ? '<p style="color:var(--text-faintest);margin-top:0.5rem;">No dependencies</p>'
    : `<ul class="dep-list">${deps.map(d => `<li>${escapeHtml(d.raw)}</li>`).join("")}</ul>`;

  const versionHtml = node.pinnedBehind
    ? `${escapeHtml(node.version || "?")} <span style="color:#d97706;font-size:0.7rem;">(latest excluded by ${escapeHtml(node.specifier)})</span>`
    : escapeHtml(node.version || "?");

  const usedByHtml = usedBy.length === 0 ? "-"
    : `<ul class="used-by-list">${usedBy.filter(u => u.id !== ROOT_ID).map(u => `<li data-pkg-id="${escapeHtml(u.id)}">${escapeHtml(u.name)}</li>`).join("")}</ul>`;

  const rows = [
    detailRow("Package", `<b>${escapeHtml(node.name)}</b>`),
    detailRow("Version", versionHtml),
    node.releaseDate ? detailRow("Released", escapeHtml(node.releaseDate)) : "",
    detailRow("Summary", escapeHtml(node.summary || "-")),
    detailRow("License", escapeHtml(node.license || "Unknown"), classifyLicense(node.license)),
    detailRow("Size", formatSize(node.size)),
  ];
  if (node.requiresPython) {
    rows.push(detailRow("Python requires", escapeHtml(node.requiresPython)));
  }
  rows.push(
    detailRow("Links", `<a href="${pypiUrl}" target="_blank">PyPI</a>${linksHtml ? " &middot; " + linksHtml : ""}`),
    detailRow(`Used by (${usedBy.length})`, usedByHtml),
    `<div class="detail-row"><div class="detail-label">Dependencies (${deps.length})</div>${depsHtml}</div>`,
  );

  tab.innerHTML = rows.join("");

  // Wire up clickable used-by items
  tab.querySelectorAll(".used-by-list li[data-pkg-id]").forEach(li => {
    li.addEventListener("click", () => showModule(li.dataset.pkgId, graph));
  });

  switchTab("module");
}
