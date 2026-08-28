(() => {
  const CUSTOM_MIME = "application/x-shoe-view-meta";
  const PREVIEW_MAX_SIZE = 240;
  const LARGE_SOURCE_ATTRS = [
    "data-original",
    "data-original-src",
    "data-zoom-image",
    "data-large-image",
    "data-large",
    "data-hires",
    "data-high-res",
    "data-origin-src",
    "data-image"
  ];
  const LAZY_SOURCE_ATTRS = [
    "data-src",
    "data-lazy-src",
    "data-url"
  ];
  const SRCSET_ATTRS = ["srcset", "data-srcset", "data-lazy-srcset"];

  function extensionContextAvailable() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function safeSendMessage(message) {
    if (!extensionContextAvailable()) return;
    try {
      const pending = chrome.runtime.sendMessage(message);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      // Reloading/updating an unpacked extension invalidates content-script
      // contexts that were injected before the reload. Ignore the stale page
      // listener; a normal page refresh receives the new content script.
    }
  }

  function absoluteUrl(value) {
    if (!value) return "";
    const text = String(value).trim().replace(/^['"]|['"]$/g, "");
    if (!text) return "";
    if (text.startsWith("data:") || text.startsWith("blob:")) return text;
    try {
      return new URL(text, document.baseURI).href;
    } catch {
      return "";
    }
  }

  function parseSrcset(value) {
    if (!value) return [];
    return String(value)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = part.match(/^(\S+)(?:\s+([\d.]+)(w|x))?$/i);
        if (!match) return null;
        const url = absoluteUrl(match[1]);
        if (!url) return null;
        const amount = Number(match[2]) || 0;
        const unit = match[3] || "";
        const score = unit === "w" ? amount : unit === "x" ? amount * 1000 : 0;
        return { url, score, source: "srcset" };
      })
      .filter(Boolean);
  }

  function isLikelyImageUrl(url) {
    if (!url) return false;
    if (/^(data:image\/|blob:)/i.test(url)) return true;
    try {
      const parsed = new URL(url);
      return /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|svg)(?:$|[?#])/i.test(parsed.href) ||
        /(?:image|img|photo|picture|media|cdn)[=/_-]/i.test(parsed.href);
    } catch {
      return false;
    }
  }

  function findImageElement(target) {
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLImageElement) return target;
    const closest = target.closest("img");
    if (closest) return closest;
    return target.querySelector?.("img") || null;
  }

  function backgroundImageUrl(target) {
    if (!(target instanceof Element)) return "";
    try {
      const bg = getComputedStyle(target).backgroundImage;
      const match = bg && bg.match(/^url\(["']?(.*?)["']?\)$/i);
      return absoluteUrl(match?.[1] || "");
    } catch {
      return "";
    }
  }

  function createDragId() {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function makeImagePreview(img) {
    if (!(img instanceof HTMLImageElement) || !img.complete || !img.naturalWidth || !img.naturalHeight) return "";
    try {
      const scale = Math.min(1, PREVIEW_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) return "";
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL("image/webp", 0.82);
    } catch {
      // Cross-origin images without CORS taint the canvas. The side panel can
      // crop the already-rendered tab pixels as a no-network fallback.
      return "";
    }
  }

  function rectMeta(element) {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }

  function collectMeta(target, dragId = "") {
    const img = findImageElement(target);
    const candidates = [];
    const seen = new Set();

    function add(url, score, source) {
      const absolute = absoluteUrl(url);
      if (!absolute || seen.has(absolute)) return;
      seen.add(absolute);
      candidates.push({ url: absolute, score: Number(score) || 0, source });
    }

    let currentUrl = "";
    let width = 0;
    let height = 0;
    let alt = "";
    let previewUrl = "";
    let previewElement = null;

    if (img) {
      currentUrl = absoluteUrl(img.currentSrc || img.src || img.getAttribute("src"));
      width = img.naturalWidth || 0;
      height = img.naturalHeight || 0;
      alt = img.alt || "";
      previewUrl = makeImagePreview(img);
      previewElement = img;

      LARGE_SOURCE_ATTRS.forEach((attr, index) => add(img.getAttribute(attr), 9000 - index * 10, attr));
      SRCSET_ATTRS.forEach((attr) => {
        for (const candidate of parseSrcset(img.getAttribute(attr))) {
          add(candidate.url, 5000 + candidate.score, attr);
        }
      });
      add(img.currentSrc, 4200 + Math.max(width, height), "currentSrc");
      LAZY_SOURCE_ATTRS.forEach((attr, index) => add(img.getAttribute(attr), 4000 - index * 10, attr));
      add(img.src, 3000 + Math.max(width, height), "src");

      const picture = img.closest("picture");
      if (picture) {
        picture.querySelectorAll("source[srcset]").forEach((source) => {
          for (const candidate of parseSrcset(source.getAttribute("srcset"))) {
            add(candidate.url, 5200 + candidate.score, "picture-srcset");
          }
        });
      }

      const anchor = img.closest("a[href]");
      if (anchor) {
        const href = absoluteUrl(anchor.getAttribute("href"));
        if (isLikelyImageUrl(href)) add(href, 7000, "parent-link");
      }
    } else {
      const bgUrl = backgroundImageUrl(target);
      if (bgUrl) {
        currentUrl = bgUrl;
        add(bgUrl, 3000, "background-image");
        previewElement = target instanceof Element ? target : null;
      }
    }

    if (!candidates.length && !currentUrl) return null;
    candidates.sort((a, b) => b.score - a.score);
    const bestUrl = candidates[0]?.url || currentUrl;
    if (!currentUrl) currentUrl = bestUrl;

    return {
      currentUrl,
      bestUrl,
      previewUrl,
      candidates: candidates.slice(0, 24),
      width,
      height,
      alt,
      source: img ? "img" : "background-image",
      dragId,
      capturedAt: Date.now(),
      previewRect: rectMeta(previewElement),
      viewport: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0
      },
      isTopFrame: window === window.top
    };
  }

  document.addEventListener("dragstart", (event) => {
    const dragId = createDragId();
    const meta = collectMeta(event.target, dragId);
    if (!meta) return;

    try {
      event.dataTransfer?.setData(CUSTOM_MIME, JSON.stringify(meta));
    } catch {
      // Native page drag data remains available as a fallback.
    }

    safeSendMessage({ type: "RECORD_DRAG", meta });
  }, true);

  document.addEventListener("contextmenu", (event) => {
    const meta = collectMeta(event.target, createDragId());
    if (!meta) return;
    safeSendMessage({ type: "RECORD_CONTEXT", meta });
  }, true);

  if (!extensionContextAvailable()) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "RESOLVE_BLOB") return undefined;

    (async () => {
      try {
        const response = await fetch(message.url);
        const blob = await response.blob();
        if (!blob.size) throw new Error("Blob 内容为空");
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
          reader.readAsDataURL(blob);
        });
        sendResponse({ ok: true, dataUrl, mime: blob.type || "" });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();

    return true;
  });
})();
