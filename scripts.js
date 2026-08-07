(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const uid = () => globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const els = {
    video: $("#camera"),
    stage: $("#stage"),
    overlay: $("#overlay"),
    guides: $("#guides"),
    emptyState: $("#emptyState"),
    cameraPlaceholder: $("#cameraPlaceholder"),
    cameraChip: $("#cameraChip"),
    recordChip: $("#recordChip"),
    recordTime: $("#recordTime"),
    toast: $("#toast"),
    saveStatus: $("#saveStatus"),
    projectLabel: $("#projectLabel"),
    projectName: $("#projectName"),
    toolSheet: $("#toolSheet"),
    sheetBackdrop: $("#sheetBackdrop"),
    sheetTitle: $("#sheetTitle"),
    fileInputs: [$("#fileInput"), $("#fileInputHero")],
    workCanvas: $("#workCanvas"),
    captureCanvas: $("#captureCanvas"),
    filterMode: $("#filterMode"),
    opacity: $("#opacity"),
    scale: $("#scale"),
    rotate: $("#rotate"),
    brightness: $("#brightness"),
    contrast: $("#contrast"),
    threshold: $("#threshold"),
    blendMode: $("#blendMode"),
    guideOpacity: $("#guideOpacity"),
    cameraZoom: $("#cameraZoom"),
    cameraZoomControl: $("#cameraZoomControl"),
    cameraCapabilities: $("#cameraCapabilities"),
    keepAwake: $("#keepAwake"),
    projectList: $("#projectList"),
    projectCount: $("#projectCount"),
    btnUndo: $("#btnUndo"),
    btnRedo: $("#btnRedo"),
    btnLock: $("#btnLock"),
    lockIcon: $("#lockIcon"),
    btnTorch: $("#btnTorch"),
    btnRecord: $("#btnRecord"),
    welcomeDialog: $("#welcomeDialog"),
  };

  const initialState = () => ({
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 0.42,
    flipX: 1,
    flipY: 1,
    brightness: 0,
    contrast: 0,
    threshold: 128,
    filterMode: "original",
    blendMode: "normal",
    guide: "none",
    guideOpacity: 0.45,
    locked: false,
  });

  let state = initialState();
  let currentProjectId = uid();
  let imageDataUrl = "";
  let sourceImage = null;
  let processedImageUrl = "";
  let stream = null;
  let videoTrack = null;
  let facingMode = "environment";
  let torchOn = false;
  let wakeLock = null;
  let dbPromise = null;
  let processingTimer = null;
  let saveTimer = null;
  let toastTimer = null;
  let history = [];
  let historyIndex = -1;
  let isRestoringHistory = false;
  let suppressSave = false;
  let overlayBaseSize = { width: 320, height: 240 };
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingFrame = 0;
  let recordingStartedAt = 0;
  let recordingTimer = 0;
  const activePointers = new Map();
  let gesture = null;

  const panelNames = {
    image: "Imagen",
    adjust: "Ajustar",
    guides: "Guías",
    camera: "Cámara",
    projects: "Proyecto",
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function setSaveStatus(label, saving = false) {
    els.saveStatus.classList.toggle("saving", saving);
    $("span:last-child", els.saveStatus).textContent = label;
  }

  function snapshotState() {
    return JSON.parse(JSON.stringify(state));
  }

  function pushHistory() {
    if (isRestoringHistory) return;
    const snapshot = snapshotState();
    const previous = history[historyIndex];
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    els.btnUndo.disabled = historyIndex <= 0;
    els.btnRedo.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  }

  async function restoreHistory(index) {
    if (!history[index]) return;
    isRestoringHistory = true;
    state = JSON.parse(JSON.stringify(history[index]));
    historyIndex = index;
    syncControls();
    applyOverlayTransform();
    applyGuides();
    await scheduleImageProcessing(true);
    isRestoringHistory = false;
    updateHistoryButtons();
    scheduleSave();
  }

  function openPanel(name) {
    const activeDock = $(`.dock-item[data-panel="${name}"]`);
    $$(".dock-item").forEach((item) => item.classList.toggle("active", item === activeDock));
    $$(".tool-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panelContent === name));
    els.sheetTitle.textContent = panelNames[name];
    els.toolSheet.classList.add("open");
    els.sheetBackdrop.classList.add("open");
    if (name === "projects") renderProjectList();
  }

  function closePanel() {
    els.toolSheet.classList.remove("open");
    els.sheetBackdrop.classList.remove("open");
  }

  function syncControls() {
    const pairs = [
      [els.opacity, state.opacity], [els.scale, state.scale], [els.rotate, state.rotation],
      [els.brightness, state.brightness], [els.contrast, state.contrast],
      [els.threshold, state.threshold], [els.guideOpacity, state.guideOpacity],
    ];
    pairs.forEach(([element, value]) => { element.value = String(value); });
    els.filterMode.value = state.filterMode;
    els.blendMode.value = state.blendMode;
    $("#opacityValue").textContent = `${Math.round(state.opacity * 100)}%`;
    $("#scaleValue").textContent = `${Math.round(state.scale * 100)}%`;
    $("#rotateValue").textContent = `${Math.round(state.rotation)}°`;
    $("#brightnessValue").textContent = formatSigned(state.brightness);
    $("#contrastValue").textContent = formatSigned(state.contrast);
    $("#thresholdValue").textContent = String(Math.round(state.threshold));
    $("#guideOpacityValue").textContent = `${Math.round(state.guideOpacity * 100)}%`;
    $("#btnFlipX").classList.toggle("active", state.flipX === -1);
    $("#btnFlipY").classList.toggle("active", state.flipY === -1);
    els.btnLock.classList.toggle("active", state.locked);
    els.overlay.classList.toggle("locked", state.locked);
    els.lockIcon.setAttribute("href", state.locked ? "#i-lock" : "#i-unlock");
    els.btnLock.setAttribute("aria-label", state.locked ? "Desbloquear referencia" : "Bloquear referencia");
    els.btnLock.title = state.locked ? "Desbloquear referencia" : "Bloquear referencia";
    $$(".option-row[data-guide]").forEach((item) => item.classList.toggle("selected", item.dataset.guide === state.guide));
  }

  function formatSigned(value) {
    const number = Math.round(Number(value));
    return number > 0 ? `+${number}` : String(number);
  }

  function applyOverlayTransform() {
    els.overlay.style.opacity = String(state.opacity);
    els.overlay.style.mixBlendMode = state.blendMode;
    els.overlay.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) rotate(${state.rotation}deg) scale(${state.scale * state.flipX}, ${state.scale * state.flipY})`;
    syncControls();
  }

  function fitOverlayToStage() {
    if (!sourceImage || !els.stage.clientWidth || !els.stage.clientHeight) return;
    const maxWidth = els.stage.clientWidth * 0.84;
    const maxHeight = els.stage.clientHeight * 0.78;
    const ratio = sourceImage.naturalWidth / sourceImage.naturalHeight;
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    overlayBaseSize = { width, height };
    els.overlay.style.width = `${width}px`;
    els.overlay.style.height = `${height}px`;
  }

  function applyGuides() {
    els.guides.className = `guides guides-${state.guide}`;
    els.guides.style.opacity = String(state.guideOpacity);
  }

  function setLocked(value, notify = true) {
    state.locked = Boolean(value);
    syncControls();
    if (notify) showToast(state.locked ? "Referencia bloqueada" : "Referencia desbloqueada");
    pushHistory();
    scheduleSave();
  }

  function resetTransform() {
    Object.assign(state, { x: 0, y: 0, scale: 1, rotation: 0 });
    applyOverlayTransform();
    pushHistory();
    scheduleSave();
    showToast("Referencia centrada");
  }

  function resetAdjustments() {
    Object.assign(state, {
      opacity: 0.42, scale: 1, rotation: 0, brightness: 0, contrast: 0,
      threshold: 128, filterMode: "original", blendMode: "normal",
      flipX: 1, flipY: 1,
    });
    applyOverlayTransform();
    scheduleImageProcessing();
    pushHistory();
    scheduleSave();
    showToast("Ajustes restablecidos");
  }

  function loadImageFromDataUrl(dataUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = async () => {
        imageDataUrl = dataUrl;
        sourceImage = image;
        fitOverlayToStage();
        els.emptyState.classList.add("hidden");
        els.overlay.classList.remove("hidden");
        await scheduleImageProcessing(true);
        if (options.reset !== false) {
          Object.assign(state, initialState());
          applyGuides();
          applyOverlayTransform();
          history = [];
          historyIndex = -1;
          pushHistory();
        }
        if (!options.silent) showToast("Referencia cargada");
        scheduleSave();
        resolve();
      };
      image.onerror = () => {
        showToast("No se pudo leer esa imagen");
        reject(new Error("Invalid image data"));
      };
      image.src = dataUrl;
    });
  }

  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Elegí un archivo de imagen");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showToast("La imagen supera el límite de 25 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadImageFromDataUrl(String(reader.result)).catch(() => {});
    reader.onerror = () => showToast("No se pudo abrir el archivo");
    reader.readAsDataURL(file);
  }

  function scheduleImageProcessing(immediate = false) {
    clearTimeout(processingTimer);
    if (!sourceImage) return Promise.resolve();
    if (immediate) return processSourceImage();
    return new Promise((resolve) => {
      processingTimer = setTimeout(() => processSourceImage().then(resolve), 70);
    });
  }

  async function processSourceImage() {
    if (!sourceImage) return;
    const maxSide = 1800;
    const ratio = Math.min(1, maxSide / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
    const width = Math.max(1, Math.round(sourceImage.naturalWidth * ratio));
    const height = Math.max(1, Math.round(sourceImage.naturalHeight * ratio));
    const canvas = els.workCanvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceImage, 0, 0, width, height);

    if (state.filterMode !== "original" || state.brightness !== 0 || state.contrast !== 0) {
      const frame = ctx.getImageData(0, 0, width, height);
      const data = frame.data;
      const grayscale = new Uint8ClampedArray(width * height);
      const contrastFactor = (259 * (state.contrast + 255)) / (255 * (259 - state.contrast));

      for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
        let red = clamp(contrastFactor * (data[index] - 128) + 128 + state.brightness, 0, 255);
        let green = clamp(contrastFactor * (data[index + 1] - 128) + 128 + state.brightness, 0, 255);
        let blue = clamp(contrastFactor * (data[index + 2] - 128) + 128 + state.brightness, 0, 255);
        const gray = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
        grayscale[pixel] = gray;

        if (state.filterMode === "grayscale") red = green = blue = gray;
        if (state.filterMode === "threshold") red = green = blue = gray >= state.threshold ? 255 : 0;
        data[index] = red;
        data[index + 1] = green;
        data[index + 2] = blue;
      }

      if (state.filterMode === "lineart") {
        const edgeData = new Uint8ClampedArray(width * height);
        const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            let sumX = 0;
            let sumY = 0;
            let kernelIndex = 0;
            for (let ky = -1; ky <= 1; ky += 1) {
              for (let kx = -1; kx <= 1; kx += 1) {
                const gray = grayscale[(y + ky) * width + x + kx];
                sumX += gray * gx[kernelIndex];
                sumY += gray * gy[kernelIndex];
                kernelIndex += 1;
              }
            }
            edgeData[y * width + x] = Math.min(255, Math.hypot(sumX, sumY));
          }
        }
        for (let pixel = 0; pixel < edgeData.length; pixel += 1) {
          const edge = edgeData[pixel];
          const value = edge > 255 - state.threshold ? 0 : 255;
          const index = pixel * 4;
          data[index] = data[index + 1] = data[index + 2] = value;
          data[index + 3] = value === 255 ? 0 : 255;
        }
      }
      ctx.putImageData(frame, 0, 0);
    }

    if (processedImageUrl.startsWith("blob:")) URL.revokeObjectURL(processedImageUrl);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    processedImageUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
    els.overlay.src = processedImageUrl;
    applyOverlayTransform();
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      els.cameraCapabilities.textContent = "Este navegador no permite usar la cámara. Abrí la app mediante HTTPS en Chrome o Safari actualizado.";
      showToast("La cámara requiere un navegador compatible y HTTPS");
      return;
    }
    await stopCamera();
    els.cameraChip.classList.remove("online");
    $("span:last-child", els.cameraChip).textContent = "Iniciando…";
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      els.video.srcObject = stream;
      await els.video.play();
      videoTrack = stream.getVideoTracks()[0];
      els.cameraPlaceholder.classList.add("hidden");
      els.cameraChip.classList.add("online");
      $("span:last-child", els.cameraChip).textContent = facingMode === "environment" ? "Cámara trasera" : "Cámara frontal";
      configureCameraCapabilities();
    } catch (error) {
      console.error(error);
      els.cameraPlaceholder.classList.remove("hidden");
      $("span:last-child", els.cameraChip).textContent = "Sin cámara";
      const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      $("span", els.cameraPlaceholder).textContent = blocked
        ? "El permiso fue rechazado. Habilitá la cámara en la configuración del navegador."
        : "No se encontró una cámara disponible. Podés preparar la imagen igualmente.";
      showToast(blocked ? "Necesitamos permiso para usar la cámara" : "No se pudo iniciar la cámara");
    }
  }

  async function stopCamera() {
    torchOn = false;
    els.btnTorch.classList.remove("active");
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    videoTrack = null;
  }

  function configureCameraCapabilities() {
    const capabilities = videoTrack?.getCapabilities?.() || {};
    const settings = videoTrack?.getSettings?.() || {};
    const available = [];
    if (capabilities.zoom) {
      els.cameraZoom.min = String(capabilities.zoom.min);
      els.cameraZoom.max = String(capabilities.zoom.max);
      els.cameraZoom.step = String(capabilities.zoom.step || 0.1);
      els.cameraZoom.value = String(settings.zoom || capabilities.zoom.min);
      $("#cameraZoomValue").textContent = `${Number(els.cameraZoom.value).toFixed(1)}×`;
      els.cameraZoomControl.classList.remove("hidden");
      available.push("zoom");
    } else {
      els.cameraZoomControl.classList.add("hidden");
    }
    const hasTorch = Boolean(capabilities.torch);
    els.btnTorch.disabled = !hasTorch;
    if (hasTorch) available.push("linterna");
    els.cameraCapabilities.textContent = available.length
      ? `Controles detectados: ${available.join(" y ")}.`
      : "Esta cámara no expone controles avanzados en el navegador.";
  }

  async function toggleTorch() {
    if (!videoTrack || els.btnTorch.disabled) return;
    torchOn = !torchOn;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
      els.btnTorch.classList.toggle("active", torchOn);
      showToast(torchOn ? "Linterna encendida" : "Linterna apagada");
    } catch (error) {
      torchOn = false;
      els.btnTorch.classList.remove("active");
      showToast("La linterna no está disponible");
    }
  }

  function drawVideoCover(ctx, width, height) {
    if (!els.video.videoWidth || !els.video.videoHeight) {
      ctx.fillStyle = "#080b10";
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const videoRatio = els.video.videoWidth / els.video.videoHeight;
    const targetRatio = width / height;
    let sourceWidth = els.video.videoWidth;
    let sourceHeight = els.video.videoHeight;
    let sourceX = 0;
    let sourceY = 0;
    if (videoRatio > targetRatio) {
      sourceWidth = sourceHeight * targetRatio;
      sourceX = (els.video.videoWidth - sourceWidth) / 2;
    } else {
      sourceHeight = sourceWidth / targetRatio;
      sourceY = (els.video.videoHeight - sourceHeight) / 2;
    }
    ctx.drawImage(els.video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  }

  function drawGuides(ctx, width, height) {
    if (state.guide === "none") return;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${state.guideOpacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (state.guide === "grid") {
      for (let index = 1; index < 8; index += 1) {
        ctx.moveTo((width / 8) * index, 0); ctx.lineTo((width / 8) * index, height);
        ctx.moveTo(0, (height / 8) * index); ctx.lineTo(width, (height / 8) * index);
      }
    } else if (state.guide === "thirds") {
      [1, 2].forEach((index) => {
        ctx.moveTo((width / 3) * index, 0); ctx.lineTo((width / 3) * index, height);
        ctx.moveTo(0, (height / 3) * index); ctx.lineTo(width, (height / 3) * index);
      });
    } else if (state.guide === "center") {
      ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
      ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
      ctx.moveTo(0, 0); ctx.lineTo(width, height);
      ctx.moveTo(width, 0); ctx.lineTo(0, height);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawComposite(canvas = els.captureCanvas, includeGuides = true) {
    const stageWidth = Math.max(1, els.stage.clientWidth);
    const stageHeight = Math.max(1, els.stage.clientHeight);
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = Math.round(stageWidth * pixelRatio);
    const targetHeight = Math.round(stageHeight * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    ctx.clearRect(0, 0, stageWidth, stageHeight);
    drawVideoCover(ctx, stageWidth, stageHeight);
    if (sourceImage && els.overlay.complete) {
      ctx.save();
      ctx.translate(stageWidth / 2 + state.x, stageHeight / 2 + state.y);
      ctx.rotate((state.rotation * Math.PI) / 180);
      ctx.scale(state.scale * state.flipX, state.scale * state.flipY);
      ctx.globalAlpha = state.opacity;
      ctx.globalCompositeOperation = ["multiply", "screen", "difference"].includes(state.blendMode) ? state.blendMode : "source-over";
      ctx.drawImage(els.overlay, -overlayBaseSize.width / 2, -overlayBaseSize.height / 2, overlayBaseSize.width, overlayBaseSize.height);
      ctx.restore();
    }
    if (includeGuides) drawGuides(ctx, stageWidth, stageHeight);
    ctx.restore();
    return canvas;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function captureImage() {
    const canvas = drawComposite();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return showToast("No se pudo crear la captura");
    const safeName = (els.projectName.value || "sketchar").replace(/[^a-z0-9áéíóúñ_-]+/gi, "-").replace(/^-|-$/g, "");
    downloadBlob(blob, `${safeName || "sketchar"}-${new Date().toISOString().slice(0, 10)}.png`);
    showToast("Captura descargada");
  }

  function updateRecordTime() {
    const total = Math.floor((Date.now() - recordingStartedAt) / 1000);
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");
    els.recordTime.textContent = `${minutes}:${seconds}`;
  }

  function recordingRenderLoop() {
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    drawComposite(els.captureCanvas, true);
    recordingFrame = requestAnimationFrame(recordingRenderLoop);
  }

  function supportedRecordingType() {
    return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) || "";
  }

  function startRecording() {
    if (!globalThis.MediaRecorder || !els.captureCanvas.captureStream) {
      showToast("La grabación no está disponible en este navegador");
      return;
    }
    try {
      drawComposite(els.captureCanvas, true);
      const recordingStream = els.captureCanvas.captureStream(30);
      const mimeType = supportedRecordingType();
      mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : undefined);
      recordedChunks = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.push(event.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
        downloadBlob(blob, `sketchar-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`);
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        mediaRecorder = null;
        showToast("Grabación descargada");
      };
      mediaRecorder.start(500);
      recordingStartedAt = Date.now();
      els.recordChip.classList.remove("hidden");
      els.btnRecord.classList.add("recording");
      $("span", els.btnRecord).textContent = "Detener";
      recordingTimer = setInterval(updateRecordTime, 500);
      recordingRenderLoop();
      closePanel();
      showToast("Grabación iniciada");
    } catch (error) {
      console.error(error);
      showToast("No se pudo iniciar la grabación");
    }
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    mediaRecorder.stop();
    cancelAnimationFrame(recordingFrame);
    clearInterval(recordingTimer);
    els.recordChip.classList.add("hidden");
    els.btnRecord.classList.remove("recording");
    $("span", els.btnRecord).textContent = "Grabar";
  }

  async function toggleWakeLock(enabled) {
    if (!enabled) {
      await wakeLock?.release?.();
      wakeLock = null;
      return;
    }
    if (!("wakeLock" in navigator)) {
      els.keepAwake.checked = false;
      showToast("Mantener activa no está disponible aquí");
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
      showToast("La pantalla se mantendrá activa");
    } catch (error) {
      els.keepAwake.checked = false;
      showToast("No se pudo mantener la pantalla activa");
    }
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("sketchar-studio", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function withProjectStore(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("projects", mode);
      const store = transaction.objectStore("projects");
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function projectRecord() {
    return {
      id: currentProjectId,
      name: els.projectName.value.trim() || "Proyecto sin título",
      imageData: imageDataUrl,
      state: snapshotState(),
      updatedAt: Date.now(),
      thumbnail: processedImageUrl && els.workCanvas.width ? els.workCanvas.toDataURL("image/jpeg", 0.58) : imageDataUrl,
    };
  }

  async function saveProject(notify = false) {
    if (suppressSave || !imageDataUrl) return;
    clearTimeout(saveTimer);
    setSaveStatus("Guardando…", true);
    try {
      await withProjectStore("readwrite", (store) => store.put(projectRecord()));
      setSaveStatus("Guardado", false);
      els.projectLabel.textContent = els.projectName.value.trim() || "Proyecto sin título";
      if (notify) showToast("Proyecto guardado");
      if (els.toolSheet.classList.contains("open") && $(".tool-panel.active")?.dataset.panelContent === "projects") renderProjectList();
    } catch (error) {
      console.error(error);
      setSaveStatus("Error al guardar", false);
      if (notify) showToast("No se pudo guardar el proyecto");
    }
  }

  function scheduleSave() {
    if (suppressSave || !imageDataUrl) return;
    setSaveStatus("Cambios pendientes", true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveProject(), 650);
  }

  async function allProjects() {
    try {
      const projects = await withProjectStore("readonly", (store) => store.getAll());
      return projects.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  async function renderProjectList() {
    const projects = await allProjects();
    els.projectCount.textContent = String(projects.length);
    if (!projects.length) {
      els.projectList.innerHTML = '<div class="list-empty">Todavía no hay proyectos guardados.</div>';
      return;
    }
    els.projectList.replaceChildren(...projects.map((project) => {
      const card = document.createElement("article");
      card.className = "project-card";
      const thumb = document.createElement("img");
      thumb.className = "project-thumb";
      thumb.alt = "";
      thumb.src = project.thumbnail || project.imageData;
      const info = document.createElement("button");
      info.type = "button";
      info.className = "project-info";
      info.innerHTML = `<strong></strong><small></small>`;
      $("strong", info).textContent = project.name;
      $("small", info).textContent = new Intl.DateTimeFormat("es-UY", { dateStyle: "medium", timeStyle: "short" }).format(project.updatedAt);
      info.addEventListener("click", () => loadProject(project));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "project-delete";
      remove.title = "Eliminar proyecto";
      remove.setAttribute("aria-label", `Eliminar ${project.name}`);
      remove.innerHTML = '<svg><use href="#i-trash"/></svg>';
      remove.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar “${project.name}”? Esta acción no se puede deshacer.`)) return;
        await withProjectStore("readwrite", (store) => store.delete(project.id));
        if (project.id === currentProjectId) newProject();
        renderProjectList();
        showToast("Proyecto eliminado");
      });
      card.append(thumb, info, remove);
      return card;
    }));
  }

  async function loadProject(project) {
    suppressSave = true;
    currentProjectId = project.id;
    state = { ...initialState(), ...project.state };
    els.projectName.value = project.name;
    els.projectLabel.textContent = project.name;
    await loadImageFromDataUrl(project.imageData, { reset: false, silent: true });
    syncControls();
    applyGuides();
    applyOverlayTransform();
    history = [];
    historyIndex = -1;
    pushHistory();
    suppressSave = false;
    closePanel();
    setSaveStatus("Guardado", false);
    showToast("Proyecto abierto");
  }

  function newProject() {
    suppressSave = true;
    currentProjectId = uid();
    imageDataUrl = "";
    sourceImage = null;
    state = initialState();
    els.projectName.value = "Proyecto sin título";
    els.projectLabel.textContent = "Proyecto sin título";
    els.overlay.src = "";
    els.overlay.classList.add("hidden");
    els.emptyState.classList.remove("hidden");
    history = [];
    historyIndex = -1;
    pushHistory();
    syncControls();
    applyGuides();
    suppressSave = false;
    setSaveStatus("Sin guardar", false);
    showToast("Nuevo proyecto");
  }

  function pointerDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pointerAngle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI); }
  function pointerCenter(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function startGesture() {
    const points = [...activePointers.values()];
    if (points.length === 1) {
      gesture = { mode: "drag", point: points[0], x: state.x, y: state.y };
    } else if (points.length >= 2) {
      const [a, b] = points;
      gesture = {
        mode: "pinch",
        center: pointerCenter(a, b),
        distance: Math.max(1, pointerDistance(a, b)),
        angle: pointerAngle(a, b),
        x: state.x,
        y: state.y,
        scale: state.scale,
        rotation: state.rotation,
      };
    }
  }

  function onPointerDown(event) {
    if (state.locked || !sourceImage) return;
    event.preventDefault();
    els.overlay.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    els.overlay.classList.add("dragging");
    startGesture();
  }

  function onPointerMove(event) {
    if (!activePointers.has(event.pointerId) || state.locked) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...activePointers.values()];
    if (points.length === 1 && gesture?.mode === "drag") {
      state.x = gesture.x + points[0].x - gesture.point.x;
      state.y = gesture.y + points[0].y - gesture.point.y;
    } else if (points.length >= 2) {
      if (gesture?.mode !== "pinch") startGesture();
      const [a, b] = points;
      const center = pointerCenter(a, b);
      state.x = gesture.x + center.x - gesture.center.x;
      state.y = gesture.y + center.y - gesture.center.y;
      state.scale = clamp(gesture.scale * (pointerDistance(a, b) / gesture.distance), 0.2, 4);
      state.rotation = gesture.rotation + pointerAngle(a, b) - gesture.angle;
    }
    applyOverlayTransform();
  }

  function onPointerEnd(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);
    if (activePointers.size) startGesture();
    else {
      gesture = null;
      els.overlay.classList.remove("dragging");
      pushHistory();
      scheduleSave();
    }
  }

  function nudge(dx, dy = 0) {
    state.x += dx;
    state.y += dy;
    applyOverlayTransform();
    pushHistory();
    scheduleSave();
  }

  function bindRange(element, key, output, formatter, options = {}) {
    element.addEventListener("input", () => {
      state[key] = Number(element.value);
      output.textContent = formatter(state[key]);
      if (options.process) scheduleImageProcessing();
      else if (key === "guideOpacity") applyGuides();
      else applyOverlayTransform();
    });
    element.addEventListener("change", () => { pushHistory(); scheduleSave(); });
  }

  function bindEvents() {
    $$(".dock-item").forEach((button) => button.addEventListener("click", () => openPanel(button.dataset.panel)));
    $("#btnCloseSheet").addEventListener("click", closePanel);
    els.sheetBackdrop.addEventListener("click", closePanel);
    $("#btnHome").addEventListener("click", () => openPanel("projects"));
    $("#btnStartCamera").addEventListener("click", startCamera);
    els.fileInputs.forEach((input) => input.addEventListener("change", (event) => handleFile(event.target.files?.[0])));
    els.btnUndo.addEventListener("click", () => restoreHistory(historyIndex - 1));
    els.btnRedo.addEventListener("click", () => restoreHistory(historyIndex + 1));
    els.btnLock.addEventListener("click", () => setLocked(!state.locked));
    $("#btnReset").addEventListener("click", resetTransform);
    $("#btnResetAdjust").addEventListener("click", resetAdjustments);
    $("#btnFlipX").addEventListener("click", () => { state.flipX *= -1; applyOverlayTransform(); pushHistory(); scheduleSave(); });
    $("#btnFlipY").addEventListener("click", () => { state.flipY *= -1; applyOverlayTransform(); pushHistory(); scheduleSave(); });
    $("#btnCenter").addEventListener("click", resetTransform);
    $("#btnNudgeLeft").addEventListener("click", () => nudge(-1));
    $("#btnNudgeRight").addEventListener("click", () => nudge(1));
    $("#btnFlipCam").addEventListener("click", async () => { facingMode = facingMode === "environment" ? "user" : "environment"; await startCamera(); showToast(facingMode === "environment" ? "Cámara trasera" : "Cámara frontal"); });
    els.btnTorch.addEventListener("click", toggleTorch);
    $("#btnCapture").addEventListener("click", captureImage);
    $("#btnExport").addEventListener("click", captureImage);
    els.btnRecord.addEventListener("click", () => mediaRecorder?.state === "recording" ? stopRecording() : startRecording());
    $("#btnFullscreen").addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await els.stage.requestFullscreen();
        else await document.exitFullscreen();
      } catch (error) { showToast("Pantalla completa no disponible"); }
    });
    els.keepAwake.addEventListener("change", () => toggleWakeLock(els.keepAwake.checked));
    els.cameraZoom.addEventListener("input", async () => {
      const zoom = Number(els.cameraZoom.value);
      $("#cameraZoomValue").textContent = `${zoom.toFixed(1)}×`;
      try { await videoTrack?.applyConstraints?.({ advanced: [{ zoom }] }); } catch (_) { /* unsupported constraint */ }
    });
    els.projectName.addEventListener("input", () => {
      els.projectLabel.textContent = els.projectName.value.trim() || "Proyecto sin título";
      scheduleSave();
    });
    $("#btnSaveProject").addEventListener("click", () => saveProject(true));
    $("#btnNewProject").addEventListener("click", () => { newProject(); closePanel(); });

    bindRange(els.opacity, "opacity", $("#opacityValue"), (value) => `${Math.round(value * 100)}%`);
    bindRange(els.scale, "scale", $("#scaleValue"), (value) => `${Math.round(value * 100)}%`);
    bindRange(els.rotate, "rotation", $("#rotateValue"), (value) => `${Math.round(value)}°`);
    bindRange(els.brightness, "brightness", $("#brightnessValue"), formatSigned, { process: true });
    bindRange(els.contrast, "contrast", $("#contrastValue"), formatSigned, { process: true });
    bindRange(els.threshold, "threshold", $("#thresholdValue"), (value) => String(Math.round(value)), { process: true });
    bindRange(els.guideOpacity, "guideOpacity", $("#guideOpacityValue"), (value) => `${Math.round(value * 100)}%`);

    els.filterMode.addEventListener("change", () => { state.filterMode = els.filterMode.value; scheduleImageProcessing(); pushHistory(); scheduleSave(); });
    els.blendMode.addEventListener("change", () => { state.blendMode = els.blendMode.value; applyOverlayTransform(); pushHistory(); scheduleSave(); });
    $$(".option-row[data-guide]").forEach((button) => button.addEventListener("click", () => {
      state.guide = button.dataset.guide;
      applyGuides();
      syncControls();
      pushHistory();
      scheduleSave();
    }));

    els.overlay.addEventListener("pointerdown", onPointerDown);
    els.overlay.addEventListener("pointermove", onPointerMove);
    els.overlay.addEventListener("pointerup", onPointerEnd);
    els.overlay.addEventListener("pointercancel", onPointerEnd);
    els.overlay.addEventListener("wheel", (event) => {
      if (state.locked) return;
      event.preventDefault();
      state.scale = clamp(state.scale * (event.deltaY > 0 ? 0.95 : 1.05), 0.2, 4);
      applyOverlayTransform();
      clearTimeout(els.overlay._wheelTimer);
      els.overlay._wheelTimer = setTimeout(() => { pushHistory(); scheduleSave(); }, 180);
    }, { passive: false });

    window.addEventListener("resize", fitOverlayToStage);
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && els.keepAwake.checked && !wakeLock) await toggleWakeLock(true);
    });
    document.addEventListener("keydown", (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        restoreHistory(event.shiftKey ? historyIndex + 1 : historyIndex - 1);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); restoreHistory(historyIndex + 1);
      } else if (!typing && event.key.toLowerCase() === "l") setLocked(!state.locked);
      else if (!typing && event.key === "ArrowLeft") { event.preventDefault(); nudge(event.shiftKey ? -10 : -1); }
      else if (!typing && event.key === "ArrowRight") { event.preventDefault(); nudge(event.shiftKey ? 10 : 1); }
      else if (!typing && event.key === "ArrowUp") { event.preventDefault(); nudge(0, event.shiftKey ? -10 : -1); }
      else if (!typing && event.key === "ArrowDown") { event.preventDefault(); nudge(0, event.shiftKey ? 10 : 1); }
      else if (event.key === "Escape") closePanel();
    });

    $("#btnCloseWelcome").addEventListener("click", () => els.welcomeDialog.close());
    $("#btnWelcomeStart").addEventListener("click", () => {
      if ($("#dontShowWelcome").checked) localStorage.setItem("sketchar-welcome-seen", "1");
      els.welcomeDialog.close();
    });
  }

  async function initialize() {
    bindEvents();
    syncControls();
    applyGuides();
    pushHistory();
    setSaveStatus("Sin guardar", false);
    renderProjectList();

    if (!localStorage.getItem("sketchar-welcome-seen")) {
      try { els.welcomeDialog.showModal(); } catch (_) { /* dialog not supported */ }
    }

    if (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname)) {
      startCamera();
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker", error));
    }
  }

  initialize();
})();
