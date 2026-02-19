const $ = (s) => document.querySelector(s);

const video = $("#camera");
const overlay = $("#overlay");
const stageHint = $("#stageHint");

const fileInput = $("#fileInput");
const opacityEl = $("#opacity");
const scaleEl = $("#scale");
const rotateEl = $("#rotate");

const opacityValue = $("#opacityValue");
const scaleValue = $("#scaleValue");
const rotateValue = $("#rotateValue");

const btnFlipCam = $("#btnFlipCam");
const btnReset = $("#btnReset");
const btnLock = $("#btnLock");
const btnTogglePanel = $("#btnTogglePanel");

const panel = $("#panel");
const toast = $("#toast");

let stream = null;
let usingFront = false;

const state = {
  x: 0, y: 0,
  scale: Number(scaleEl.value),
  rotation: Number(rotateEl.value),
  opacity: Number(opacityEl.value),
  locked: false,

  dragging: false,
  lastX: 0,
  lastY: 0,

  pinch: false,
  pinchStartDist: 0,
  pinchStartScale: 1,
};

const pointers = new Map();

function showToast(msg){
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 1200);
}

async function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
}

async function startCamera(){
  await stopCamera();

  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: usingFront ? "user" : "environment" },
      audio: false
    });
    video.srcObject = stream;
  }catch(e){
    alert("No pude acceder a la cámara. Revisá permisos del navegador.");
    console.error(e);
  }
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

function updateHUD(){
  opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
  scaleValue.textContent = `${Math.round(state.scale * 100)}%`;
  rotateValue.textContent = `${Math.round(state.rotation)}°`;
}

function applyTransform(){
  overlay.style.opacity = String(state.opacity);
  overlay.style.transform =
    `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) rotate(${state.rotation}deg) scale(${state.scale})`;
  updateHUD();
}

function setLocked(lock){
  state.locked = lock;
  overlay.classList.toggle("locked", lock);
  btnLock.textContent = lock ? "🔒" : "🔓";
  showToast(lock ? "Overlay bloqueado" : "Overlay libre");
}

function resetAll(){
  state.x = 0;
  state.y = 0;
  state.scale = 1;
  state.rotation = 0;
  state.opacity = 0.4;

  opacityEl.value = state.opacity;
  scaleEl.value = state.scale;
  rotateEl.value = state.rotation;

  applyTransform();
  showToast("Reiniciado");
}

/* Upload imagen */
fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    overlay.src = reader.result;
    overlay.classList.remove("hidden");
    stageHint.style.display = "none";
    resetAll();
    showToast("Imagen cargada");
  };
  reader.readAsDataURL(file);
});

/* Sliders */
opacityEl.addEventListener("input", () => {
  state.opacity = Number(opacityEl.value);
  applyTransform();
});
scaleEl.addEventListener("input", () => {
  state.scale = Number(scaleEl.value);
  applyTransform();
});
rotateEl.addEventListener("input", () => {
  state.rotation = Number(rotateEl.value);
  applyTransform();
});

/* Botones */
btnFlipCam.addEventListener("click", async () => {
  usingFront = !usingFront;
  await startCamera();
  showToast(usingFront ? "Cámara frontal" : "Cámara trasera");
});

btnReset.addEventListener("click", resetAll);

btnLock.addEventListener("click", () => setLocked(!state.locked));

btnTogglePanel.addEventListener("click", () => {
  const hidden = panel.classList.toggle("is-hidden");
  btnTogglePanel.textContent = hidden ? "⌃" : "⌄";
  showToast(hidden ? "Panel oculto" : "Panel visible");
});

/* Gestos: drag + pinch */
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
    state.pinchStartDist = dist(pts[0], pts[1]);
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
    applyTransform();
  }

  if (pointers.size === 2 && state.pinch){
    const pts = [...pointers.values()];
    const d = dist(pts[0], pts[1]);
    const ratio = d / Math.max(1, state.pinchStartDist);
    state.scale = clamp(state.pinchStartScale * ratio, 0.3, 3);
    scaleEl.value = String(state.scale);
    applyTransform();
  }
});

["pointerup","pointercancel","pointerleave"].forEach(evt=>{
  overlay.addEventListener(evt, (ev) => {
    pointers.delete(ev.pointerId);

    if (pointers.size === 0){
      state.dragging = false;
      state.pinch = false;
    } else if (pointers.size === 1){
      const only = [...pointers.values()][0];
      state.dragging = true;
      state.pinch = false;
      state.lastX = only.x;
      state.lastY = only.y;
    }
  });
});

/* Init */
(async function init(){
  if (!navigator.mediaDevices?.getUserMedia){
    alert("Tu navegador no soporta cámara. Probá Safari/Chrome actualizado.");
    return;
  }
  await startCamera();
  applyTransform();
  setLocked(false);
})();
