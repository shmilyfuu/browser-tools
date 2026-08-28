const QUEUE_KEY = "shoeQueue";
const NOTICE_KEY = "uiNotice";
const QUEUE_SIZE = 4;
const LAST_DRAG_TTL_MS = 3000;

const lastDragByTab = new Map();
const lastContextByTab = new Map();
let lastDragGlobal = null;

function blankQueue() {
  return Array.from({ length: QUEUE_SIZE }, () => null);
}

function normalizeQueue(value) {
  const queue = Array.isArray(value) ? value.slice(0, QUEUE_SIZE) : [];
  while (queue.length < QUEUE_SIZE) queue.push(null);
  return queue;
}

function normalizeMeta(meta, tabId, frameId = null) {
  if (!meta || typeof meta !== "object") return null;
  const currentUrl = meta.currentUrl || meta.url || meta.bestUrl || "";
  const bestUrl = meta.bestUrl || currentUrl;
  if (!currentUrl && !bestUrl) return null;
  return {
    currentUrl,
    bestUrl,
    previewUrl: meta.previewUrl || "",
    candidates: Array.isArray(meta.candidates) ? meta.candidates.slice(0, 24) : [],
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    alt: typeof meta.alt === "string" ? meta.alt.slice(0, 200) : "",
    source: meta.source || "page",
    mime: meta.mime || "",
    originalName: meta.originalName || "",
    tabId: Number.isInteger(tabId) ? tabId : (Number.isInteger(meta.tabId) ? meta.tabId : null),
    frameId: Number.isInteger(frameId) ? frameId : (Number.isInteger(meta.frameId) ? meta.frameId : null),
    dragId: typeof meta.dragId === "string" ? meta.dragId : "",
    capturedAt: Number(meta.capturedAt) || Date.now(),
    previewRect: meta.previewRect && typeof meta.previewRect === "object" ? {
      x: Number(meta.previewRect.x) || 0,
      y: Number(meta.previewRect.y) || 0,
      width: Number(meta.previewRect.width) || 0,
      height: Number(meta.previewRect.height) || 0
    } : null,
    viewport: meta.viewport && typeof meta.viewport === "object" ? {
      width: Number(meta.viewport.width) || 0,
      height: Number(meta.viewport.height) || 0
    } : null,
    isTopFrame: meta.isTopFrame === true
  };
}

async function setNotice(message, type = "info") {
  await chrome.storage.session.set({
    [NOTICE_KEY]: { message, type, at: Date.now() }
  });
}

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Unable to configure side panel behavior", error);
  }
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "shoe-downloader-root",
      title: "鞋图下载器",
      contexts: ["image"]
    });
    chrome.contextMenus.create({
      id: "shoe-add-next",
      parentId: "shoe-downloader-root",
      title: "放入下一个空位",
      contexts: ["image"]
    });
    for (let i = 0; i < QUEUE_SIZE; i += 1) {
      chrome.contextMenus.create({
        id: `shoe-add-${i}`,
        parentId: "shoe-downloader-root",
        title: `放入位置 ${i + 1}`,
        contexts: ["image"]
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus();
  configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
});

configureSidePanel();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!String(info.menuItemId).startsWith("shoe-add-")) return;

  const tabId = tab?.id;
  const captured = Number.isInteger(tabId) ? lastContextByTab.get(tabId) : null;
  const fallback = info.srcUrl ? { currentUrl: info.srcUrl, bestUrl: info.srcUrl, previewUrl: info.srcUrl } : null;
  const item = normalizeMeta(captured || fallback, tabId, 0);

  if (!item) {
    await setNotice("没有读取到这张图片的地址。", "error");
    return;
  }

  const stored = await chrome.storage.local.get({ [QUEUE_KEY]: blankQueue() });
  const queue = normalizeQueue(stored[QUEUE_KEY]);

  let index = -1;
  if (info.menuItemId === "shoe-add-next") {
    index = queue.findIndex((entry) => !entry);
  } else {
    const match = String(info.menuItemId).match(/^shoe-add-(\d)$/);
    if (match) index = Number(match[1]);
  }

  if (index < 0 || index >= QUEUE_SIZE) {
    await setNotice("四个位置已经填满，可以先调整或清空一个位置。", "warning");
  } else {
    queue[index] = item;
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    await setNotice(`图片已放入位置 ${index + 1}。`, "success");
  }

  if (Number.isInteger(tabId)) {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (error) {
      console.debug("Side panel could not be opened from context menu", error);
    }
  }
});

async function clearDragState() {
  lastDragByTab.clear();
  lastDragGlobal = null;
  await chrome.storage.session.remove("lastDragGlobal");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "RECORD_DRAG") {
    const tabId = sender.tab?.id;
    const meta = normalizeMeta(message.meta, tabId, sender.frameId);
    if (meta) {
      if (Number.isInteger(tabId)) lastDragByTab.set(tabId, meta);
      lastDragGlobal = meta;
      chrome.storage.session.set({ lastDragGlobal: meta }).catch(() => {});
    }
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.type === "RECORD_CONTEXT") {
    const tabId = sender.tab?.id;
    const meta = normalizeMeta(message.meta, tabId, sender.frameId);
    if (meta && Number.isInteger(tabId)) lastContextByTab.set(tabId, meta);
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.type === "GET_LAST_DRAG") {
    (async () => {
      let meta = lastDragGlobal;
      if (!meta) {
        const stored = await chrome.storage.session.get("lastDragGlobal");
        meta = stored.lastDragGlobal || null;
      }
      if (meta && Date.now() - (meta.capturedAt || 0) > LAST_DRAG_TTL_MS) meta = null;
      sendResponse({ ok: true, meta });
    })();
    return true;
  }

  if (message.type === "CLEAR_DRAG_STATE") {
    clearDragState()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.type === "CAPTURE_VISIBLE_PREVIEW") {
    (async () => {
      try {
        const tabId = Number(message.tabId);
        if (!Number.isInteger(tabId)) throw new Error("缺少标签页信息");
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.active) throw new Error("原网页当前不在活动标签页");
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        sendResponse({ ok: true, dataUrl });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === "PREPARE_BATCH") {
    prepareBatch(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  return undefined;
});

function sanitizeSegment(value, fallback = "未命名") {
  let text = String(value ?? "").trim();
  text = text.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  text = text.replace(/[. ]+$/g, "");
  if (!text) text = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text)) text = `_${text}`;
  return text.slice(0, 100);
}

function extensionFromMime(mime) {
  const clean = String(mime || "").split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tif",
    "image/svg+xml": "svg"
  };
  return map[clean] || "";
}

function extensionFromUrl(url) {
  try {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;,]+)/i);
      return extensionFromMime(match?.[1] || "");
    }
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (!match) return "";
    const ext = match[1].toLowerCase();
    const allowed = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "tif", "tiff", "svg"]);
    if (!allowed.has(ext)) return "";
    return ext === "jpeg" ? "jpg" : ext === "tiff" ? "tif" : ext;
  } catch {
    return "";
  }
}

async function resolveBlobUrl(item, url) {
  if (!url.startsWith("blob:")) return url;
  if (!Number.isInteger(item.tabId)) throw new Error("这张图片使用临时 Blob 地址，已经找不到原网页上下文。请重新从页面拖入后再保存。");
  const response = await chrome.tabs.sendMessage(item.tabId, { type: "RESOLVE_BLOB", url });
  if (!response?.ok || !response.dataUrl) {
    throw new Error(response?.error || "Blob 图片读取失败，请重新拖入图片后再试。");
  }
  return response.dataUrl;
}

function guessExtension(url, item) {
  return extensionFromMime(item.mime) || extensionFromUrl(url) || "jpg";
}

async function prepareBatch(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const xxx = String(payload?.xxx || "").trim();
  const y = String(payload?.y || "").trim();
  const date = String(payload?.date || "").trim();
  const addDate = payload?.addDate !== false;
  const preferOriginal = payload?.preferOriginal !== false;

  if (!xxx) throw new Error("请先填写鞋款 xxx。");
  if (!y) throw new Error("请先填写角度 y。");
  if (!items.some(Boolean)) throw new Error("四个位置里还没有图片。");

  const tokens = {
    xxx: sanitizeSegment(xxx),
    y: sanitizeSegment(y),
    date: sanitizeSegment(date || "date")
  };

  const prepared = await Promise.all(items.map(async (item, index) => {
    if (!item) return null;
    try {
      let url = preferOriginal ? (item.bestUrl || item.currentUrl) : (item.currentUrl || item.bestUrl);
      if (!url) throw new Error("图片地址为空。");
      url = await resolveBlobUrl(item, url);
      const extGuess = guessExtension(url, item);
      const baseParts = [tokens.xxx, tokens.y, String(index + 1)];
      if (addDate && date) baseParts.push(tokens.date);
      return {
        index,
        ok: true,
        url,
        baseName: baseParts.join("-"),
        extGuess,
        mime: item.mime || ""
      };
    } catch (error) {
      return { index, ok: false, error: error?.message || String(error) };
    }
  }));

  const results = prepared.filter(Boolean);
  const failed = results.filter((entry) => !entry.ok).length;
  return { results, failed };
}
