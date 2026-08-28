const CUSTOM_MIME = "application/x-shoe-view-meta";
const QUEUE_KEY = "shoeQueue";
const FORM_KEY = "shoeForm";
const SETTINGS_KEY = "shoeSettings";
const TAGS_KEY = "shoeTags";
const NOTICE_KEY = "uiNotice";
const QUEUE_SIZE = 4;
const PREVIEW_MAX_SIZE = 240;
const LAST_DRAG_MATCH_MS = 2000;

const DEFAULT_TAGS = ["外侧", "内侧", "正面", "后跟", "俯视", "45度"];
const DEFAULT_SETTINGS = {
  preferOriginal: true,
  addDate: true,
  clearImagesAfter: true,
  clearAngleAfter: true,
  clearShoeAfter: false
};

let queue = Array.from({ length: QUEUE_SIZE }, () => null);
let settings = { ...DEFAULT_SETTINGS };
let tags = [...DEFAULT_TAGS];
let tagManagerOpen = false;
let toastTimer = null;
let saveFormTimer = null;
let directoryHandle = null;
let directoryPermission = "missing";

const HANDLE_DB_NAME = "shoeViewDownloaderDb";
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE_NAME = "handles";
const DIRECTORY_HANDLE_KEY = "downloadDirectory";

const els = {};

function $(id) {
  return document.getElementById(id);
}

function todayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function normalizeQueue(value) {
  const result = Array.isArray(value)
    ? value.slice(0, QUEUE_SIZE).map((item) => item ? normalizeMeta(item) : null)
    : [];
  while (result.length < QUEUE_SIZE) result.push(null);
  return result;
}

function safeUrl(value, base = location.href) {
  if (!value) return "";
  const text = String(value).trim().replace(/^['"]|['"]$/g, "");
  if (!text) return "";
  if (text.startsWith("data:") || text.startsWith("blob:")) return text;
  try {
    return new URL(text, base).href;
  } catch {
    return "";
  }
}

function parseSrcset(value, base) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\S+)(?:\s+([\d.]+)(w|x))?$/i);
      if (!match) return null;
      const url = safeUrl(match[1], base);
      if (!url) return null;
      const amount = Number(match[2]) || 0;
      const unit = match[3] || "";
      const score = unit === "w" ? amount : unit === "x" ? amount * 1000 : 0;
      return { url, score, source: "drop-srcset" };
    })
    .filter(Boolean);
}

function chooseUrl(item) {
  if (!item) return "";
  return settings.preferOriginal
    ? (item.bestUrl || item.currentUrl || item.previewUrl || "")
    : (item.currentUrl || item.bestUrl || item.previewUrl || "");
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const currentUrl = meta.currentUrl || meta.url || meta.bestUrl || "";
  const bestUrl = meta.bestUrl || currentUrl;
  if (!currentUrl && !bestUrl) return null;
  const rawPreviewUrl = typeof meta.previewUrl === "string" ? meta.previewUrl : "";
  const previewUrl = /^data:image\//i.test(rawPreviewUrl) ? rawPreviewUrl : "";
  return {
    currentUrl,
    bestUrl,
    previewUrl,
    candidates: Array.isArray(meta.candidates) ? meta.candidates.slice(0, 24) : [],
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    alt: typeof meta.alt === "string" ? meta.alt : "",
    source: meta.source || "drop",
    mime: meta.mime || "",
    originalName: meta.originalName || "",
    tabId: Number.isInteger(meta.tabId) ? meta.tabId : null,
    frameId: Number.isInteger(meta.frameId) ? meta.frameId : null,
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

async function mergeWithLastDrag(meta) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_LAST_DRAG" });
    const last = normalizeMeta(response?.meta);
    if (!last) return meta;

    const age = Date.now() - (last.capturedAt || 0);
    if (!meta) return age <= 1200 ? last : null;

    const sameDrag = Boolean(meta.dragId && last.dragId && meta.dragId === last.dragId);
    const urls = new Set([meta.currentUrl, meta.bestUrl].filter(Boolean));
    const lastUrls = [last.currentUrl, last.bestUrl].filter(Boolean);
    const sameUrl = lastUrls.some((url) => urls.has(url));
    if (!sameDrag && !(sameUrl && age <= LAST_DRAG_MATCH_MS)) return meta;

    return normalizeMeta({
      ...last,
      ...meta,
      currentUrl: meta.currentUrl || last.currentUrl,
      bestUrl: last.bestUrl || meta.bestUrl,
      previewUrl: meta.previewUrl || last.previewUrl,
      candidates: last.candidates?.length ? last.candidates : meta.candidates,
      tabId: Number.isInteger(last.tabId) ? last.tabId : meta.tabId,
      frameId: Number.isInteger(last.frameId) ? last.frameId : meta.frameId,
      previewRect: meta.previewRect || last.previewRect,
      viewport: meta.viewport || last.viewport,
      isTopFrame: meta.isTopFrame || last.isTopFrame,
      dragId: meta.dragId || last.dragId,
      capturedAt: Math.max(meta.capturedAt || 0, last.capturedAt || 0)
    });
  } catch {
    return meta;
  }
}

async function imageBitmapToPreview(bitmap) {
  const scale = Math.min(1, PREVIEW_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/webp", 0.82);
}

async function fileToPreview(file) {
  if (!file || !file.type?.startsWith("image/") || !file.size) return "";
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) return "";
    return await imageBitmapToPreview(bitmap);
  } catch {
    return "";
  } finally {
    bitmap?.close?.();
  }
}

async function fileToMeta(file) {
  if (!file || !file.type?.startsWith("image/") || !file.size) return null;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) return null;
  } catch {
    return null;
  }

  const bitmapWidth = bitmap.width;
  const bitmapHeight = bitmap.height;
  const previewUrl = await imageBitmapToPreview(bitmap).catch(() => "");
  bitmap.close?.();

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;

  return normalizeMeta({
    currentUrl: dataUrl,
    bestUrl: dataUrl,
    previewUrl: previewUrl || dataUrl,
    width: bitmapWidth,
    height: bitmapHeight,
    mime: file.type,
    originalName: file.name,
    source: "local-file"
  });
}

function metaFromHtml(html, fallbackUri = "") {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const img = doc.querySelector("img");
  if (!img) return null;

  const candidates = [];
  const seen = new Set();
  const base = fallbackUri || location.href;
  function add(url, score, source) {
    const absolute = safeUrl(url, base);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    candidates.push({ url: absolute, score, source });
  }

  ["data-original", "data-original-src", "data-zoom-image", "data-large-image", "data-hires", "data-high-res"]
    .forEach((attr, index) => add(img.getAttribute(attr), 9000 - index, attr));

  ["srcset", "data-srcset", "data-lazy-srcset"].forEach((attr) => {
    parseSrcset(img.getAttribute(attr), base).forEach((candidate) => add(candidate.url, 5000 + candidate.score, attr));
  });

  ["data-src", "data-lazy-src", "src"].forEach((attr, index) => add(img.getAttribute(attr), 4000 - index * 500, attr));
  candidates.sort((a, b) => b.score - a.score);

  const currentUrl = safeUrl(img.getAttribute("src"), base) || fallbackUri || candidates[0]?.url || "";
  return normalizeMeta({
    currentUrl,
    bestUrl: candidates[0]?.url || currentUrl,
    previewUrl: "",
    candidates,
    alt: img.getAttribute("alt") || "",
    source: "drop-html"
  });
}

async function extractDropMeta(dataTransfer) {
  if (!dataTransfer) return null;

  // Copy the File reference while the drop event is active. Windows Chrome
  // often exposes a webpage image here; we only use it as a local preview
  // source when URL metadata is available, never as the preferred final URL.
  const imageFile = Array.from(dataTransfer.files || [])
    .find((file) => file.type?.startsWith("image/") && file.size > 0) || null;

  async function attachLocalFilePreview(meta) {
    if (!meta || /^data:image\//i.test(meta.previewUrl || "") || !imageFile) return meta;
    const previewUrl = await fileToPreview(imageFile);
    return previewUrl ? normalizeMeta({ ...meta, previewUrl }) : meta;
  }

  try {
    const custom = dataTransfer.getData(CUSTOM_MIME);
    if (custom) {
      let parsed = normalizeMeta(JSON.parse(custom));
      parsed = await attachLocalFilePreview(parsed);
      return mergeWithLastDrag(parsed);
    }
  } catch {
    // Continue through native drag formats.
  }

  const uri = (dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain") || "")
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#")) || "";
  const html = dataTransfer.getData("text/html") || "";
  let fromHtml = metaFromHtml(html, uri);
  if (fromHtml) {
    fromHtml.previewUrl = "";
    fromHtml = await attachLocalFilePreview(fromHtml);
    return mergeWithLastDrag(fromHtml);
  }

  const directUrl = safeUrl(uri);
  if (directUrl) {
    let directMeta = normalizeMeta({
      currentUrl: directUrl,
      bestUrl: directUrl,
      previewUrl: "",
      source: "drop-uri"
    });
    directMeta = await attachLocalFilePreview(directMeta);
    return mergeWithLastDrag(directMeta);
  }

  // Only use a temporary File as the whole item when no usable URL metadata
  // exists. Empty and undecodable virtual files were filtered above.
  if (imageFile) return fileToMeta(imageFile);

  return mergeWithLastDrag(null);
}

async function cropCapturedPreview(meta) {
  if (!meta?.isTopFrame) return "";
  const rect = meta.previewRect;
  const viewport = meta.viewport;
  if (!rect?.width || !rect?.height || !viewport?.width || !viewport?.height) return "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE_PREVIEW",
      tabId: Number.isInteger(meta.tabId) ? meta.tabId : null
    });
    if (!response?.ok || !response.dataUrl) return "";

    const screenshot = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("截图预览读取失败"));
      img.src = response.dataUrl;
    });

    const scaleX = screenshot.naturalWidth / viewport.width;
    const scaleY = screenshot.naturalHeight / viewport.height;
    let sx = Math.max(0, rect.x * scaleX);
    let sy = Math.max(0, rect.y * scaleY);
    let sw = Math.max(1, rect.width * scaleX);
    let sh = Math.max(1, rect.height * scaleY);

    if (sx >= screenshot.naturalWidth || sy >= screenshot.naturalHeight) return "";
    sw = Math.min(sw, screenshot.naturalWidth - sx);
    sh = Math.min(sh, screenshot.naturalHeight - sy);

    const scale = Math.min(1, PREVIEW_MAX_SIZE / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return "";
    ctx.drawImage(screenshot, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.toDataURL("image/webp", 0.82);
  } catch {
    return "";
  }
}

async function ensurePreview(meta) {
  const normalized = normalizeMeta(meta);
  if (!normalized) return null;
  if (/^data:image\//i.test(normalized.previewUrl)) return normalized;

  const captured = await cropCapturedPreview(normalized);
  if (captured) {
    normalized.previewUrl = captured;
    return normalized;
  }

  // Do not fall back to a remote URL here. A preview is optional; assigning
  // currentUrl/bestUrl to <img> would download the image again while dragging.
  normalized.previewUrl = "";
  return normalized;
}

