import { parse } from "https://cdn.jsdelivr.net/npm/smol-toml@1.3.1/+esm";
import { Graphviz } from "https://cdn.jsdelivr.net/npm/@hpcc-js/wasm-graphviz@1.21.2/+esm";
import { ROOT_ID, parsePep508, normalizeName } from "./utils.js";
import { buildGraph, clearCache } from "./pypi.js";
import { renderGraph, recolorGraph } from "./graph.js";
import { svgState, zoomAt, fitGraph, applyTransform } from "./pan-zoom.js";
import { switchTab, showStatus, showError, computeStats, renderStatsBar, renderGraphTab, showModule } from "./sidebar.js";

const graphviz = await Graphviz.load();

let lastGraph = null;
let lastMaxSize = 0;
let currentColorMode = localStorage.getItem("pypigraph-color") || "depth";
let currentLayout = localStorage.getItem("pypigraph-layout") || "dot";

// --- Theme ---
const themeBtns = document.querySelectorAll(".theme-btn");
const themeIndicator = document.querySelector(".theme-switcher-indicator");
const themeOrder = ["auto", "light", "dark"];

function moveIndicator(val) {
  const idx = Math.max(0, themeOrder.indexOf(val));
  themeIndicator.style.transform = `translateX(${idx * 100}%)`;
}

function applyTheme(val) {
  if (val === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", val);
  }
  localStorage.setItem("pypigraph-theme", val);
  themeBtns.forEach(b => {
    const isActive = b.dataset.theme === val;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", isActive);
  });
  moveIndicator(val);
  if (lastGraph) doRenderGraph(lastGraph);
}

const savedTheme = localStorage.getItem("pypigraph-theme") || "auto";
if (savedTheme !== "auto") document.documentElement.setAttribute("data-theme", savedTheme);
themeBtns.forEach(b => {
  const isActive = b.dataset.theme === savedTheme;
  b.classList.toggle("active", isActive);
  b.setAttribute("aria-pressed", isActive);
});
moveIndicator(savedTheme);
requestAnimationFrame(() => themeIndicator.classList.add("ready"));
themeBtns.forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.theme)));

// --- Sidebar collapse ---
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarShow = document.getElementById("sidebar-show");
const mobileToggle = document.getElementById("mobile-sidebar-toggle");
const sidebarOverlay = document.getElementById("sidebar-overlay");

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.add("collapsed");
  sidebarShow.classList.add("active");
});
sidebarShow.addEventListener("click", () => {
  sidebar.classList.remove("collapsed");
  sidebarShow.classList.remove("active");
});
mobileToggle.addEventListener("click", () => {
  sidebar.classList.toggle("mobile-open");
  sidebarOverlay.classList.toggle("active");
});
sidebarOverlay.addEventListener("click", () => {
  sidebar.classList.remove("mobile-open");
  sidebarOverlay.classList.remove("active");
});

// --- Tab wiring ---
document.querySelectorAll(".sidebar-tab").forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// --- Render helper ---
let graphRefs = null; // { nodesByTitle, highlightNode, clearHighlight }

function doRenderGraph(graph) {
  graphRefs = renderGraph(graph, {
    graphviz,
    currentColorMode,
    currentLayout,
    maxSize: lastMaxSize,
    showModule: (nodeId) => showModule(nodeId, graph),
  });
}

// --- Search ---
const searchInput = document.getElementById("search-input");
const searchCount = document.getElementById("search-count");

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query || !lastGraph || !graphRefs) {
    searchCount.textContent = "";
    if (graphRefs) graphRefs.clearHighlight();
    return;
  }
  const matches = [];
  for (const [id, node] of lastGraph.nodes) {
    if (!node || id === ROOT_ID) continue;
    if (node.name.toLowerCase().includes(query)) matches.push(id);
  }
  searchCount.textContent = `${matches.length} found`;
  if (matches.length === 0) {
    graphRefs.clearHighlight();
    return;
  }
  const container = document.getElementById("graph-container");
  container.querySelectorAll(".node").forEach(el => el.style.opacity = "0.15");
  container.querySelectorAll(".edge").forEach(el => el.style.opacity = "0.05");
  for (const id of matches) {
    const el = graphRefs.nodesByTitle.get(id);
    if (el) el.style.opacity = "1";
  }
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const query = searchInput.value.trim().toLowerCase();
    if (!query || !lastGraph || !graphRefs) return;
    for (const [id, node] of lastGraph.nodes) {
      if (!node || id === ROOT_ID) continue;
      if (node.name.toLowerCase().includes(query)) {
        const el = graphRefs.nodesByTitle.get(id);
        if (el) {
          const container = document.getElementById("graph-container");
          const bbox = el.getBBox();
          const cx = bbox.x + bbox.width / 2;
          const cy = bbox.y + bbox.height / 2;
          svgState.panX = container.clientWidth / 2 - cx * svgState.scale;
          svgState.panY = container.clientHeight / 2 - cy * svgState.scale;
          applyTransform();
          showModule(id, lastGraph);
        }
        break;
      }
    }
  }
  if (e.key === "Escape") {
    searchInput.value = "";
    searchCount.textContent = "";
    if (graphRefs) graphRefs.clearHighlight();
  }
});

// --- Zoom controls ---
document.getElementById("zoom-in").addEventListener("click", () => {
  const c = document.getElementById("graph-container");
  zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1.3);
});
document.getElementById("zoom-out").addEventListener("click", () => {
  const c = document.getElementById("graph-container");
  zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1 / 1.3);
});
document.getElementById("zoom-fit").addEventListener("click", fitGraph);
document.getElementById("zoom-reset").addEventListener("click", () => {
  const container = document.getElementById("graph-container");
  const svg = container.querySelector("svg");
  if (!svg) return;
  const cw = container.clientWidth, ch = container.clientHeight;
  const sw = parseFloat(svg.dataset.intrinsicWidth) || parseFloat(svg.style.width) || cw;
  const sh = parseFloat(svg.dataset.intrinsicHeight) || parseFloat(svg.style.height) || ch;
  svgState.scale = 1;
  svgState.panX = (cw - sw) / 2;
  svgState.panY = (ch - sh) / 2;
  applyTransform();
});

const layoutSelect = document.getElementById("layout-select");
const colorSelect = document.getElementById("color-select");
layoutSelect.value = currentLayout;
colorSelect.value = currentColorMode;

layoutSelect.addEventListener("change", (e) => {
  currentLayout = e.target.value;
  localStorage.setItem("pypigraph-layout", currentLayout);
  if (lastGraph) doRenderGraph(lastGraph);
});
colorSelect.addEventListener("change", (e) => {
  currentColorMode = e.target.value;
  localStorage.setItem("pypigraph-color", currentColorMode);
  if (lastGraph) recolorGraph(lastGraph, currentColorMode, lastMaxSize);
});

// --- TOML parsing ---
function parseToml(tomlString) {
  const doc = parse(tomlString);
  const deps = doc.project?.dependencies ?? [];
  if (deps.length === 0) throw new Error("No dependencies found in [project].dependencies");
  return { name: doc.project?.name || "project", dependencies: deps.map(parsePep508) };
}

// --- Input ---
const tomlInput = document.getElementById("toml-input");
const urlInput = document.getElementById("url-input");
const inputHint = document.getElementById("input-hint");

function updateInputHint() {
  const hasToml = tomlInput.value.trim().length > 0;
  const hasUrl = urlInput.value.trim().length > 0;
  if (hasToml && hasUrl) {
    inputHint.textContent = "Textarea content takes priority over URL";
  } else if (hasToml) {
    inputHint.textContent = "Will parse textarea content";
  } else if (hasUrl) {
    inputHint.textContent = "Will fetch from URL";
  } else {
    inputHint.textContent = "";
  }
}
tomlInput.addEventListener("input", updateInputHint);
urlInput.addEventListener("input", updateInputHint);

async function getTomlInput() {
  const text = tomlInput.value.trim();
  if (text) return text;
  const url = urlInput.value.trim();
  if (url) {
    showStatus("Fetching pyproject.toml...");
    const rawUrl = url
      .replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/, "https://raw.githubusercontent.com/$1/$2/refs/heads/$3")
      .replace(/^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/blob\/(.+)$/, "https://gitlab.com/$1/$2/-/raw/$3");
    const resp = await fetch(rawUrl);
    if (!resp.ok) throw new Error(`Failed to fetch URL: ${resp.status}`);
    return await resp.text();
  }
  throw new Error("Paste pyproject.toml contents or provide a URL");
}

// --- Build ---
async function runBuild() {
  const goBtn = document.getElementById("go-btn");
  showError("");
  goBtn.disabled = true;
  clearCache();

  try {
    const toml = await getTomlInput();
    const parsed = parseToml(toml);

    const isSynthetic = parsed.name === "example";
    const deps = parsed.dependencies;
    const projectName = isSynthetic ? "pyproject.toml" : parsed.name;
    const graph = await buildGraph(parsed.dependencies, projectName, 10, showStatus);

    // Single-package synthetic input: remove the fake root, promote the package to root
    if (isSynthetic && deps.length === 1) {
      const pkgKey = normalizeName(deps[0].name);
      graph.nodes.delete(ROOT_ID);
      graph.edges.splice(0, graph.edges.length, ...graph.edges.filter(e => e.from !== ROOT_ID));
      const pkgNode = graph.nodes.get(pkgKey);
      if (pkgNode) pkgNode.depth = 0;
      for (const [, node] of graph.nodes) {
        if (node && node.depth > 0) node.depth--;
      }
    }

    lastGraph = graph;

    lastMaxSize = 0;
    for (const [id, n] of graph.nodes) {
      if (n && id !== ROOT_ID && n.size > lastMaxSize) lastMaxSize = n.size;
    }

    showStatus("Rendering graph...");

    // Update header context
    const displayName = !isSynthetic ? projectName
      : deps.length <= 3 ? deps.map(d => d.name).join(", ")
      : `${deps.slice(0, 3).map(d => d.name).join(", ")} +${deps.length - 3} more`;
    document.getElementById("header-context").textContent = ` for ${displayName}`;

    // Hide empty state
    document.getElementById("empty-state").classList.add("hidden");

    doRenderGraph(graph);
    document.getElementById("zoom-controls").classList.add("active");
    document.getElementById("graph-search").classList.add("active");

    const stats = computeStats(graph);
    renderStatsBar(stats);
    renderGraphTab(graph, stats);
    showStatus("");
    switchTab("graph");

    updateUrlState();
  } catch (e) {
    showError(e.message);
    showStatus("");
  } finally {
    goBtn.disabled = false;
    document.documentElement.removeAttribute("data-loading");
  }
}

document.getElementById("go-btn").addEventListener("click", runBuild);

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runBuild();
  }
});
tomlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runBuild();
  }
});

document.querySelectorAll(".example-link").forEach(link => {
  link.addEventListener("click", () => {
    tomlInput.value = "";
    urlInput.value = "";

    if (link.dataset.url) {
      urlInput.value = link.dataset.url;
    } else if (link.dataset.pkg) {
      tomlInput.value = `[project]\nname = "example"\ndependencies = ["${link.dataset.pkg}"]`;
    } else if (link.dataset.toml) {
      const pkgs = link.dataset.toml.split("\n").map(p => `"${p.trim()}"`).join(", ");
      tomlInput.value = `[project]\nname = "example"\ndependencies = [${pkgs}]`;
    }
    updateInputHint();
    runBuild();
  });
});

// --- URL state ---
function updateUrlState() {
  const params = new URLSearchParams();
  const url = urlInput.value.trim();
  const text = tomlInput.value.trim();

  if (url) {
    params.set("url", url);
  } else if (text) {
    const match = text.match(/^\[project\]\s*\nname\s*=\s*"example"\s*\ndependencies\s*=\s*\[([^\]]+)\]$/);
    if (match) {
      const pkgs = match[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, ""));
      if (pkgs) {
        for (const p of pkgs) params.append("pkg", p);
      }
    }
  }

  const newUrl = params.toString() ? `${location.pathname}?${params}` : location.pathname;
  history.replaceState(null, "", newUrl);
}

function loadFromUrl() {
  const params = new URLSearchParams(location.search);

  if (params.has("url")) {
    urlInput.value = params.get("url");
    updateInputHint();
    runBuild();
  } else if (params.has("pkg")) {
    const pkgs = params.getAll("pkg")
      .map(p => p.trim())
      .filter(p => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p));
    if (pkgs.length === 0) return;
    const deps = pkgs.map(p => `"${p}"`).join(", ");
    tomlInput.value = `[project]\nname = "example"\ndependencies = [${deps}]`;
    updateInputHint();
    runBuild();
  }
}

loadFromUrl();
