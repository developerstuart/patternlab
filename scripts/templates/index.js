"use strict";
const TREE = __TREE_JSON__;
const UI_CONFIG = __UI_CONFIG__;

/* ── Mode ────────────────────────────────────────────── */
const applyMode = (mode) => {
  document.documentElement.setAttribute("data-mode", mode);
  localStorage.setItem("pl-mode", mode);
  const modeBtn = document.getElementById("mode-btn");
  if (modeBtn) modeBtn.textContent = mode === "dark" ? "☀ Light" : "🌙 Dark";
  document.querySelectorAll("iframe").forEach((f) => {
    try {
      f.contentWindow.postMessage({ type: "pl-mode", mode }, "*");
    } catch {}
  });
};
const modeBtn = document.getElementById("mode-btn");
if (modeBtn) {
  modeBtn.addEventListener("click", () => {
    applyMode(
      document.documentElement.getAttribute("data-mode") === "dark"
        ? "light"
        : "dark",
    );
  });
}
applyMode(document.documentElement.getAttribute("data-mode") || "light");

/* ── Generic Toggles ─────────────────────────────────── */
// Normalises a values entry to { value, label }; accepts plain strings or objects.
const normToggleVal = (v) =>
  typeof v === "string"
    ? { value: v, label: v }
    : { value: String(v.value), label: String(v.label ?? v.value) };

const broadcastTogglesToFrame = (frameWindow) => {
  const toggleDefs = UI_CONFIG.toggles || [];
  toggleDefs.forEach((def) => {
    if (!def.attribute) return;
    const storageKey = def.storageKey || `pl-toggle-${def.id}`;
    const firstVal =
      Array.isArray(def.values) && def.values.length
        ? normToggleVal(def.values[0]).value
        : "";
    const value = localStorage.getItem(storageKey) || def.default || firstVal;
    try {
      frameWindow.postMessage(
        { type: "pl-attr", attribute: def.attribute, value },
        "*",
      );
    } catch {}
  });
};

const setupToggles = () => {
  const container = $("pl-toggles");
  if (!container) return;
  const toggleDefs = UI_CONFIG.toggles || [];
  toggleDefs.forEach((def) => {
    if (
      !def.id ||
      !def.attribute ||
      !Array.isArray(def.values) ||
      def.values.length === 0
    )
      return;
    const storageKey = def.storageKey || `pl-toggle-${def.id}`;
    const entries = def.values.map(normToggleVal);
    const defaultValue = def.default || entries[0].value;
    const savedValue = localStorage.getItem(storageKey) || defaultValue;
    const targetEl = () =>
      def.target === "body" ? document.body : document.documentElement;

    const applyValue = (value) => {
      targetEl().setAttribute(def.attribute, value);
      localStorage.setItem(storageKey, value);
      document.querySelectorAll("iframe").forEach((f) => {
        try {
          f.contentWindow.postMessage(
            { type: "pl-attr", attribute: def.attribute, value },
            "*",
          );
        } catch {}
      });
    };

    if (def.type === "boolean") {
      const [offEntry, onEntry] = entries;
      const btn = document.createElement("button");
      btn.className = "icon-btn pl-toggle-bool";
      btn.dataset.toggleId = def.id;
      btn.setAttribute(
        "aria-pressed",
        savedValue === onEntry.value ? "true" : "false",
      );
      btn.textContent = def.label || def.id;
      btn.addEventListener("click", () => {
        const current = localStorage.getItem(storageKey) || defaultValue;
        const next = current === onEntry.value ? offEntry.value : onEntry.value;
        applyValue(next);
        btn.setAttribute(
          "aria-pressed",
          next === onEntry.value ? "true" : "false",
        );
      });
      container.appendChild(btn);
      applyValue(savedValue);
    } else {
      if (entries.length <= 1) return;
      const wrap = document.createElement("span");
      wrap.className = "pl-toggle-wrap";
      const sel = document.createElement("select");
      sel.className = "pl-toggle-select";
      sel.dataset.toggleId = def.id;
      sel.setAttribute("aria-label", def.label || def.id);
      entries.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === savedValue) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", () => applyValue(sel.value));
      if (def.label) {
        const lbl = document.createElement("label");
        lbl.className = "pl-toggle-label";
        lbl.textContent = def.label;
        lbl.appendChild(sel);
        wrap.appendChild(lbl);
      } else {
        wrap.appendChild(sel);
      }
      container.appendChild(wrap);
      applyValue(savedValue);
    }
  });
};

/* ── Helpers ──────────────────────────────────────────── */
const escHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const $ = (id) => document.getElementById(id);
setupToggles();
const VIEWPORT_WIDTHS = UI_CONFIG.preview?.viewportPresets || {
  full: null,
  desktop: 1440,
  tablet: 768,
  mobile: 375,
};
const nodeMap = new Map();
const familyById = new Map();
// nodeId → { li, iconEl, parentId, nodeType }
const nodeTreeMap = new Map();

const collectFamilies = (node) => {
  if (node.type === "component") {
    const options = [
      { id: node.id, label: "Default", outputPath: node.outputPath },
    ].concat(
      (node.variations || []).map((v) => ({
        id: v.id,
        label: v.label,
        outputPath: v.outputPath,
      })),
    );
    for (const option of options)
      familyById.set(option.id, {
        baseId: node.id,
        options,
        baseLabel: node.label,
      });
  }
  for (const child of node.children || []) collectFamilies(child);
};
collectFamilies(TREE);

/* ── View management ─────────────────────────────────── */
let activeId = null;
let activeViewport = "full";

const setRoute = (id, { replace = false } = {}) => {
  const nextUrl = id ? "?id=" + encodeURIComponent(id) : location.pathname;
  const currentUrl = location.pathname + location.search;
  if (nextUrl === currentUrl) return;
  const method = replace ? "replaceState" : "pushState";
  history[method]({}, "", nextUrl);
};

const showNodeById = (id, options = {}) => {
  if (!id) {
    showHome(options);
    return;
  }

  const entry = nodeMap.get(id);
  if (!entry) {
    showHome(options);
    return;
  }

  const { node } = entry;
  if (node.type === "folder") {
    showFolder(node, options);
    return;
  }

  showComponent(
    node.defaultFor || node.id,
    node.outputPath,
    node.label,
    options,
  );
};

const syncViewToLocation = (options = {}) => {
  const routeId = new URLSearchParams(location.search).get("id");
  showNodeById(routeId, options);
};

const refreshActive = () => {
  const activeFamily = familyById.get(activeId);
  for (const [id, { btnEl, node }] of nodeMap) {
    const isSelf = id === activeId;
    const isDefault = node.defaultFor === activeId;
    const isParentOfActive =
      node.type === "component" &&
      !isSelf &&
      activeFamily?.baseId === id;
    btnEl.classList.toggle("active", isSelf || isDefault || isParentOfActive);
    btnEl.classList.toggle("active-parent", isParentOfActive);
  }
};

const setViewportPreset = (size) => {
  activeViewport = VIEWPORT_WIDTHS[size] === undefined ? "full" : size;
  const shell = $("preview-shell");
  const host = $("preview-host");
  const maxW = Math.max(280, host.clientWidth - 16);
  const width = VIEWPORT_WIDTHS[activeViewport];
  shell.style.width = width == null ? "100%" : Math.min(width, maxW) + "px";
  shell.style.height = "100%";
  shell.style.maxWidth = "100%";
  shell.style.maxHeight = "100%";
  shell.dataset.size = activeViewport;
  document.querySelectorAll("[data-size]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.size === activeViewport);
  });
};

const setupViewportResizing = () => {
  if (!UI_CONFIG.enableResizeHandles) return;

  const shell = $("preview-shell");
  const host = $("preview-host");
  let drag = null;

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const maxW = Math.max(280, host.clientWidth - 16);
    const maxH = Math.max(220, host.clientHeight - 16);
    if (drag.mode === "right" || drag.mode === "corner") {
      const nextW = Math.min(maxW, Math.max(280, drag.startWidth + dx));
      shell.style.width = nextW + "px";
    }
    if (drag.mode === "bottom" || drag.mode === "corner") {
      const nextH = Math.min(maxH, Math.max(220, drag.startHeight + dy));
      shell.style.height = nextH + "px";
    }
    activeViewport = "custom";
    document
      .querySelectorAll("[data-size]")
      .forEach((btn) => btn.classList.remove("active"));
  };

  const clearDrag = () => {
    if (!drag) return;
    const handleEl = drag.handleEl;
    try {
      if (handleEl.hasPointerCapture(drag.pointerId))
        handleEl.releasePointerCapture(drag.pointerId);
    } catch {}
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", clearDrag);
    window.removeEventListener("pointercancel", clearDrag);
    window.removeEventListener("blur", clearDrag);
  };

  $("preview-shell").addEventListener("pointerdown", (e) => {
    const handleEl = e.target.closest("[data-resize]");
    if (!handleEl) return;
    const mode = handleEl.getAttribute("data-resize");
    e.preventDefault();
    drag = {
      mode,
      pointerId: e.pointerId,
      handleEl,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: shell.getBoundingClientRect().width,
      startHeight: shell.getBoundingClientRect().height,
    };
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", clearDrag);
    window.addEventListener("pointercancel", clearDrag);
    window.addEventListener("blur", clearDrag);
  });
};

const updateVariantSwitcher = (currentId) => {
  const tabs = $("variant-tabs");
  const family = familyById.get(currentId);
  if (!family || family.options.length < 2) {
    tabs.style.display = "none";
    tabs.innerHTML = "";
    return;
  }
  tabs.style.display = "flex";
  tabs.innerHTML = family.options
    .map(
      (option) =>
        '<button class="variant-tab' +
        (option.id === currentId ? " active" : "") +
        '" data-id="' +
        escHtml(option.id) +
        '" data-path="' +
        escHtml(option.outputPath) +
        '" data-label="' +
        escHtml(option.label) +
        '">' +
        escHtml(option.label) +
        "</button>",
    )
    .join("");
};

const hideAllPanels = () => {
  $("preview-host").style.display = "none";
  $("folder-view").style.display = "none";
  $("home-view").style.display = "none";
  $("empty-msg").style.display = "none";
  $("full-btn").style.display = "none";
  $("viewport-tools").style.display = "none";
  $("variant-tabs").style.display = "none";
};

const showEmpty = () => {
  hideAllPanels();
  $("empty-msg").style.display = "";
  $("breadcrumb").textContent = "";
  activeId = null;
  refreshActive();
};

/* ── Nav: expand tree to reveal a node ──────────────────── */
const expandToNode = (id) => {
  const entry = nodeTreeMap.get(id);
  if (!entry) return;
  let pid = entry.parentId;
  while (pid) {
    const p = nodeTreeMap.get(pid);
    if (!p) break;
    if (!p.li.classList.contains("open")) {
      p.li.classList.add("open");
      if (p.iconEl.textContent === "▶") p.iconEl.textContent = "▼";
    }
    pid = p.parentId;
  }
};

const showComponent = (
  id,
  outputPath,
  label,
  { updateHistory = true, replaceHistory = false } = {},
) => {
  activeId = id;
  hideAllPanels();
  $("preview-host").style.display = "";
  $("preview-frame").src = "/" + outputPath;
  const family = familyById.get(id);
  $("breadcrumb").textContent = family?.baseLabel || label;
  $("full-btn").style.display = "";
  $("viewport-tools").style.display = UI_CONFIG.showViewportControls
    ? ""
    : "none";
  setViewportPreset(activeViewport === "custom" ? "full" : activeViewport);
  $("full-btn").onclick = () => window.open("/" + outputPath, "_blank");
  if (updateHistory) setRoute(id, { replace: replaceHistory });
  updateVariantSwitcher(id);
  expandToNode(id);
  refreshActive();
  $("preview-frame").onload = () => {
    broadcastTogglesToFrame($("preview-frame").contentWindow);
  };
};

const flattenComponents = (node) => {
  const out = [];
  if (node.type === "component") {
    out.push(node);
    return out;
  }
  for (const child of node.children || [])
    out.push(...flattenComponents(child));
  return out;
};

/* ── Preview iframe: metadata-driven sizing ──────────────── */
const PREVIEW_NORMAL_H = UI_CONFIG.preview?.normalHeight ?? 220;
const PREVIEW_FULL_W = UI_CONFIG.preview?.fullWidth ?? 1440;
const PREVIEW_FULL_H = UI_CONFIG.preview?.fullHeight ?? 900;
const PREVIEW_FULL_MIN_H = UI_CONFIG.preview?.fullMinHeight ?? 140;
const PREVIEW_FULL_MAX_H = UI_CONFIG.preview?.fullMaxHeight ?? 280;

const normalizeCardDisplay = (value) => (value === "full" ? "full" : "normal");

const applyFullPreviewScale = (iframe) => {
  const preview = iframe.closest(".ccard-preview");
  const previewW = (preview ? preview.clientWidth : 0) || 280;
  const scale = Math.min(1, previewW / PREVIEW_FULL_W);

  iframe.style.width = PREVIEW_FULL_W + "px";
  iframe.style.height = PREVIEW_FULL_H + "px";
  iframe.style.transform = "scale(" + scale + ")";
  iframe.style.transformOrigin = "top left";

  if (preview) {
    preview.style.height =
      Math.max(
        PREVIEW_FULL_MIN_H,
        Math.min(PREVIEW_FULL_MAX_H, Math.round(PREVIEW_FULL_H * scale)),
      ) + "px";
  }
};

const initPreviewIframe = (iframe) => {
  const displayMode = normalizeCardDisplay(iframe.dataset.cardDisplay);
  const preview = iframe.closest(".ccard-preview");
  iframe.style.border = "none";
  iframe.style.display = "block";
  iframe.style.pointerEvents = "none";
  iframe.scrolling = "no";

  if (displayMode === "full") {
    applyFullPreviewScale(iframe);
  } else {
    iframe.style.width = "100%";
    iframe.style.height = PREVIEW_NORMAL_H + "px";
    iframe.style.transform = "none";
    iframe.style.transformOrigin = "top left";
    if (preview) preview.style.height = PREVIEW_NORMAL_H + "px";
  }

  iframe.addEventListener("load", () => {
    broadcastTogglesToFrame(iframe.contentWindow);
    if (displayMode === "full") {
      applyFullPreviewScale(iframe);
    }
  });
};

const refreshVisibleFolderCardScales = () => {
  document
    .querySelectorAll(
      '#folder-view .ccard-preview iframe[data-card-display="full"]',
    )
    .forEach(applyFullPreviewScale);
};

/* ── Folder view ─────────────────────────────────────────── */
const showFolder = (
  node,
  { updateHistory = true, replaceHistory = false } = {},
) => {
  activeId = node.id;
  hideAllPanels();
  $("breadcrumb").textContent = node.label;
  if (updateHistory) setRoute(node.id, { replace: replaceHistory });
  expandToNode(node.id);

  const directChildren = node.children || [];
  const fv = $("folder-view");
  fv.style.display = "";
  fv.innerHTML =
    directChildren
      .map((child) => {
        if (child.type === "folder") {
          const count = flattenComponents(child).length;
          return (
            '<div class="ccard ccard-folder" data-folder-id="' +
            escHtml(child.id) +
            '">' +
            '<div class="ccard-hd"><span class="ccard-title">' +
            escHtml(child.label) +
            "</span>" +
            '<button class="open-btn" data-act="folder" data-id="' +
            escHtml(child.id) +
            '">Open</button></div>' +
            '<p class="ccard-count">' +
            count +
            " component" +
            (count !== 1 ? "s" : "") +
            "</p>" +
            "</div>"
          );
        }
        const hasVars = (child.variations || []).length > 0;
        const varHtml = hasVars
          ? '<div class="ccard-vars">' +
            '<button class="var-btn var-default" data-act="comp" data-id="' +
            escHtml(child.id) +
            '" data-path="' +
            escHtml(child.outputPath) +
            '" data-label="' +
            escHtml(child.label) +
            '">Default</button>' +
            (child.variations || [])
              .map(
                (v) =>
                  '<button class="var-btn" data-act="comp" data-id="' +
                  escHtml(v.id) +
                  '" data-path="' +
                  escHtml(v.outputPath) +
                  '" data-label="' +
                  escHtml(v.label) +
                  '">' +
                  escHtml(v.label) +
                  "</button>",
              )
              .join("") +
            "</div>"
          : "";
        const cardDisplay = normalizeCardDisplay(child.cardDisplay);
        return (
          '<div class="ccard">' +
          '<div class="ccard-hd"><span class="ccard-title">' +
          escHtml(child.label) +
          "</span>" +
          '<button class="open-btn" data-act="comp" data-id="' +
          escHtml(child.id) +
          '" data-path="' +
          escHtml(child.outputPath) +
          '" data-label="' +
          escHtml(child.label) +
          '">Open</button></div>' +
          varHtml +
          '<div class="ccard-preview ccard-preview--' +
          escHtml(cardDisplay) +
          '"><iframe data-card-display="' +
          escHtml(cardDisplay) +
          '" src="/' +
          escHtml(child.outputPath) +
          '" loading="lazy" title="' +
          escHtml(child.label) +
          '"></iframe></div>' +
          "</div>"
        );
      })
      .join("") ||
    '<p style="color:var(--text-muted);grid-column:1/-1">No items in this folder.</p>';

  // Initialise preview iframes after layout
  requestAnimationFrame(() => {
    fv.querySelectorAll(".ccard-preview iframe").forEach(initPreviewIframe);
  });

  refreshActive();
};

/* ── Homepage ────────────────────────────────────────────── */
const showHome = ({ updateHistory = true, replaceHistory = false } = {}) => {
  activeId = null;
  hideAllPanels();
  $("breadcrumb").textContent = "";
  if (updateHistory) setRoute(null, { replace: replaceHistory });

  const hv = $("home-view");
  hv.style.display = "";

  const topFolders = (TREE.children || []).filter(
    (n) => n.type === "folder" && !n.hidden,
  );
  hv.innerHTML =
    topFolders
      .map((folder) => {
        const childLinks = (folder.children || [])
          .filter((c) => !c.hidden)
          .map((child) => {
            if (child.type === "folder") {
              return (
                '<li><button class="hlink" data-act="folder" data-id="' +
                escHtml(child.id) +
                '">📁 ' +
                escHtml(child.label) +
                "</button></li>"
              );
            }
            return (
              '<li><button class="hlink" data-act="comp" data-id="' +
              escHtml(child.id) +
              '" data-path="' +
              escHtml(child.outputPath) +
              '" data-label="' +
              escHtml(child.label) +
              '">◦ ' +
              escHtml(child.label) +
              "</button></li>"
            );
          })
          .join("");
        return (
          '<div class="hcard">' +
          '<div class="hcard-hd"><button class="hcard-title" data-act="folder" data-id="' +
          escHtml(folder.id) +
          '">' +
          escHtml(folder.label) +
          "</button></div>" +
          '<ul class="hcard-list">' +
          childLinks +
          "</ul>" +
          "</div>"
        );
      })
      .join("") || '<p style="color:var(--text-muted)">No folders found.</p>';

  refreshActive();
};

/* ── Tree building ───────────────────────────────────── */
const buildTree = (nodes, ulEl, depth, parentId) => {
  for (const node of nodes) {
    if (node.hidden) continue;
    const li = document.createElement("li");
    li.className =
      "tree-item " +
      (node.type === "folder"
        ? "tree-folder"
        : node.type === "variation"
          ? "tree-variation"
          : "tree-component");

    const btn = document.createElement("button");
    btn.className = "tree-btn";
    btn.style.paddingLeft = 0.75 + depth * 0.65 + "rem";

    const icon = document.createElement("span");
    icon.className = "icon";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = node.label;
    btn.append(icon, lbl);
    li.appendChild(btn);

    nodeMap.set(node.id, { node, btnEl: btn });
    nodeTreeMap.set(node.id, {
      li,
      iconEl: icon,
      parentId: parentId || null,
      nodeType: node.type,
    });

    const hasChildren =
      (node.type === "folder" && (node.children || []).length > 0) ||
      (node.type === "component" && (node.variations || []).length > 0);

    if (hasChildren) {
      icon.textContent = "▶";
      const childUl = document.createElement("ul");
      childUl.className = "tree tree-children";
      li.appendChild(childUl);
      const childNodes =
        node.type === "folder"
          ? node.children || []
          : [
              {
                type: "variation",
                id: node.id + "~default",
                label: "Default",
                outputPath: node.outputPath,
                defaultFor: node.id,
              },
            ].concat(node.variations || []);
      buildTree(
        childNodes,
        childUl,
        depth + 1,
        node.id,
      );

      if (node.type === "folder") {
        // Icon click: toggle expand/collapse only (no navigation)
        icon.addEventListener("click", (e) => {
          e.stopPropagation();
          const open = li.classList.toggle("open");
          icon.textContent = open ? "▼" : "▶";
        });
        // Label click: navigate to folder AND ensure expanded
        lbl.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!li.classList.contains("open")) {
            li.classList.add("open");
            icon.textContent = "▼";
          }
          showFolder(node);
        });
        // Button area outside icon/lbl: same as label
        btn.addEventListener("click", () => {
          if (!li.classList.contains("open")) {
            li.classList.add("open");
            icon.textContent = "▼";
          }
          showFolder(node);
        });
      } else {
        // Component with variations: toggle + show component
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const open = li.classList.toggle("open");
          icon.textContent = open ? "▼" : "▶";
          showComponent(node.id, node.outputPath, node.label);
        });
      }
    } else {
      icon.textContent = node.type === "variation" ? "◦" : "○";
      btn.addEventListener("click", () => {
        if (node.type === "folder") showFolder(node);
        else
          showComponent(
            node.defaultFor || node.id,
            node.outputPath,
            node.label,
          );
      });
    }

    ulEl.appendChild(li);
  }
};

buildTree(TREE.children || [], $("tree-root"), 0, null);
setupViewportResizing();
if (!UI_CONFIG.enableResizeHandles) {
  document.querySelectorAll(".resize-handle").forEach((el) => {
    el.style.display = "none";
  });
}
if (!UI_CONFIG.showDarkModeToggle) {
  if (modeBtn) modeBtn.style.display = "none";
}
document.querySelectorAll("#viewport-tools [data-size]").forEach((btn) => {
  btn.addEventListener("click", () => setViewportPreset(btn.dataset.size));
});
window.addEventListener("resize", () => {
  if ($("preview-host").style.display === "none") return;
  if (activeViewport === "custom") return;
  setViewportPreset(activeViewport);
});
window.addEventListener("resize", () => {
  refreshVisibleFolderCardScales();
});

$("variant-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".variant-tab");
  if (!btn || btn.classList.contains("active")) return;
  const f = familyById.get(btn.dataset.id);
  const target = f?.options.find((o) => o.id === btn.dataset.id);
  if (!target) return;
  showComponent(target.id, target.outputPath, target.label);
});

$("folder-view").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.dataset.act === "comp") {
    showComponent(btn.dataset.id, btn.dataset.path, btn.dataset.label);
  } else if (btn.dataset.act === "folder") {
    const entry = nodeMap.get(btn.dataset.id);
    if (entry) showFolder(entry.node);
  }
});

$("home-view").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.dataset.act === "comp") {
    showComponent(btn.dataset.id, btn.dataset.path, btn.dataset.label);
  } else if (btn.dataset.act === "folder") {
    const entry = nodeMap.get(btn.dataset.id);
    if (entry) showFolder(entry.node);
  }
});

window.addEventListener("popstate", () => {
  syncViewToLocation({ updateHistory: false });
});

syncViewToLocation({ replaceHistory: true });
