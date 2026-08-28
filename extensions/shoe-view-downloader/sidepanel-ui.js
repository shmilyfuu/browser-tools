function sanitizePreviewSegment(value, fallback) {
  const text = String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "");
  return text || fallback;
}

function extensionGuess(item) {
  const mime = String(item?.mime || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("gif")) return "gif";
  const url = chooseUrl(item);
  try {
    const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) return match[1].toLowerCase().replace("jpeg", "jpg");
  } catch {
    // Data and blob URLs have no pathname extension.
  }
  return "jpg";
}

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.className = `toast show ${type}`;
  toastTimer = setTimeout(() => {
    els.toast.className = "toast";
  }, 2800);
}

async function persistQueue() {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

function persistFormSoon() {
  clearTimeout(saveFormTimer);
  saveFormTimer = setTimeout(() => {
    chrome.storage.local.set({
      [FORM_KEY]: {
        xxx: els.shoeCode.value,
        y: els.angleTag.value,
        date: els.dateStamp.value
      }
    }).catch(() => {});
  }, 180);
}

async function persistSettings() {
  settings = {
    preferOriginal: els.preferOriginal.checked,
    addDate: els.addDate.checked,
    clearImagesAfter: els.clearImagesAfter.checked,
    clearAngleAfter: els.clearAngleAfter.checked,
    clearShoeAfter: els.clearShoeAfter.checked
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  renderAll();
}

async function persistTags() {
  await chrome.storage.local.set({ [TAGS_KEY]: tags });
}

function findDuplicateIndexes() {
  const map = new Map();
  const duplicates = new Set();
  queue.forEach((item, index) => {
    if (!item) return;
    const url = chooseUrl(item);
    if (!url) return;
    if (map.has(url)) {
      duplicates.add(index);
      duplicates.add(map.get(url));
    } else {
      map.set(url, index);
    }
  });
  return duplicates;
}

function renderSlots() {
  const slots = Array.from(document.querySelectorAll(".image-slot"));
  const duplicates = findDuplicateIndexes();

  slots.forEach((slot, index) => {
    const item = queue[index];
    slot.classList.toggle("filled", Boolean(item));
    slot.draggable = Boolean(item);
    slot.innerHTML = "";

    const number = document.createElement("div");
    number.className = "slot-number";
    number.textContent = String(index + 1);
    slot.appendChild(number);

    if (!item) {
      const empty = document.createElement("div");
      empty.className = "slot-empty";
      empty.textContent = `拖入位置 ${index + 1}`;
      slot.appendChild(empty);
      return;
    }

    const img = document.createElement("img");
    img.className = "slot-image";
    img.src = item.previewUrl || chooseUrl(item);
    img.alt = item.alt || `图片 ${index + 1}`;
    img.draggable = false;
    img.referrerPolicy = "no-referrer-when-downgrade";
    img.addEventListener("error", () => {
      img.remove();
      const failed = document.createElement("div");
      failed.className = "slot-preview-error";
      failed.textContent = "预览失败\n原图地址已记录";
      slot.appendChild(failed);
    }, { once: true });
    slot.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "slot-meta";
    meta.textContent = item.width && item.height
      ? `${item.width} × ${item.height}`
      : (item.source === "local-file" ? "本地图片" : "网页图片");
    slot.appendChild(meta);

    const remove = document.createElement("button");
    remove.className = "slot-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `删除位置 ${index + 1}`);
    remove.textContent = "×";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      queue[index] = null;
      await persistQueue();
      renderAll();
    });
    slot.appendChild(remove);

    if (duplicates.has(index)) {
      const badge = document.createElement("div");
      badge.className = "duplicate-badge";
      badge.textContent = "重复图片";
      slot.appendChild(badge);
    }
  });
}

function renderTags() {
  els.tagList.innerHTML = "";
  els.tagList.classList.toggle("manage", tagManagerOpen);

  for (const tag of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `tag-chip${els.angleTag.value.trim() === tag ? " active" : ""}`;

    const label = document.createElement("span");
    label.textContent = tag;
    chip.appendChild(label);

    const del = document.createElement("span");
    del.className = "tag-delete";
    del.textContent = "×";
    chip.appendChild(del);

    chip.addEventListener("click", async (event) => {
      const clickedDelete = event.target.classList.contains("tag-delete");
      if (tagManagerOpen && clickedDelete) {
        tags = tags.filter((entry) => entry !== tag);
        await persistTags();
        renderTags();
        return;
      }
      els.angleTag.value = tag;
      persistFormSoon();
      renderAll();
    });

    els.tagList.appendChild(chip);
  }
}

function renderPreview() {
  const xxx = sanitizePreviewSegment(els.shoeCode.value, "xxx");
  const y = sanitizePreviewSegment(els.angleTag.value, "y");
  const date = sanitizePreviewSegment(els.dateStamp.value, "YYYYMMDD");
  const complete = Boolean(els.shoeCode.value.trim() && els.angleTag.value.trim());

  els.filenamePreview.innerHTML = "";
  for (let index = 0; index < QUEUE_SIZE; index += 1) {
    const parts = [xxx, y, String(index + 1)];
    if (settings.addDate) parts.push(date);
    const ext = queue[index] ? extensionGuess(queue[index]) : "jpg";
    const line = document.createElement("div");
    line.className = `filename-line${complete && queue[index] ? " ready" : ""}`;
    line.textContent = `${parts.join("-")}.${ext}`;
    els.filenamePreview.appendChild(line);
  }
  els.previewNote.textContent = complete ? "下载时会自动校正图片格式" : "请填写鞋款与角度";
}

function renderDirectoryStatus() {
  if (!els.directoryName || !els.directoryStatus || !els.chooseDirectoryBtn) return;

  els.directoryStatus.className = "helper-text directory-status";
  if (!directoryHandle) {
    els.directoryName.textContent = "尚未选择文件夹";
    els.directoryStatus.textContent = "选择一次后，扩展会记住这个文件夹。";
    els.chooseDirectoryBtn.textContent = "选择文件夹";
    return;
  }

  els.directoryName.textContent = `📁 ${directoryHandle.name}`;
  els.chooseDirectoryBtn.textContent = "更换文件夹";

  if (directoryPermission === "granted") {
    els.directoryStatus.textContent = "已授权，图片会直接写入这个文件夹。";
    els.directoryStatus.classList.add("granted");
  } else if (directoryPermission === "prompt") {
    els.directoryStatus.textContent = "已记住该文件夹，下载时可能需要重新授权一次。";
    els.directoryStatus.classList.add("prompt");
  } else if (directoryPermission === "denied") {
    els.directoryStatus.textContent = "当前没有写入权限，请重新选择文件夹。";
    els.directoryStatus.classList.add("denied");
  } else {
    els.directoryStatus.textContent = "已记住该文件夹。";
  }
}

function renderControls() {
  const count = queue.filter(Boolean).length;
  const next = queue.findIndex((item) => !item);
  const directoryReady = Boolean(directoryHandle) && directoryPermission !== "denied";
  els.queueCount.textContent = `${count} / 4`;
  els.nextSlotHint.textContent = next === -1 ? "四个位置已填满" : `自动放入位置 ${next + 1}`;
  if (!directoryHandle) {
    els.downloadBtn.textContent = "先选择保存文件夹";
  } else {
    els.downloadBtn.textContent = count ? `保存 ${count} 张图片` : "保存图片";
  }
  els.downloadBtn.disabled = !count || !els.shoeCode.value.trim() || !els.angleTag.value.trim() || !directoryReady;
}

function renderAll() {
  renderSlots();
  renderTags();
  renderPreview();
  renderDirectoryStatus();
  renderControls();
}

async function putMetaAt(meta, index) {
  const normalized = await ensurePreview(meta);
  if (!normalized) {
    showToast("没有识别到可用的图片内容。", "error");
    return;
  }
  if (index < 0 || index >= QUEUE_SIZE) {
    showToast("四个位置已经填满。", "warning");
    return;
  }

  queue[index] = normalized;
  await persistQueue();
  renderAll();
  showToast(`图片已放入位置 ${index + 1}。`, "success");
}

async function handleExternalDrop(event, forcedIndex = null) {
  event.preventDefault();
  event.stopPropagation();
  const internal = event.dataTransfer?.getData("application/x-shoe-internal-slot");
  if (internal !== "" && internal != null) return;

  const meta = await extractDropMeta(event.dataTransfer);
  const index = forcedIndex == null ? queue.findIndex((item) => !item) : forcedIndex;
  await putMetaAt(meta, index);
}

function bindDropTarget(element, forcedIndex = null) {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    element.classList.add("drag-over");
  });
  element.addEventListener("dragleave", () => element.classList.remove("drag-over"));
  element.addEventListener("drop", async (event) => {
    element.classList.remove("drag-over");
    await handleExternalDrop(event, forcedIndex);
  });
}

function bindSlotReordering() {
  document.querySelectorAll(".image-slot").forEach((slot) => {
    const index = Number(slot.dataset.index);

    slot.addEventListener("dragstart", (event) => {
      if (!queue[index]) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData("application/x-shoe-internal-slot", String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("drag-over");
    });

    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));

    slot.addEventListener("drop", async (event) => {
      slot.classList.remove("drag-over");
      const internal = event.dataTransfer?.getData("application/x-shoe-internal-slot");
      if (internal !== "" && internal != null) {
        event.preventDefault();
        event.stopPropagation();
        const from = Number(internal);
        if (Number.isInteger(from) && from >= 0 && from < QUEUE_SIZE && from !== index) {
          [queue[from], queue[index]] = [queue[index], queue[from]];
          await persistQueue();
          renderAll();
        }
        return;
      }
      await handleExternalDrop(event, index);
    });
  });
}


