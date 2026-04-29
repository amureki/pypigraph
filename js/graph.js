import { formatSize, isDarkMode, escapeDot, escapeHtml } from "./utils.js";
import { initPanZoom, svgState } from "./pan-zoom.js";

// --- Coloring ---
export const depthColors = ["#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899"];

function colorByDepth(node) {
  if (node.pinnedBehind) return "#d97706";
  return depthColors[Math.min(node.depth, depthColors.length - 1)];
}

function colorByFreshness(node) {
  if (!node.releaseDate || node.depth === 0) return "#94a3b8";
  const days = (Date.now() - new Date(node.releaseDate).getTime()) / 86400000;
  if (days < 90) return "#22c55e";
  if (days < 365) return "#84cc16";
  if (days < 730) return "#f59e0b";
  return "#dc2626";
}

function colorByLicense(node) {
  if (node.depth === 0) return "#94a3b8";
  const lic = (node.license || "").toLowerCase();
  if (!lic || lic === "unknown") return "#dc2626";
  if (/mit|bsd|apache|isc|psf|unlicense/.test(lic)) return "#22c55e";
  if (/mpl/.test(lic)) return "#84cc16";
  if (/lgpl/.test(lic)) return "#f59e0b";
  if (/gpl|agpl/.test(lic)) return "#dc2626";
  return "#f59e0b";
}

function colorBySize(node, maxSize) {
  if (node.depth === 0 || !node.size) return "#94a3b8";
  if (maxSize === 0) return "#94a3b8";
  const ratio = node.size / maxSize;
  if (ratio < 0.1) return "#22c55e";
  if (ratio < 0.3) return "#84cc16";
  if (ratio < 0.6) return "#f59e0b";
  return "#dc2626";
}

// Color function factory. maxSize is only needed for the "size" mode.
export function getColorFn(mode, maxSize = 0) {
  const fns = { depth: colorByDepth, freshness: colorByFreshness, license: colorByLicense };
  if (mode === "size") return (node) => colorBySize(node, maxSize);
  return fns[mode] || colorByDepth;
}

const GRAPH_FONT = "Arial";

function wrapLabelText(text, maxLength) {
  const tokens = String(text).split(/([._-])/);
  const lines = [];
  let line = "";

  for (let token of tokens) {
    if (!token) continue;
    if (line && line.length + token.length > maxLength) {
      lines.push(line);
      line = "";
    }
    while (token.length > maxLength) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(token.slice(0, maxLength));
      token = token.slice(maxLength);
    }
    line += token;
  }

  if (line) lines.push(line);
  return lines;
}

function labelRows(text, pointSize, color, { bold = false, maxLength = 22 } = {}) {
  const tagOpen = bold ? "<B>" : "";
  const tagClose = bold ? "</B>" : "";
  return wrapLabelText(text, maxLength).map(line =>
    `<TR><TD ALIGN="CENTER"><FONT FACE="${GRAPH_FONT}" POINT-SIZE="${pointSize}" COLOR="${color}">${tagOpen}${escapeHtml(line)}${tagClose}</FONT></TD></TR>`
  );
}

function nodeLabel(node, fontColor, mutedColor) {
  const versionLabel = node.pinnedBehind ? node.specifier : (node.version || "");
  const titleSize = node.depth === 0 ? 12 : node.depth > 2 ? 9 : node.depth > 1 ? 10 : 11;
  const versionSize = Math.max(titleSize - 1, 8);
  const metaSize = Math.max(titleSize - 2, 8);
  const rows = [
    ...labelRows(node.name, titleSize, fontColor, { bold: true, maxLength: 22 }),
  ];

  if (versionLabel) {
    rows.push(...labelRows(versionLabel, versionSize, mutedColor, { maxLength: 24 }));
  }

  const meta = [node.releaseDate, node.size ? formatSize(node.size) : ""].filter(Boolean).join("  |  ");
  if (meta) {
    rows.push(...labelRows(meta, metaSize, mutedColor, { maxLength: 26 }));
  }

  return `<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0">${rows.join("")}</TABLE>`;
}

// --- DOT generation ---
export function graphToDot(graph, colorFn, engine) {
  const dependedBy = new Map();
  for (const { to } of graph.edges) {
    dependedBy.set(to, (dependedBy.get(to) || 0) + 1);
  }

  const fontColor = isDarkMode() ? "#e0e0e0" : "#1a1a1a";
  const mutedFontColor = isDarkMode() ? "#a3a3a3" : "#666666";
  const isDot = engine === "dot";
  const lines = [
    `digraph G {`,
    `  rankdir=TB;`,
    `  bgcolor="transparent";`,
    `  ranksep=0.6;`,
    `  nodesep=0.4;`,
    `  splines=true;`,
    isDot ? `  newrank=true;` : "",
    !isDot ? `  overlap=prism;` : "",
    !isDot ? `  sep="+10";` : "",
    `  node [shape=box, style="filled", fontname="${GRAPH_FONT}", fontsize=11, fontcolor="${fontColor}", margin="0.14,0.1"];`,
    `  edge [color="${isDarkMode() ? '#555' : '#6e7781'}", arrowsize=0.7, arrowhead=vee];`,
  ].filter(Boolean);

  for (const [id, node] of graph.nodes) {
    if (!node) continue;
    const count = dependedBy.get(id) || 0;
    const label = nodeLabel(node, fontColor, mutedFontColor);
    const color = colorFn(node);
    const penwidth = node.depth === 0 ? 3 : count > 3 ? 2.5 : 1.5;
    const style = node.error ? "filled,dashed" : "filled";
    const fillOpacity = isDarkMode() ? "40" : "20";
    const tooltipParts = [node.summary || node.name, count > 0 ? `Used by ${count} package${count > 1 ? "s" : ""}` : ""].filter(Boolean).join(" \u00B7 ");
    const tooltip = escapeDot(tooltipParts);

    lines.push(`  "${escapeDot(id)}" [label=<${label}>, fillcolor="${color}${fillOpacity}", color="${node.error ? "#dc2626" : color}", penwidth=${penwidth}, style="${style}", tooltip="${tooltip}", id="${escapeDot(id)}"];`);
  }

  for (const { from, to } of graph.edges) {
    const weight = isDot && (dependedBy.get(to) || 0) > 3 ? 2 : 1;
    lines.push(`  "${escapeDot(from)}" -> "${escapeDot(to)}"${weight > 1 ? ` [weight=${weight}]` : ""};`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

// --- Rendering ---
let graphClickCleanup = null;

export function renderGraph(graph, { graphviz, currentColorMode, currentLayout, maxSize, showModule }) {
  const container = document.getElementById("graph-container");
  const colorFn = getColorFn(currentColorMode, maxSize);
  const dot = graphToDot(graph, colorFn, currentLayout);
  const svg = graphviz.layout(dot, "svg", currentLayout);
  container.innerHTML = svg;

  const svgEl = container.querySelector("svg");
  if (svgEl) {
    const w = svgEl.getAttribute("width");
    const h = svgEl.getAttribute("height");
    svgEl.dataset.intrinsicWidth = parseFloat(w) || 0;
    svgEl.dataset.intrinsicHeight = parseFloat(h) || 0;
    svgEl.style.width = (parseFloat(w) || 800) + "px";
    svgEl.style.height = (parseFloat(h) || 600) + "px";
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
  }

  initPanZoom(container);

  const nodesByTitle = new Map();
  container.querySelectorAll(".node").forEach(el => {
    const title = el.querySelector("title");
    if (title) nodesByTitle.set(title.textContent.trim(), el);
  });

  const edgesByKey = new Map();
  container.querySelectorAll(".edge").forEach(el => {
    const title = el.querySelector("title");
    if (title) edgesByKey.set(title.textContent.trim(), el);
  });

  const children = new Map();
  const parents = new Map();
  for (const { from, to } of graph.edges) {
    if (!children.has(from)) children.set(from, []);
    children.get(from).push(to);
    if (!parents.has(to)) parents.set(to, []);
    parents.get(to).push(from);
  }

  function getConnectedIds(nodeId) {
    const ids = new Set([nodeId]);
    const upQueue = [nodeId];
    while (upQueue.length) {
      const cur = upQueue.shift();
      for (const p of parents.get(cur) || []) {
        if (!ids.has(p)) { ids.add(p); upQueue.push(p); }
      }
    }
    const downQueue = [nodeId];
    while (downQueue.length) {
      const cur = downQueue.shift();
      for (const c of children.get(cur) || []) {
        if (!ids.has(c)) { ids.add(c); downQueue.push(c); }
      }
    }
    return ids;
  }

  function setEdgeColor(el, color) {
    el.querySelectorAll("path, polygon").forEach(p => p.setAttribute("stroke", color));
    el.querySelectorAll("polygon").forEach(p => p.setAttribute("fill", color));
  }

  const allNodeEls = container.querySelectorAll(".node");
  const allEdgeEls = container.querySelectorAll(".edge");
  const defaultEdgeColor = isDarkMode() ? "#555" : "#6e7781";

  function highlightNode(nodeId) {
    const connectedIds = getConnectedIds(nodeId);
    allNodeEls.forEach(el => el.style.opacity = "0.15");
    allEdgeEls.forEach(el => el.style.opacity = "0.05");
    for (const id of connectedIds) {
      const el = nodesByTitle.get(id);
      if (el) el.style.opacity = "1";
    }
    for (const { from, to } of graph.edges) {
      if (connectedIds.has(from) && connectedIds.has(to)) {
        const el = edgesByKey.get(`${from}->${to}`);
        if (el) { el.style.opacity = "1"; setEdgeColor(el, "#2563eb"); }
      }
    }
  }

  function clearHighlight() {
    allNodeEls.forEach(n => n.style.opacity = "");
    allEdgeEls.forEach(el => { el.style.opacity = ""; setEdgeColor(el, defaultEdgeColor); });
  }

  if (graphClickCleanup) graphClickCleanup();
  const clickAc = new AbortController();
  container.addEventListener("click", (e) => {
    if (svgState.didDrag) return;
    const nodeEl = e.target.closest(".node");
    if (nodeEl) {
      const title = nodeEl.querySelector("title");
      if (title) {
        const nodeId = title.textContent.trim();
        highlightNode(nodeId);
        showModule(nodeId);
      }
    } else {
      clearHighlight();
    }
  }, { signal: clickAc.signal });
  graphClickCleanup = () => clickAc.abort();

  return { nodesByTitle, highlightNode, clearHighlight };
}

export function recolorGraph(graph, currentColorMode, maxSize = 0) {
  const container = document.getElementById("graph-container");
  const colorFn = getColorFn(currentColorMode, maxSize);
  container.querySelectorAll(".node").forEach(el => {
    const title = el.querySelector("title");
    if (!title) return;
    const nodeId = title.textContent.trim();
    const node = graph.nodes.get(nodeId);
    if (!node) return;
    const color = colorFn(node);
    const borderColor = node.error ? "#dc2626" : color;
    const fillOpacity = isDarkMode() ? "40" : "20";
    el.querySelectorAll("polygon, ellipse, path:not([fill='none'])").forEach(shape => {
      shape.style.fill = color + fillOpacity;
      shape.style.stroke = borderColor;
    });
  });
}
