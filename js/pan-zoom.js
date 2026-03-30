export const svgState = { scale: 1, panX: 0, panY: 0, didDrag: false };
let panZoomCleanup = null;

export function applyTransform() {
  const svg = document.getElementById("graph-container").querySelector("svg");
  if (svg) svg.style.transform = `translate(${svgState.panX}px, ${svgState.panY}px) scale(${svgState.scale})`;
}

function clampScale(s) { return Math.min(Math.max(s, 0.05), 5); }

export function zoomAt(cx, cy, factor) {
  const newScale = clampScale(svgState.scale * factor);
  const f = newScale / svgState.scale;
  svgState.panX = cx - (cx - svgState.panX) * f;
  svgState.panY = cy - (cy - svgState.panY) * f;
  svgState.scale = newScale;
  applyTransform();
}

export function initPanZoom(container) {
  if (panZoomCleanup) panZoomCleanup();

  const svg = container.querySelector("svg");
  if (!svg) return;
  svg.style.willChange = "transform";

  let dragging = false, startX = 0, startY = 0;
  let lastTouchDist = 0, lastTouchMid = null;

  const ac = new AbortController();
  const opts = { signal: ac.signal };
  const optsPassive = { signal: ac.signal, passive: false };

  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = -e.deltaY * (e.deltaMode === 1 ? 20 : 1);
    const factor = Math.pow(1.002, delta);
    const rect = container.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  }, optsPassive);

  container.addEventListener("mousedown", (e) => {
    if (e.target.closest(".node")) return;
    dragging = true;
    svgState.didDrag = false;
    startX = e.clientX - svgState.panX;
    startY = e.clientY - svgState.panY;
  }, opts);
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    svgState.didDrag = true;
    svgState.panX = e.clientX - startX;
    svgState.panY = e.clientY - startY;
    applyTransform();
  }, opts);
  window.addEventListener("mouseup", () => { dragging = false; }, opts);

  container.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1 && !e.target.closest(".node")) {
      dragging = true;
      startX = e.touches[0].clientX - svgState.panX;
      startY = e.touches[0].clientY - svgState.panY;
    } else if (e.touches.length === 2) {
      dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.hypot(dx, dy);
      const rect = container.getBoundingClientRect();
      lastTouchMid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
      };
    }
  }, optsPassive);
  container.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      svgState.panX = e.touches[0].clientX - startX;
      svgState.panY = e.touches[0].clientY - startY;
      applyTransform();
    } else if (e.touches.length === 2 && lastTouchDist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / lastTouchDist;
      zoomAt(lastTouchMid.x, lastTouchMid.y, factor);
      lastTouchDist = dist;
    }
  }, optsPassive);
  container.addEventListener("touchend", () => {
    dragging = false;
    lastTouchDist = 0;
    lastTouchMid = null;
  }, opts);

  panZoomCleanup = () => ac.abort();
  fitGraph();
}

export function fitGraph() {
  const container = document.getElementById("graph-container");
  const svg = container.querySelector("svg");
  if (!svg) return;
  const cw = container.clientWidth, ch = container.clientHeight;
  const sw = parseFloat(svg.dataset.intrinsicWidth) || parseFloat(svg.style.width) || cw;
  const sh = parseFloat(svg.dataset.intrinsicHeight) || parseFloat(svg.style.height) || ch;
  svgState.scale = Math.min(cw / sw, ch / sh) * 0.95;
  svgState.panX = (cw - sw * svgState.scale) / 2;
  svgState.panY = (ch - sh * svgState.scale) / 2;
  applyTransform();
}
