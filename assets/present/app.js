/* Presentation admin — same logic as pb-marketer-tv's admin.js (pairing, library, single
   "Default" playlist, playback control), minus the admin lock, debug telemetry and app updater. */
"use strict";

const TOKEN_KEY = "hume.present.token";
const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  media: [],
  filter: "all",
  playlist: null,
  draft: null,
  dirty: false,
  tab: "library",
  open: new Set(),
  playing: true,
};
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bind();
  loadInfo();
  if (state.token) { showApp(); refreshAll({ preserveDirty: false }); } else { showPair(); }
  setInterval(() => { if (state.token) refreshPlayback(); }, 3000);
  window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });
});

/* ------------------------------------------------------------------ wiring */

function bind() {
  // Pairing: six boxes, auto-advance, paste-friendly, auto-submit.
  const boxes = [...document.querySelectorAll("#pinBoxes input")];
  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/\D/g, "").slice(-1);
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
      const pin = boxes.map((b) => b.value).join("");
      $("pairBtn").disabled = pin.length !== 6;
      if (pin.length === 6) $("pairForm").requestSubmit();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && boxes[i - 1]) boxes[i - 1].focus();
    });
    box.addEventListener("paste", (e) => {
      const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      digits.split("").forEach((d, k) => { if (boxes[k]) boxes[k].value = d; });
      boxes[Math.min(digits.length, 5)].focus();
      $("pairBtn").disabled = digits.length !== 6;
      if (digits.length === 6) $("pairForm").requestSubmit();
    });
  });
  $("pairForm").addEventListener("submit", pair);
  $("unpairBtn").addEventListener("click", () => { if (confirmLeave()) forgetPairing(); });

  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.filter)));
  document.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => control(b.dataset.cmd)));

  // Upload: click or drag & drop, multiple files.
  const drop = $("dropZone");
  $("fileInput").addEventListener("change", (e) => { uploadFiles([...e.target.files]); e.target.value = ""; });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); } });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); uploadFiles([...e.dataTransfer.files]); });

  $("addWebpageBtn").addEventListener("click", () => { $("webpageForm").classList.remove("hidden"); $("webpageUrl").focus(); });
  $("cancelWebpage").addEventListener("click", () => { $("webpageForm").classList.add("hidden"); $("webpageUrl").value = ""; });
  $("webpageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("webpageUrl").value.trim();
    if (!/^https?:\/\//.test(url)) { toast("Webpage address must start with http:// or https://", "error"); return; }
    addSlide({
      type: "webpage", url, durationSec: defaultDuration("webpage"), fitMode: "contain", muted: true, loop: false,
      webpageAutoScroll: true, webpageScrollSpeedPxPerSec: 40, webpageScrollPauseSec: 5, enabled: true,
    });
    $("webpageUrl").value = "";
    $("webpageForm").classList.add("hidden");
  });
  $("addMediaBtn").addEventListener("click", openPicker);
  $("saveBtn").addEventListener("click", savePlaylist);
  $("revertBtn").addEventListener("click", () => { state.draft = clone(state.playlist); setDirty(false); renderSlides(); });
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); closeConfirm(false); } });
}

/* ------------------------------------------------------------------ pairing */

async function loadInfo() {
  try {
    const info = await api("/api/info", { auth: false });
    if (info.device) $("deviceName").textContent = `${info.device}${info.versionName ? " · Hume " + info.versionName : ""}`;
  } catch (_) { /* shown when calls fail */ }
}

async function pair(e) {
  e.preventDefault();
  const boxes = [...document.querySelectorAll("#pinBoxes input")];
  const pin = boxes.map((b) => b.value).join("");
  if (pin.length !== 6) return;
  $("pairError").textContent = "";
  $("pairBtn").disabled = true;
  try {
    const res = await api("/api/pair", { auth: false, method: "POST", body: { pin } });
    state.token = res.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    showApp();
    await refreshAll({ preserveDirty: false });
    toast("Paired with the TV");
  } catch (err) {
    $("pairError").textContent = err.message;
    const g = $("pinBoxes");
    g.classList.remove("shake"); void g.offsetWidth; g.classList.add("shake");
    boxes.forEach((b) => (b.value = ""));
    boxes[0].focus();
  }
}

function forgetPairing() {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  setDirty(false);
  showPair();
}

function showPair() {
  $("pairView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  setTimeout(() => document.querySelector("#pinBoxes input").focus(), 50);
}

function showApp() {
  $("pairView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  setTab(state.tab);
}

/* ------------------------------------------------------------------ data */

async function refreshAll({ preserveDirty }) {
  try {
    await refreshMedia();
    await refreshPlaylist({ preserveDirty });
    await refreshPlayback();
  } catch (err) { handleError(err); }
}

async function refreshMedia() {
  const res = await api("/api/media");
  state.media = res.media || [];
  pruneDraftMissingMedia();
  renderMedia();
  renderSlides();
}

async function refreshPlaylist({ preserveDirty }) {
  const res = await api("/api/playlist");
  state.playlist = res.playlist || emptyPlaylist();
  if (preserveDirty && state.dirty && state.draft) { renderSaveBar(); return; }
  state.draft = clone(state.playlist);
  setDirty(false);
  renderSlides();
}

async function refreshPlayback() {
  try {
    const { playback: p = {} } = await api("/api/playback/status");
    const dot = $("nowDot");
    dot.className = "status-dot " + ({ playing: "playing", paused: "paused", error: "error" }[p.state] || "");
    state.playing = p.state !== "paused";
    $("playPause").dataset.cmd = state.playing ? "pause" : "play";
    $("playPause").title = state.playing ? "Pause" : "Play";
    $("ppIcon").setAttribute("d", state.playing ? "M8 5v14M16 5v14" : "M7 5l12 7-12 7z");
    if (!p.available) {
      $("nowTitle").textContent = "Not on screen";
      $("nowSub").textContent = "Open Presentation on the TV, or turn on “Start on boot” in Settings.";
    } else if (p.state === "empty") {
      $("nowTitle").textContent = "Nothing playing";
      $("nowSub").textContent = "Add slides in Playlist, then Save to TV.";
    } else {
      const label = { playing: "Playing", paused: "Paused", error: "Skipping", starting: "Starting" }[p.state] || p.state;
      $("nowTitle").textContent = p.slideCount > 0 ? `${label} · Slide ${p.slideIndex + 1} of ${p.slideCount}` : label;
      $("nowSub").textContent = [p.mediaName || p.url, p.error].filter(Boolean).join(" — ");
    }
  } catch (err) { handleError(err, true); }
}

/* ------------------------------------------------------------------ library */

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("libraryView").classList.toggle("hidden", tab !== "library");
  $("playlistView").classList.toggle("hidden", tab !== "playlist");
}

function setFilter(f) {
  state.filter = f;
  document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
  renderMedia();
}

function renderMedia() {
  const grid = $("mediaGrid");
  grid.innerHTML = "";
  $("mediaCount").textContent = state.media.length ? state.media.length : "";
  const items = state.media.filter((m) => state.filter === "all" || kind(m) === state.filter);
  if (!items.length) {
    grid.innerHTML = `<div class="empty">${state.filter === "all" ? "No files yet. Drop images or videos above." : `No ${state.filter}s yet.`}</div>`;
    return;
  }
  items.forEach((m) => {
    const t = kind(m);
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `
      <div class="thumb">${thumb(m)}<span class="kind">${t === "video" ? "Video" : t === "image" ? "Image" : "File"}</span></div>
      <div class="tile-body">
        <div class="tile-name" title="${esc(m.displayName)}">${esc(m.displayName)}</div>
        <div class="tile-meta">${formatBytes(m.sizeBytes)} · ${formatDate(m.createdAt)}</div>
        <div class="tile-actions">
          ${t ? `<button class="btn tinted small" data-a="add">Add to Playlist</button>` : ""}
          <button class="icon-btn danger" data-a="del" title="Delete" aria-label="Delete ${esc(m.displayName)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>
        </div>
      </div>`;
    el.querySelector('[data-a="add"]')?.addEventListener("click", () => { addMediaSlide(m); setTab("playlist"); });
    el.querySelector('[data-a="del"]').addEventListener("click", async () => {
      const ok = await confirmSheet(`Delete “${m.displayName}”?`, "It will be removed from the TV, along with any slides that use it.");
      if (!ok) return;
      try {
        await api(`/api/media/${m.id}`, { method: "DELETE" });
        removeMediaFromDraft(m.id);
        await refreshAll({ preserveDirty: true });
        toast("Deleted");
      } catch (err) { handleError(err); }
    });
    grid.appendChild(el);
  });
}

async function uploadFiles(files) {
  const list = files.filter((f) => /^(image|video)\//.test(mimeFor(f)));
  if (list.length < files.length) toast("Only images and videos can be uploaded", "error");
  for (const file of list) {
    const row = document.createElement("div");
    row.className = "upload";
    row.innerHTML = `<div class="upload-row"><span class="upload-name">${esc(file.name)}</span><span class="secondary" data-s>Waiting…</span></div><div class="bar"><i></i></div>`;
    $("uploads").prepend(row);
    try {
      await uploadOne(file, (pct) => { row.querySelector("i").style.width = pct + "%"; row.querySelector("[data-s]").textContent = `${pct}% of ${formatBytes(file.size)}`; });
      row.classList.add("done");
      row.querySelector("i").style.width = "100%";
      row.querySelector("[data-s]").textContent = "Uploaded";
      await refreshMedia();
      setTimeout(() => row.remove(), 2500);
    } catch (err) {
      row.classList.add("failed");
      row.querySelector("[data-s]").textContent = err.message || "Upload failed";
    }
  }
  if (list.length) toast(list.length === 1 ? `${list[0].name} uploaded` : `${list.length} files uploaded`);
}

function uploadOne(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("mimeType", mimeFor(file));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-File-Type", mimeFor(file));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      const data = safeJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) forgetPairing();
      reject(new Error(data.error || (data.errors || []).join("; ") || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check the TV is on and on the same network."));
    xhr.send(form);
  });
}

/* ------------------------------------------------------------------ playlist */

function renderSlides() {
  ensureDraft();
  const list = $("slides");
  const slides = state.draft.slides;
  $("slideCount").textContent = slides.length ? slides.length : "";
  $("loopTime").textContent = loopLabel(slides);
  list.innerHTML = "";
  $("slidesEmpty").classList.toggle("hidden", slides.length > 0);
  if (!slides.length) { renderSaveBar(); return; }

  slides.forEach((s, i) => {
    const m = s.mediaId ? state.media.find((x) => x.id === s.mediaId) : null;
    const title = s.type === "webpage" ? s.url || "Webpage" : m?.displayName || "Missing file";
    const enabled = s.enabled !== false;
    const row = document.createElement("div");
    row.className = `slide${state.open.has(s.id) ? " open" : ""}${enabled ? "" : " off"}`;
    row.dataset.index = i;
    row.innerHTML = `
      <div class="slide-row">
        <span class="handle" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 9h14M5 15h14"/></svg></span>
        <span class="slide-num">${i + 1}</span>
        <div class="slide-main" data-a="toggle" role="button" tabindex="0" aria-expanded="${state.open.has(s.id)}">
          <span class="slide-thumb">${s.type === "webpage" ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>` : m ? thumb(m) : ""}</span>
          <span class="slide-text">
            <div class="slide-title">${esc(title)}</div>
            <div class="slide-sub">${esc(summary(s))}</div>
          </span>
        </div>
        <label class="switch" title="${enabled ? "Showing" : "Hidden"}"><input type="checkbox" data-f="enabled" ${enabled ? "checked" : ""} aria-label="Show this slide"><span></span></label>
        <span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
      </div>
      <div class="inspector">${inspector(s)}</div>`;

    row.querySelector('[data-a="toggle"]').addEventListener("click", () => toggleOpen(s.id, row));
    row.querySelector('[data-a="toggle"]').addEventListener("keydown", (e) => { if (e.key === "Enter") toggleOpen(s.id, row); });
    row.querySelectorAll("[data-f]").forEach((input) => {
      const ev = input.type === "range" || input.type === "number" || input.tagName === "INPUT" && input.type !== "checkbox" ? "input" : "change";
      input.addEventListener(ev, () => updateField(i, input, row));
    });
    row.querySelectorAll("[data-fit]").forEach((b) => b.addEventListener("click", () => {
      s.fitMode = b.dataset.fit; markDirty();
      row.querySelectorAll("[data-fit]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      row.querySelector(".slide-sub").textContent = summary(s);
    }));
    row.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      const input = row.querySelector('[data-f="durationSec"]');
      input.value = Math.max(1, Number(input.value || 0) + Number(b.dataset.step));
      updateField(i, input, row);
    }));
    row.querySelector('[data-a="up"]')?.addEventListener("click", () => move(i, -1));
    row.querySelector('[data-a="down"]')?.addEventListener("click", () => move(i, 1));
    row.querySelector('[data-a="remove"]').addEventListener("click", () => removeSlide(i));
    enableDrag(row, i);
    list.appendChild(row);
  });
  renderSaveBar();
}

function inspector(s) {
  const fit = s.fitMode || "contain";
  const parts = [];
  if (s.type === "webpage") {
    parts.push(`<label class="field">Webpage address<input data-f="url" value="${esc(s.url || "")}" placeholder="https://example.com"></label>`);
  } else {
    const opts = state.media.filter((m) => kind(m) === s.type)
      .map((m) => `<option value="${m.id}" ${m.id === s.mediaId ? "selected" : ""}>${esc(m.displayName)}</option>`).join("");
    parts.push(`<label class="field">File<select data-f="mediaId">${opts}</select></label>`);
  }
  if (s.type !== "video") {
    parts.push(`<div class="field">${s.type === "webpage" ? "Time on screen (if it doesn’t scroll)" : "Time on screen"}
      <div class="row"><span class="stepper"><button type="button" data-step="-5" aria-label="5 seconds less">−</button><input data-f="durationSec" type="number" min="1" max="86400" value="${s.durationSec || defaultDuration(s.type)}" aria-label="Seconds"><button type="button" data-step="5" aria-label="5 seconds more">+</button></span><span>seconds</span></div></div>`);
  }
  parts.push(`<div class="field">Fit<div class="segmented small" role="group" aria-label="Fit">
    ${["contain", "cover", "fill"].map((f) => `<button type="button" data-fit="${f}" aria-pressed="${f === fit}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}</div></div>`);
  if (s.type === "video") {
    parts.push(`<div class="field">Sound<div class="switch-row">Muted<label class="switch"><input type="checkbox" data-f="muted" ${s.muted !== false ? "checked" : ""}><span></span></label></div></div>`);
  }
  if (s.type === "webpage") {
    const speed = s.webpageScrollSpeedPxPerSec || 40, wait = s.webpageScrollPauseSec ?? 5;
    parts.push(`<div class="field">Scrolling<div class="switch-row">Auto-scroll the page<label class="switch"><input type="checkbox" data-f="webpageAutoScroll" ${s.webpageAutoScroll !== false ? "checked" : ""}><span></span></label></div></div>`);
    parts.push(`<label class="field">Scroll speed<div class="row"><input data-f="webpageScrollSpeedPxPerSec" type="range" min="5" max="400" value="${Math.min(400, speed)}"><span class="val" data-v="speed">${speed} px/s</span></div></label>`);
    parts.push(`<label class="field">Pause between screens<div class="row"><input data-f="webpageScrollPauseSec" type="range" min="0" max="60" value="${Math.min(60, wait)}"><span class="val" data-v="wait">${wait} s</span></div></label>`);
  }
  parts.push(`<div class="inspector-actions">
    <button type="button" class="btn tinted small" data-a="up">Move Up</button>
    <button type="button" class="btn tinted small" data-a="down">Move Down</button>
    <span class="spacer"></span>
    <button type="button" class="btn plain small" style="color:var(--red)" data-a="remove">Remove Slide</button></div>`);
  return parts.join("");
}

function toggleOpen(id, row) {
  if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
  row.classList.toggle("open", state.open.has(id));
  row.querySelector('[data-a="toggle"]').setAttribute("aria-expanded", String(state.open.has(id)));
}

function updateField(i, input, row) {
  ensureDraft();
  const s = state.draft.slides[i];
  if (!s) return;
  const f = input.dataset.f;
  if (input.type === "checkbox") s[f] = input.checked;
  else if (["durationSec", "webpageScrollSpeedPxPerSec", "webpageScrollPauseSec"].includes(f)) s[f] = normalizeNumber(f, input.value);
  else s[f] = input.value;
  if (f === "enabled") row.classList.toggle("off", !input.checked);
  if (f === "webpageScrollSpeedPxPerSec") row.querySelector('[data-v="speed"]').textContent = `${s[f]} px/s`;
  if (f === "webpageScrollPauseSec") row.querySelector('[data-v="wait"]').textContent = `${s[f]} s`;
  if (f === "mediaId" || f === "url") {
    const m = state.media.find((x) => x.id === s.mediaId);
    row.querySelector(".slide-title").textContent = s.type === "webpage" ? s.url || "Webpage" : m?.displayName || "Missing file";
  }
  row.querySelector(".slide-sub").textContent = summary(s);
  $("loopTime").textContent = loopLabel(state.draft.slides);
  markDirty();
}

function addMediaSlide(m) {
  const type = kind(m);
  if (!type) { toast("Only images and videos can be slides", "error"); return; }
  addSlide({ type, mediaId: m.id, durationSec: type === "video" ? 0 : defaultDuration(type), fitMode: "contain", muted: true, loop: false, enabled: true });
}

function addSlide(slide) {
  ensureDraft();
  const created = { id: randomId(), order: state.draft.slides.length, ...slide };
  state.draft.slides.push(created);
  markDirty();
  renderSlides();
  toast("Slide added — Save to TV when ready");
}

function move(i, dir) {
  const t = i + dir, s = state.draft.slides;
  if (t < 0 || t >= s.length) return;
  [s[i], s[t]] = [s[t], s[i]];
  normalizeOrders(); markDirty(); renderSlides();
}

function moveTo(from, to) {
  const s = state.draft.slides;
  if (from === to || from < 0 || to < 0) return;
  const [item] = s.splice(from, 1);
  s.splice(to > from ? to - 1 : to, 0, item);
  normalizeOrders(); markDirty(); renderSlides();
}

function removeSlide(i) {
  state.draft.slides.splice(i, 1);
  normalizeOrders(); markDirty(); renderSlides();
}

function enableDrag(row, i) {
  const handle = row.querySelector(".handle");
  handle.addEventListener("mousedown", () => (row.draggable = true));
  handle.addEventListener("touchstart", () => (row.draggable = true), { passive: true });
  row.addEventListener("dragstart", (e) => { row.classList.add("dragging"); e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; });
  row.addEventListener("dragend", () => { row.draggable = false; row.classList.remove("dragging"); document.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before")); });
  row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-before"); });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before"));
  row.addEventListener("drop", (e) => { e.preventDefault(); moveTo(Number(e.dataTransfer.getData("text/plain")), i); });
}

function openPicker() {
  const items = state.media.filter((m) => kind(m));
  $("sheetTitle").textContent = "Add from Library";
  $("sheetBody").innerHTML = items.length
    ? `<div class="pick">${items.map((m) => `<button type="button" data-id="${m.id}"><div class="thumb">${thumb(m)}<span class="kind">${kind(m) === "video" ? "Video" : "Image"}</span></div><div class="tile-body"><div class="tile-name">${esc(m.displayName)}</div><div class="tile-meta">${formatBytes(m.sizeBytes)}</div></div></button>`).join("")}</div>`
    : `<div class="empty">Your Library is empty. Upload images or videos first.</div>`;
  $("sheetBody").querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => {
    addMediaSlide(state.media.find((m) => m.id === b.dataset.id));
    b.style.boxShadow = "0 0 0 2px var(--green)";
  }));
  $("sheet").classList.remove("hidden");
}

function closeSheet() { $("sheet").classList.add("hidden"); }

async function savePlaylist() {
  if (!state.dirty) return;
  ensureDraft();
  normalizeOrders();
  const errors = validateDraft();
  if (errors.length) { $("saveError").textContent = errors.join(" "); return; }
  $("saveBtn").disabled = true;
  $("saveBtn").textContent = "Saving…";
  try {
    const res = await api("/api/playlist", { method: "PUT", body: { name: "Default", slides: state.draft.slides } });
    state.playlist = res.playlist;
    state.draft = clone(res.playlist);
    setDirty(false);
    renderSlides();
    await refreshPlayback();
    toast("Saved — now playing on the TV");
  } catch (err) {
    $("saveError").textContent = err.message;
  } finally {
    $("saveBtn").disabled = false;
    $("saveBtn").textContent = "Save to TV";
  }
}

async function control(cmd) {
  try {
    await api("/api/playback/control", { method: "POST", body: { command: cmd } });
    if (cmd === "showConnectionInfo") toast("Showing the address and code on the TV");
    setTimeout(refreshPlayback, 300);
  } catch (err) { handleError(err); }
}

/* ------------------------------------------------------------------ draft helpers (as admin.js) */

function validateDraft() {
  const errors = [];
  state.draft.slides.forEach((s, i) => {
    const label = `Slide ${i + 1}:`;
    if (s.type !== "video" && s.durationSec < 1) errors.push(`${label} time on screen must be at least 1 second.`);
    if (s.type === "webpage" && !/^https?:\/\//.test(s.url || "")) errors.push(`${label} webpage address must start with http:// or https://.`);
    if (s.type === "webpage") {
      const speed = Number(s.webpageScrollSpeedPxPerSec || 40), wait = Number(s.webpageScrollPauseSec ?? 5);
      if (speed < 5 || speed > 1000) errors.push(`${label} scroll speed must be between 5 and 1000.`);
      if (wait < 0 || wait > 300) errors.push(`${label} pause must be between 0 and 300 seconds.`);
    }
    if (s.type === "image" || s.type === "video") {
      if (!s.mediaId) errors.push(`${label} choose a file.`);
      else if (!state.media.some((m) => m.id === s.mediaId)) errors.push(`${label} uses a deleted file.`);
    }
  });
  return errors;
}

function removeMediaFromDraft(id) {
  if (!state.draft) return;
  const before = state.draft.slides.length;
  state.draft.slides = state.draft.slides.filter((s) => s.mediaId !== id);
  if (state.draft.slides.length !== before) { normalizeOrders(); markDirty(); renderSlides(); }
}

function pruneDraftMissingMedia() {
  if (!state.draft) return;
  const ids = new Set(state.media.map((m) => m.id));
  const before = state.draft.slides.length;
  state.draft.slides = state.draft.slides.filter((s) => (s.type !== "image" && s.type !== "video") || (s.mediaId && ids.has(s.mediaId)));
  if (state.draft.slides.length !== before) { normalizeOrders(); state.dirty = true; }
}

function ensureDraft() { if (!state.draft) state.draft = state.playlist ? clone(state.playlist) : emptyPlaylist(); }
function emptyPlaylist() { return { id: "default", name: "Default", slides: [], active: true }; }
function clone(p) { return JSON.parse(JSON.stringify(p || emptyPlaylist())); }
function normalizeOrders() { state.draft.slides.forEach((s, i) => (s.order = i)); }
function markDirty() { setDirty(true); }
function setDirty(d) { state.dirty = d; $("saveError").textContent = ""; renderSaveBar(); }
function renderSaveBar() { $("saveBar").classList.toggle("show", state.dirty && !!state.token); }
function confirmLeave() { return !state.dirty || window.confirm("You have unsaved playlist changes. Leave anyway?"); }

function summary(s) {
  const t = s.type === "video" ? "Video · plays to the end" : s.type === "image" ? `Image · ${formatDuration(s.durationSec || 10)}`
    : s.webpageAutoScroll !== false ? "Webpage · auto-scroll" : `Webpage · ${formatDuration(s.durationSec || 20)}`;
  return `${t} · ${(s.fitMode || "contain").replace(/^./, (c) => c.toUpperCase())}${s.enabled === false ? " · Hidden" : ""}`;
}

function loopLabel(slides) {
  const on = slides.filter((s) => s.enabled !== false);
  if (!on.length) return "Empty";
  const fixed = on.filter((s) => s.type === "image" || (s.type === "webpage" && s.webpageAutoScroll === false))
    .reduce((n, s) => n + Number(s.durationSec || defaultDuration(s.type)), 0);
  const variable = on.length - on.filter((s) => s.type === "image" || (s.type === "webpage" && s.webpageAutoScroll === false)).length;
  return `Loop ${formatDuration(fixed)}${variable ? ` + ${variable} video/scroll` : ""}`;
}

/* ------------------------------------------------------------------ utils */

function kind(m) {
  if (!m) return "";
  if ((m.mimeType || "").startsWith("image/")) return "image";
  if ((m.mimeType || "").startsWith("video/")) return "video";
  const ext = String(m.displayName || m.fileName || "").split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "m4v", "webm", "mkv", "mov", "3gp", "3gpp", "avi"].includes(ext)) return "video";
  return "";
}

function thumb(m) {
  const src = `/api/media/${encodeURIComponent(m.id)}/file?token=${encodeURIComponent(state.token)}`;
  if (kind(m) === "image") return `<img loading="lazy" src="${src}" alt="">`;
  if (kind(m) === "video") return `<video preload="metadata" muted playsinline src="${src}#t=0.5"></video>`;
  return "";
}

function mimeFor(file) {
  if (file.type) return file.type;
  const ext = String(file.name).split(".").pop().toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", m4v: "video/mp4",
    webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime", "3gp": "video/3gpp", "3gpp": "video/3gpp", avi: "video/x-msvideo" })[ext]
    || "application/octet-stream";
}

function defaultDuration(type) { return type === "video" ? 0 : type === "webpage" ? 20 : 10; }

function normalizeNumber(f, v) {
  const n = Number(v);
  if (f === "durationSec") return Math.max(1, Number.isFinite(n) ? Math.round(n) : 1);
  if (f === "webpageScrollSpeedPxPerSec") return clamp(Number.isFinite(n) ? n : 40, 5, 1000);
  if (f === "webpageScrollPauseSec") return clamp(Number.isFinite(n) ? n : 5, 0, 300);
  return n;
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (opts.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || (data.errors || []).join("; ") || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function handleError(err, quiet) {
  if (err.status === 401 || err.status === 403) { forgetPairing(); $("pairError").textContent = "Pair this browser again with the code on the TV."; return; }
  if (!quiet) toast(err.message || "Something went wrong", "error");
}

let toastTimer;
function toast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

let confirmResolve;
function confirmSheet(title, text) {
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirm").classList.remove("hidden");
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $("confirmOk").onclick = () => closeConfirm(true);
    $("confirmCancel").onclick = () => closeConfirm(false);
  });
}
function closeConfirm(v) {
  if ($("confirm").classList.contains("hidden")) return;
  $("confirm").classList.add("hidden");
  if (confirmResolve) confirmResolve(v);
  confirmResolve = null;
}

function safeJson(t) { try { return t ? JSON.parse(t) : {}; } catch (_) { return {}; } }
function randomId() { return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`); }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function formatBytes(b) { if (!b) return "0 B"; const u = ["B", "KB", "MB", "GB"]; let i = 0, n = b; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; }
function formatDate(ms) { try { return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch (_) { return ""; } }
function formatDuration(sec) { sec = Number(sec) || 0; if (sec < 60) return `${sec}s`; const m = Math.floor(sec / 60), s = sec % 60; return s ? `${m}m ${s}s` : `${m}m`; }
