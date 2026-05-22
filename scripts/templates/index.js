'use strict';
const TREE = __TREE_JSON__;
const UI_CONFIG = __UI_CONFIG__;

/* ── Theme ────────────────────────────────────────────── */
const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pl-theme', theme);
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.textContent = theme === 'dark' ? '☀ Light' : '🌙 Dark';
  document.querySelectorAll('iframe').forEach((f) => {
    try { f.contentWindow.postMessage({ type: 'pl-theme', theme }, '*'); } catch {}
  });
};
const themeBtn = document.getElementById('theme-btn');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'light');

/* ── Helpers ──────────────────────────────────────────── */
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (id) => document.getElementById(id);
const VIEWPORT_WIDTHS = { full: null, desktop: 1440, tablet: 768, mobile: 375 };
const nodeMap = new Map();
const familyById = new Map();
// nodeId → { li, iconEl, parentId, nodeType }
const nodeTreeMap = new Map();

const collectFamilies = (node) => {
  if (node.type === 'component') {
    const options = [{ id: node.id, label: 'Default', outputPath: node.outputPath }]
      .concat((node.variations || []).map((v) => ({ id: v.id, label: v.label, outputPath: v.outputPath })));
    for (const option of options) familyById.set(option.id, { baseId: node.id, options, baseLabel: node.label });
  }
  for (const child of (node.children || [])) collectFamilies(child);
};
collectFamilies(TREE);

/* ── View management ─────────────────────────────────── */
let activeId = null;
let activeViewport = 'full';

const refreshActive = () => {
  for (const [id, { btnEl, node }] of nodeMap) {
    const active = id === activeId || node.defaultFor === activeId;
    btnEl.classList.toggle('active', active);
  }
};

const setViewportPreset = (size) => {
  activeViewport = VIEWPORT_WIDTHS[size] === undefined ? 'full' : size;
  const shell = $('preview-shell');
  const host = $('preview-host');
  const maxW = Math.max(280, host.clientWidth - 16);
  const width = VIEWPORT_WIDTHS[activeViewport];
  shell.style.width = width == null ? '100%' : Math.min(width, maxW) + 'px';
  shell.style.height = '100%';
  shell.style.maxWidth = '100%';
  shell.style.maxHeight = '100%';
  shell.dataset.size = activeViewport;
  document.querySelectorAll('[data-size]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.size === activeViewport);
  });
};

const setupViewportResizing = () => {
  if (!UI_CONFIG.enableResizeHandles) return;

  const shell = $('preview-shell');
  const host = $('preview-host');
  let drag = null;

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const maxW = Math.max(280, host.clientWidth - 16);
    const maxH = Math.max(220, host.clientHeight - 16);
    if (drag.mode === 'right' || drag.mode === 'corner') {
      const nextW = Math.min(maxW, Math.max(280, drag.startWidth + dx));
      shell.style.width = nextW + 'px';
    }
    if (drag.mode === 'bottom' || drag.mode === 'corner') {
      const nextH = Math.min(maxH, Math.max(220, drag.startHeight + dy));
      shell.style.height = nextH + 'px';
    }
    activeViewport = 'custom';
    document.querySelectorAll('[data-size]').forEach((btn) => btn.classList.remove('active'));
  };

  const clearDrag = () => {
    if (!drag) return;
    const handleEl = drag.handleEl;
    try {
      if (handleEl.hasPointerCapture(drag.pointerId)) handleEl.releasePointerCapture(drag.pointerId);
    } catch {}
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', clearDrag);
    window.removeEventListener('pointercancel', clearDrag);
    window.removeEventListener('blur', clearDrag);
  };

  $('preview-shell').addEventListener('pointerdown', (e) => {
    const handleEl = e.target.closest('[data-resize]');
    if (!handleEl) return;
    const mode = handleEl.getAttribute('data-resize');
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
    try { handleEl.setPointerCapture(e.pointerId); } catch {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('blur', clearDrag);
  });
};

const updateVariantSwitcher = (currentId) => {
  const wrap = $('variant-switch-wrap');
  const select = $('variant-switch');
  const family = familyById.get(currentId);
  if (!family || family.options.length < 2) {
    wrap.style.display = 'none';
    select.innerHTML = '';
    return;
  }
  wrap.style.display = 'inline-flex';
  select.innerHTML = family.options
    .map((option) => '<option value="' + escHtml(option.id) + '">' + escHtml(option.label) + '</option>')
    .join('');
  select.value = currentId;
};

const hideAllPanels = () => {
  $('preview-host').style.display = 'none';
  $('folder-view').style.display = 'none';
  $('home-view').style.display = 'none';
  $('empty-msg').style.display = 'none';
  $('full-btn').style.display = 'none';
  $('viewport-tools').style.display = 'none';
  $('variant-switch-wrap').style.display = 'none';
};

const showEmpty = () => {
  hideAllPanels();
  $('empty-msg').style.display = '';
  $('breadcrumb').textContent = '';
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
    if (p.nodeType === 'folder' && !p.li.classList.contains('open')) {
      p.li.classList.add('open');
      p.iconEl.textContent = '▼';
    }
    pid = p.parentId;
  }
};

const showComponent = (id, outputPath, label) => {
  activeId = id;
  hideAllPanels();
  $('preview-host').style.display = '';
  $('preview-frame').src = '/' + outputPath;
  $('breadcrumb').textContent = label;
  $('full-btn').style.display = '';
  $('viewport-tools').style.display = UI_CONFIG.showViewportControls ? '' : 'none';
  setViewportPreset(activeViewport === 'custom' ? 'full' : activeViewport);
  $('full-btn').onclick = () => window.open('/' + outputPath, '_blank');
  history.replaceState({}, '', '?id=' + encodeURIComponent(id));
  updateVariantSwitcher(id);
  expandToNode(id);
  refreshActive();
  $('preview-frame').onload = () => {
    try { $('preview-frame').contentWindow.postMessage({ type: 'pl-theme', theme: localStorage.getItem('pl-theme') || 'light' }, '*'); } catch {}
  };
};

const flattenComponents = (node) => {
  const out = [];
  if (node.type === 'component') { out.push(node); return out; }
  for (const child of (node.children || [])) out.push(...flattenComponents(child));
  return out;
};

/* ── Preview iframe: non-interactive, scale-to-fit ──────── */
const PREVIEW_RENDER_W = 1440;

const applyIframeScale = (iframe) => {
  const card = iframe.closest('.ccard');
  const cardW = (card ? card.offsetWidth : 0) || 280;
  try {
    const doc = iframe.contentDocument;
    if (!doc || !doc.documentElement) { return; }
    const sw = doc.documentElement.scrollWidth || PREVIEW_RENDER_W;
    const scale = Math.min(1, cardW / sw);
    iframe.style.transform = 'scale(' + scale + ')';
    iframe.style.transformOrigin = 'top left';
    // shrink the overflow wrapper height to match visible scaled content
    const preview = iframe.closest('.ccard-preview');
    if (preview) {
      const sh = doc.documentElement.scrollHeight || 300;
      preview.style.height = Math.min(220, Math.ceil(sh * scale)) + 'px';
    }
  } catch {
    const scale = cardW / PREVIEW_RENDER_W;
    iframe.style.transform = 'scale(' + scale + ')';
    iframe.style.transformOrigin = 'top left';
  }
};

const initPreviewIframe = (iframe) => {
  iframe.style.width = PREVIEW_RENDER_W + 'px';
  iframe.style.height = '900px';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  iframe.style.pointerEvents = 'none';
  iframe.addEventListener('load', () => {
    try { iframe.contentWindow.postMessage({ type: 'pl-theme', theme: localStorage.getItem('pl-theme') || 'light' }, '*'); } catch {}
    applyIframeScale(iframe);
  });
};

/* ── Folder view ─────────────────────────────────────────── */
const showFolder = (node) => {
  activeId = node.id;
  hideAllPanels();
  $('breadcrumb').textContent = node.label;
  history.replaceState({}, '', '?id=' + encodeURIComponent(node.id));
  expandToNode(node.id);

  const directChildren = node.children || [];
  const fv = $('folder-view');
  fv.style.display = '';
  fv.innerHTML = directChildren.map((child) => {
    if (child.type === 'folder') {
      const count = flattenComponents(child).length;
      return '<div class="ccard ccard-folder" data-folder-id="' + escHtml(child.id) + '">'
        + '<div class="ccard-hd"><span class="ccard-title">' + escHtml(child.label) + '</span>'
        + '<button class="open-btn" data-act="folder" data-id="' + escHtml(child.id) + '">Open</button></div>'
        + '<p class="ccard-count">' + count + ' component' + (count !== 1 ? 's' : '') + '</p>'
        + '</div>';
    }
    const hasVars = (child.variations || []).length > 0;
    const varHtml = hasVars
      ? '<div class="ccard-vars">'
        + '<button class="var-btn var-default" data-act="comp" data-id="' + escHtml(child.id) + '" data-path="' + escHtml(child.outputPath) + '" data-label="' + escHtml(child.label) + '">Default</button>'
        + (child.variations || []).map((v) =>
          '<button class="var-btn" data-act="comp" data-id="' + escHtml(v.id) + '" data-path="' + escHtml(v.outputPath) + '" data-label="' + escHtml(v.label) + '">' + escHtml(v.label) + '</button>'
        ).join('')
        + '</div>'
      : '';
    return '<div class="ccard">'
      + '<div class="ccard-hd"><span class="ccard-title">' + escHtml(child.label) + '</span>'
      + '<button class="open-btn" data-act="comp" data-id="' + escHtml(child.id) + '" data-path="' + escHtml(child.outputPath) + '" data-label="' + escHtml(child.label) + '">Open</button></div>'
      + varHtml
      + '<div class="ccard-preview"><iframe src="/' + escHtml(child.outputPath) + '" loading="lazy" title="' + escHtml(child.label) + '"></iframe></div>'
      + '</div>';
  }).join('') || '<p style="color:var(--text-muted);grid-column:1/-1">No items in this folder.</p>';

  // Initialise preview iframes after layout
  requestAnimationFrame(() => {
    fv.querySelectorAll('.ccard-preview iframe').forEach(initPreviewIframe);
  });

  refreshActive();
};

/* ── Homepage ────────────────────────────────────────────── */
const showHome = () => {
  activeId = null;
  hideAllPanels();
  $('breadcrumb').textContent = '';
  history.replaceState({}, '', location.pathname);

  const hv = $('home-view');
  hv.style.display = '';

  const topFolders = (TREE.children || []).filter((n) => n.type === 'folder' && !n.hidden);
  hv.innerHTML = topFolders.map((folder) => {
    const childLinks = (folder.children || []).filter((c) => !c.hidden).map((child) => {
      if (child.type === 'folder') {
        return '<li><button class="hlink" data-act="folder" data-id="' + escHtml(child.id) + '">📁 ' + escHtml(child.label) + '</button></li>';
      }
      return '<li><button class="hlink" data-act="comp" data-id="' + escHtml(child.id) + '" data-path="' + escHtml(child.outputPath) + '" data-label="' + escHtml(child.label) + '">◦ ' + escHtml(child.label) + '</button></li>';
    }).join('');
    return '<div class="hcard">'
      + '<div class="hcard-hd"><button class="hcard-title" data-act="folder" data-id="' + escHtml(folder.id) + '">' + escHtml(folder.label) + '</button></div>'
      + '<ul class="hcard-list">' + childLinks + '</ul>'
      + '</div>';
  }).join('') || '<p style="color:var(--text-muted)">No folders found.</p>';

  refreshActive();
};

/* ── Tree building ───────────────────────────────────── */
const buildTree = (nodes, ulEl, depth, parentId) => {
  for (const node of nodes) {
    if (node.hidden) continue;
    const li = document.createElement('li');
    li.className = 'tree-item ' + (node.type === 'folder' ? 'tree-folder' : node.type === 'variation' ? 'tree-variation' : 'tree-component');

    const btn = document.createElement('button');
    btn.className = 'tree-btn';
    btn.style.paddingLeft = (.75 + depth * .65) + 'rem';

    const icon = document.createElement('span');
    icon.className = 'icon';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = node.label;
    btn.append(icon, lbl);
    li.appendChild(btn);

    nodeMap.set(node.id, { node, btnEl: btn });
    nodeTreeMap.set(node.id, { li, iconEl: icon, parentId: parentId || null, nodeType: node.type });

    const hasChildren = (node.type === 'folder' && (node.children || []).length > 0)
      || (node.type === 'component' && (node.variations || []).length > 0);

    if (hasChildren) {
      icon.textContent = '▶';
      const childUl = document.createElement('ul');
      childUl.className = 'tree tree-children';
      li.appendChild(childUl);
      const childNodes = node.type === 'folder'
        ? (node.children || [])
        : ([{ type: 'variation', id: node.id + '~default', label: 'Default', outputPath: node.outputPath, defaultFor: node.id }].concat(node.variations || []));
      buildTree(childNodes, childUl, depth + 1, node.type === 'folder' ? node.id : parentId);

      if (node.type === 'folder') {
        // Icon click: toggle expand/collapse only (no navigation)
        icon.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = li.classList.toggle('open');
          icon.textContent = open ? '▼' : '▶';
        });
        // Label click: navigate to folder AND ensure expanded
        lbl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!li.classList.contains('open')) {
            li.classList.add('open');
            icon.textContent = '▼';
          }
          showFolder(node);
        });
        // Button area outside icon/lbl: same as label
        btn.addEventListener('click', () => {
          if (!li.classList.contains('open')) {
            li.classList.add('open');
            icon.textContent = '▼';
          }
          showFolder(node);
        });
      } else {
        // Component with variations: toggle + show component
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = li.classList.toggle('open');
          icon.textContent = open ? '▼' : '▶';
          showComponent(node.id, node.outputPath, node.label);
        });
      }
    } else {
      icon.textContent = node.type === 'variation' ? '◦' : '○';
      btn.addEventListener('click', () => {
        if (node.type === 'folder') showFolder(node);
        else showComponent(node.defaultFor || node.id, node.outputPath, node.label);
      });
    }

    ulEl.appendChild(li);
  }
};

buildTree(TREE.children || [], $('tree-root'), 0, null);
setupViewportResizing();
if (!UI_CONFIG.enableResizeHandles) {
  document.querySelectorAll('.resize-handle').forEach((el) => { el.style.display = 'none'; });
}
if (!UI_CONFIG.showThemeToggle) {
  if (themeBtn) themeBtn.style.display = 'none';
}
document.querySelectorAll('#viewport-tools [data-size]').forEach((btn) => {
  btn.addEventListener('click', () => setViewportPreset(btn.dataset.size));
});
window.addEventListener('resize', () => {
  if ($('preview-host').style.display === 'none') return;
  if (activeViewport === 'custom') return;
  setViewportPreset(activeViewport);
});

$('variant-switch').addEventListener('change', (e) => {
  const nextId = e.target.value;
  const family = familyById.get(nextId);
  const target = family?.options.find((item) => item.id === nextId);
  if (!target) return;
  showComponent(target.id, target.outputPath, target.label);
});

$('folder-view').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'comp') {
    showComponent(btn.dataset.id, btn.dataset.path, btn.dataset.label);
  } else if (btn.dataset.act === 'folder') {
    const entry = nodeMap.get(btn.dataset.id);
    if (entry) showFolder(entry.node);
  }
});

$('home-view').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'comp') {
    showComponent(btn.dataset.id, btn.dataset.path, btn.dataset.label);
  } else if (btn.dataset.act === 'folder') {
    const entry = nodeMap.get(btn.dataset.id);
    if (entry) showFolder(entry.node);
  }
});

const restoreId = new URLSearchParams(location.search).get('id');
if (restoreId && nodeMap.has(restoreId)) {
  const { node } = nodeMap.get(restoreId);
  if (node.type === 'folder') showFolder(node);
  else showComponent(node.defaultFor || node.id, node.outputPath, node.label);
} else {
  showHome();
}
