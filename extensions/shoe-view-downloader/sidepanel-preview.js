// v1.2.1: preview rendering must stay local. Remote image URLs are retained only
// for the final save operation and are never assigned to a side-panel <img>.
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

    if (item.previewUrl) {
      const img = document.createElement("img");
      img.className = "slot-image";
      img.src = item.previewUrl;
      img.alt = item.alt || `图片 ${index + 1}`;
      img.draggable = false;
      img.addEventListener("error", () => {
        img.remove();
        const failed = document.createElement("div");
        failed.className = "slot-preview-error";
        failed.textContent = "预览生成失败\n原图地址已记录";
        slot.appendChild(failed);
      }, { once: true });
      slot.appendChild(img);
    } else {
      const failed = document.createElement("div");
      failed.className = "slot-preview-error";
      failed.textContent = "未生成本地预览\n原图地址已记录";
      slot.appendChild(failed);
    }

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
