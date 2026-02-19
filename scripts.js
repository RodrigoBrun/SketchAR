/* ==========================================================
   Calcar PRO - Vanilla JS
   - Cámara trasera / flip
   - Subir imagen
   - Opacidad / escala / rotación
   - Drag + pinch zoom
   - Lock overlay
========================================================== */

const $ = (sel) => document.querySelector(sel);

const video = $("#camera");
const overlay = $("#overlay");

const fileInput = $("#fileInput");
const opacity = $("#opacity");
const scale = $("#scale");
const rotate = $("#rotate");

const opacityValue = $("#opacityValue");
const scaleValue = $("#scaleValue");
const rotateValue = $("#rotateValue");

const btnReset = $("#btnReset");
const btnToggleLock = $("#btnToggleLock");
const btnFlipCam = $("#btnFlipCam");

const toast = $("#toast");

let stream = null;
let usingFront = false;

const state = {
  x: 0,
  y: 0,
  scale: Number(scale.value),
  rotation: Number(rotate.value),
  opacity: Number(opacity.value),
  locked: false,

  // gestures
  dragging: false,
  lastX: 0,
  lastY: 0,

  pinch: false,
  pinchStartDist: 0,
  pinchStartScale: 1,
};

function showToast(msg){
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.classList.remove("show"), 1600);
}

async function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
}

async function startCamera(){
  await stopCamera();

  const constraints = {
    video: {
      facingMode: usingFront ? "user" : "environment"
    },
    audio: false
  };

  try{
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    showToast(usingFront ? "Cámara frontal" : "Cámara trasera");
  }catch(err){
    // Fallback: sin facingMode, por si iOS/permiso raro
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      showToast("Cámara iniciada (modo genérico)");
    }catch(e2){
      alert("No pude acceder a la cámara. Revisá permisos en el navegador.");
      console.error(e2);
    }
  }
}

function updateHUD(){
  opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
  scaleValue.textContent = `${Math.round(state.scale * 100)}%`;
  rotateValue.textContent = `${Math.round(state.rotation)}°`;
}

function applyOverlayTransform(){
  // translate(-50%,-50%) base + nuestro offset + scale + rotate
  overlay.style.opacity = String(state.opacity);
  overlay.style.transform =
    `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) rotate(${state.rotation}deg) scale(${state.scale})`;
  updateHUD();
}

function setLocked(lock){
  state.locked = lock;
  overlay.classList.toggle("is-locked", lock);
  btnToggleLock.textContent = lock ? "🔒" : "🔓";
  showToast(lock ? "Overlay bloqueado" : "Overlay desbloqueado");
}

function resetAll(){
  state.x = 0;
  state.y = 0;
  state.scale = 1;
  state.rotation = 0;
  state.opacity = 0.4;

  opacity.value = state.opacity;
  scale.value = state.scale;
  rotate.value = state.rotation;

  applyOverlayTransform();
  showToast("Reiniciado");
}

/* ==========================
   Imagen
========================== */
fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    overlay.src = reader.result;
    overlay.classList.remove("is-hidden");
    resetAll();
    showToast("Imagen cargada");
  };
  reader.readAsDataURL(file);
});

/* ==========================
   Sliders
========================== */
opacity.addEventListener("input", () => {
  state.opacity = Number(opacity.value);
  applyOverlayTransform();
});

scale.addEventListener("input", () => {
  state.scale = Number(scale.value);
  applyOverlayTransform();
});

rotate.addEventListener("input", () => {
  state.rotation = Number(rotate.value);
  applyOverlayTransform();
});

/* ==========================
   Botones
========================== */
btnReset.addEventListener("click", resetAll);

btnToggleLock.addEventListener("click", () => setLocked(!state.locked));

btnFlipCam.addEventListener("click", async () => {
  usingFront = !usingFront;
  await startCamera();
});

/* ==========================
   Gestos (Pointer Events)
   - 1 dedo: drag
   - 2 dedos: pinch zoom
========================== */
const pointers = new Map();

overlay.addEventListener("pointerdown", (ev) => {
  if (state.locked) return;
  overlay.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (pointers.size === 1){
    state.dragging = true;
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
  } else if (pointers.size === 2){
    state.pinch = true;
    state.dragging = false;

    const pts = [...pointers.values()];
    state.pinchStartDist = distance(pts[0], pts[1]);
    state.pinchStartScale = state.scale;
  }
});

overlay.addEventListener("pointermove", (ev) => {
  if (state.locked) return;
  if (!pointers.has(ev.pointerId)) return;

  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (pointers.size === 1 && state.dragging){
    const dx = ev.clientX - state.lastX;
    const dy = ev.clientY - state.lastY;
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;

    state.x += dx;
    state.y += dy;
    applyOverlayTransform();
  }

  if (pointers.size === 2 && state.pinch){
    const pts = [...pointers.values()];
    const d = distance(pts[0], pts[1]);

    const ratio = d / Math.max(1, state.pinchStartDist);
    const nextScale = clamp(state.pinchStartScale * ratio, 0.25, 3);

    state.scale = nextScale;
    scale.value = String(nextScale);
    applyOverlayTransform();
  }
});

overlay.addEventListener("pointerup", (ev) => cleanupPointer(ev));
overlay.addEventListener("pointercancel", (ev) => cleanupPointer(ev));
overlay.addEventListener("pointerleave", (ev) => cleanupPointer(ev));

function cleanupPointer(ev){
  if (!pointers.has(ev.pointerId)) return;
  pointers.delete(ev.pointerId);

  if (pointers.size === 0){
    state.dragging = false;
    state.pinch = false;
  } else if (pointers.size === 1){
    // volver a drag con el dedo que queda
    const only = [...pointers.values()][0];
    state.dragging = true;
    state.pinch = false;
    state.lastX = only.x;
    state.lastY = only.y;
  }
}

function distance(a, b){
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

/* ==========================
   Init
========================== */
(async function init(){
  if (!navigator.mediaDevices?.getUserMedia){
    alert("Tu navegador no soporta cámara (getUserMedia). Probá con Chrome/Safari actualizado.");
    return;
  }
  await startCamera();
  applyOverlayTransform();
  setLocked(false);
})();
