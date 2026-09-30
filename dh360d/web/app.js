/**
 * Darkflash Studio - Web Frontend Controller
 * Matches Serpantinum / Matugen Material Design 3 aesthetic
 */

// --- Global State ---
const state = {
  rotation: 90, // AM5 default
  brightness: 100,
  bezelVisible: false,
  background: {
    type: 'color', // 'color', 'image', 'video'
    src: null,
    serverPath: null,
    color: '#0a0a0f',
    element: null, // HTMLImageElement or HTMLVideoElement
    scale: 1.0,
    visible: true,
  },
  layers: [],
  selectedLayerId: null,
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
  sensors: {
    cpu_temp: 45,
    cpu_pct: 12,
    gpu_temp: 40,
    gpu_pct: 5,
    ram_pct: 35,
    ram_used_gb: 5.6,
    ram_total_gb: 16.0,
  },
  connected: false,
};

let nextId = 1;
function genId(prefix = 'layer') {
  return `${prefix}_${nextId++}`;
}

// DOM References
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');
const bezelOverlay = document.getElementById('bezel-overlay');
const layerListEl = document.getElementById('layer-list');
const layerCountEl = document.getElementById('layer-count');
const inspectorFieldsEl = document.getElementById('inspector-fields');
const inspectorTitleEl = document.getElementById('inspector-title');
const hwStatusDot = document.getElementById('status-dot');
const hwStatusText = document.getElementById('hw-status-text');
const brightnessSlider = document.getElementById('brightness-slider');
const brightnessVal = document.getElementById('brightness-val');
const bgDropzone = document.getElementById('bg-dropzone');
const bgFileInput = document.getElementById('bg-file-input');
const bgTypeTag = document.getElementById('bg-type-tag');
const btnBrowseBg = document.getElementById('btn-browse-bg');
const btnSampleBg = document.getElementById('btn-sample-bg');
const btnApplyCooler = document.getElementById('btn-apply-cooler');
const btnSleepCooler = document.getElementById('btn-sleep-cooler');
const btnWakeCooler = document.getElementById('btn-wake-cooler');
const btnDeleteLayer = document.getElementById('btn-delete-layer');
const btnCenterSelected = document.getElementById('btn-center-selected');
const btnToggleBezel = document.getElementById('btn-toggle-bezel');
const presetSelector = document.getElementById('preset-selector');
const btnSavePreset = document.getElementById('btn-save-preset');
const btnNewBlank = document.getElementById('btn-new-blank');

// --- Initialization ---
function init() {
  setupEventListeners();
  setupTabNavigation();
  setupGameMode();
  setupRenderedThemes();
  renderCustomPresets();
  loadPreset('reactor_core');
  startSensorPolling();
  startHardwareStatusPolling();
  renderLoop();
}

// --- Sensor & Status Polling ---
function startSensorPolling() {
  async function pollSensors() {
    try {
      const res = await fetch('/api/sensors');
      if (res.ok) {
        const data = await res.json();
        Object.assign(state.sensors, data);
      }
    } catch (e) {
      // gentle fallback jitter if offline
      state.sensors.cpu_temp = Math.max(30, Math.min(85, state.sensors.cpu_temp + (Math.random() * 2 - 1)));
      state.sensors.cpu_pct = Math.max(5, Math.min(95, state.sensors.cpu_pct + (Math.random() * 4 - 2)));
    }
    setTimeout(pollSensors, 1000);
  }
  pollSensors();
}

function startHardwareStatusPolling() {
  async function pollStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        state.connected = data.connected;
        if (data.gamemode !== undefined) {
          updateGameModeUI(data.gamemode);
        }
        if (data.connected) {
          hwStatusDot.className = 'status-dot';
          hwStatusText.textContent = `DV360S (${data.node || 'Online'})`;
          if (data.brightness !== undefined && document.activeElement !== brightnessSlider) {
            brightnessSlider.value = data.brightness;
            brightnessVal.textContent = `${data.brightness}%`;
          }
        } else {
          hwStatusDot.className = 'status-dot disconnected';
          hwStatusText.textContent = 'Cooler disconnected';
        }
      }
    } catch (e) {
      hwStatusDot.className = 'status-dot disconnected';
      hwStatusText.textContent = 'Studio Daemon offline';
    }
    setTimeout(pollStatus, 2000);
  }
  pollStatus();
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // AM5 Rotation Pills
  document.querySelectorAll('#rotation-group .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rotation-group .pill-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.rotation = parseInt(btn.dataset.angle, 10);
    });
  });

  // Bezel Toggle
  btnToggleBezel.addEventListener('click', () => {
    state.bezelVisible = !state.bezelVisible;
    bezelOverlay.classList.toggle('visible', state.bezelVisible);
    btnToggleBezel.style.color = state.bezelVisible ? 'var(--accent-cyan)' : 'var(--text-dim)';
  });

  // Center Selected Layer
  btnCenterSelected.addEventListener('click', () => {
    const layer = getSelectedLayer();
    if (layer) {
      layer.x = 240;
      layer.y = 240;
      updateInspector();
    }
  });

  // Delete Selected Layer via Inspector
  btnDeleteLayer.addEventListener('click', () => {
    if (state.selectedLayerId) {
      deleteLayer(state.selectedLayerId);
    }
  });

  // Brightness Control
  brightnessSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    brightnessVal.textContent = `${val}%`;
    state.brightness = parseInt(val, 10);
  });
  brightnessSlider.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    try {
      await fetch('/api/brightness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: val }),
      });
    } catch (err) {
      console.warn('Failed to set brightness:', err);
    }
  });

  // Wake & Sleep
  btnWakeCooler.addEventListener('click', async () => {
    try {
      await fetch('/api/wake', { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }
  });
  btnSleepCooler.addEventListener('click', async () => {
    try {
      await fetch('/api/sleep', { method: 'POST' });
    } catch (e) {
      console.warn(e);
    }
  });

  // Apply to Cooler Button
  btnApplyCooler.addEventListener('click', applyToCooler);

  // Minimize to Background Button
  const btnMinimize = document.getElementById('btn-minimize');
  if (btnMinimize) {
    btnMinimize.addEventListener('click', () => {
      window.close();
    });
  }

  // Background Upload Handling
  btnBrowseBg.addEventListener('click', () => bgFileInput.click());
  bgDropzone.addEventListener('click', () => bgFileInput.click());

  bgDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    bgDropzone.classList.add('dragover');
  });
  bgDropzone.addEventListener('dragleave', () => {
    bgDropzone.classList.remove('dragover');
  });
  bgDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    bgDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleBackgroundFile(e.dataTransfer.files[0]);
    }
  });
  bgFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleBackgroundFile(e.target.files[0]);
    }
  });

  btnSampleBg.addEventListener('click', loadSampleBackground);

  // Preset Selector
  presetSelector.addEventListener('change', (e) => {
    loadPreset(e.target.value);
  });
  if (btnNewBlank) {
    btnNewBlank.addEventListener('click', clearToBlank);
  }
  btnSavePreset.addEventListener('click', () => {
    const name = prompt('Enter preset name:', 'My Custom Preset');
    if (name) {
      saveCustomPreset(name);
    }
  });

  // Canvas Mouse Interactions (Dragging & Selection)
  canvas.addEventListener('mousedown', onCanvasMouseDown);
  window.addEventListener('mousemove', onCanvasMouseMove);
  window.addEventListener('mouseup', onCanvasMouseUp);
}

// --- Background File Handling ---
async function handleBackgroundFile(file) {
  const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.webm');
  const isImage = file.type.startsWith('image/') || file.name.endsWith('.png') || file.name.endsWith('.jpg') || file.name.endsWith('.gif');

  if (!isImage && !isVideo) {
    alert('Please select a valid image (PNG, JPG, GIF) or video (MP4, WebM) file.');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  bgTypeTag.textContent = isVideo ? 'VIDEO (UPLOADING...)' : 'IMAGE (UPLOADING...)';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      setBackgroundSource(data.url, isVideo ? 'video' : 'image', data.path);
    } else {
      const localUrl = URL.createObjectURL(file);
      setBackgroundSource(localUrl, isVideo ? 'video' : 'image', file.name);
    }
  } catch (err) {
    console.warn('Backend upload failed, using local URL preview:', err);
    const localUrl = URL.createObjectURL(file);
    setBackgroundSource(localUrl, isVideo ? 'video' : 'image', file.name);
  }
}

function setBackgroundSource(src, type, path = null) {
  state.background.type = type;
  state.background.src = src;
  state.background.serverPath = path || src;
  bgTypeTag.textContent = type.toUpperCase();

  if (type === 'video') {
    const vid = document.createElement('video');
    vid.src = src;
    vid.crossOrigin = 'anonymous';
    vid.loop = true;
    vid.muted = true;
    vid.autoplay = true;
    vid.play().catch(() => {});
    state.background.element = vid;
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    state.background.element = img;
  }
}

function loadSampleBackground() {
  setBackgroundSource('/assets/sample_cyber_grid.png', 'image', '/assets/sample_cyber_grid.png');
}

// --- Widget Management ---
function addWidget(type) {
  let widget = null;

  switch (type) {
    case 'cpu_temp':
      widget = {
        id: genId('cputemp'),
        type: 'cpu_temp',
        name: 'CPU Temp Readout',
        x: 240,
        y: 190,
        fontSize: 44,
        color: '#00f0ff',
        label: 'CPU TEMP',
        unit: '°C',
        showLabel: true,
        visible: true,
      };
      break;

    case 'gpu_temp':
      widget = {
        id: genId('gputemp'),
        type: 'gpu_temp',
        name: 'GPU Temp Readout',
        x: 240,
        y: 260,
        fontSize: 38,
        color: '#ff007f',
        label: 'GPU TEMP',
        unit: '°C',
        showLabel: true,
        visible: true,
      };
      break;

    case 'dual_temp':
      widget = {
        id: genId('dualtemp'),
        type: 'dual_temp',
        name: 'Dual Temp HUD',
        x: 240,
        y: 240,
        fontSize: 22,
        cpuColor: '#00f0ff',
        gpuColor: '#ff007f',
        bgColor: 'rgba(10, 10, 16, 0.75)',
        borderColor: 'rgba(0, 240, 255, 0.35)',
        visible: true,
      };
      break;

    case 'cpu_load':
      widget = {
        id: genId('cpuload'),
        type: 'cpu_load',
        name: 'CPU Load Readout',
        x: 160,
        y: 330,
        fontSize: 20,
        color: '#00f0ff',
        label: 'LOAD',
        visible: true,
      };
      break;

    case 'ram_stat':
      widget = {
        id: genId('ramstat'),
        type: 'ram_stat',
        name: 'RAM Usage Stat',
        x: 240,
        y: 340,
        fontSize: 16,
        color: '#00ff66',
        label: 'RAM',
        visible: true,
      };
      break;

    case 'cpu_gauge':
      widget = {
        id: genId('cpu'),
        type: 'cpu_gauge',
        name: 'CPU Temp Gauge',
        x: 240,
        y: 240,
        radius: 175,
        lineWidth: 12,
        color: '#00f0ff',
        trackColor: 'rgba(255,255,255,0.06)',
        label: 'CPU',
        maxTemp: 90,
        visible: true,
      };
      break;

    case 'gpu_gauge':
      widget = {
        id: genId('gpu'),
        type: 'gpu_gauge',
        name: 'GPU Gauge Ring',
        x: 240,
        y: 240,
        radius: 145,
        lineWidth: 9,
        color: '#ff007f',
        trackColor: 'rgba(255,255,255,0.06)',
        label: 'GPU',
        maxTemp: 90,
        visible: true,
      };
      break;

    case 'ram_gauge':
      widget = {
        id: genId('ram'),
        type: 'ram_gauge',
        name: 'RAM Bar',
        x: 240,
        y: 350,
        width: 180,
        height: 12,
        color: '#00ff66',
        trackColor: 'rgba(255,255,255,0.1)',
        label: 'RAM',
        visible: true,
      };
      break;

    case 'clock':
      widget = {
        id: genId('clock'),
        type: 'clock',
        name: 'Digital Clock',
        x: 240,
        y: 215,
        fontSize: 48,
        color: '#ffffff',
        hour12: false,
        showAmPm: false,
        showSeconds: false,
        showDate: true,
        dateFormat: 'EEE, MMM d',
        visible: true,
      };
      break;

    case 'text':
      widget = {
        id: genId('text'),
        type: 'text',
        name: 'Custom Text',
        x: 240,
        y: 120,
        text: 'DARKFLASH DV360S',
        fontSize: 13,
        color: '#94a3b8',
        letterSpacing: 2,
        visible: true,
      };
      break;

    case 'badge':
      widget = {
        id: genId('badge'),
        type: 'badge',
        name: 'AM5 Badge',
        x: 240,
        y: 395,
        text: 'AM5 RYZEN',
        color: '#00f0ff',
        bgColor: '#0a0e1a',
        bgAlpha: 0.85,
        borderColor: '#00f0ff',
        borderAlpha: 0.80,
        borderWidth: 2,
        borderRadius: 6,
        fontSize: 13,
        paddingX: 14,
        paddingY: 6,
        visible: true,
      };
      break;
  }

  if (widget) {
    if (!widget.effectType) widget.effectType = 'glow';
    if (!widget.effectColor) widget.effectColor = widget.color || '#00f0ff';
    if (widget.effectBlur === undefined) widget.effectBlur = 14;
    state.layers.push(widget);
    selectLayer(widget.id);
    renderLayerList();
  }
}

// Direct remove / delete layer
function deleteLayer(id, e) {
  if (e) e.stopPropagation();
  state.layers = state.layers.filter((l) => l.id !== id);
  if (state.selectedLayerId === id) {
    state.selectedLayerId = state.layers.length > 0 ? state.layers[state.layers.length - 1].id : null;
  }
  renderLayerList();
  updateInspector();
}

function toggleLayerVisibility(id, e) {
  if (e) e.stopPropagation();
  const layer = state.layers.find((l) => l.id === id);
  if (layer) {
    layer.visible = !layer.visible;
    renderLayerList();
  }
}

function selectLayer(id) {
  state.selectedLayerId = id;
  renderLayerList();
  updateInspector();
}

function getSelectedLayer() {
  return state.layers.find((l) => l.id === state.selectedLayerId);
}

// --- Layer List Rendering (With direct Trash delete button) ---
function renderLayerList() {
  layerListEl.innerHTML = '';
  layerCountEl.textContent = `${state.layers.length} Layer${state.layers.length === 1 ? '' : 's'}`;

  // Reverse iterate so highest z-index shows at top of list
  [...state.layers].reverse().forEach((layer) => {
    const item = document.createElement('div');
    item.className = `layer-item ${layer.id === state.selectedLayerId ? 'active' : ''}`;
    item.onclick = () => selectLayer(layer.id);

    const eyeIcon = layer.visible
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

    const trashIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

    item.innerHTML = `
      <div class="layer-info">
        <span style="display:inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${layer.color || layer.cpuColor || '#fff'};"></span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">${layer.name}</span>
      </div>
      <div class="layer-actions">
        <button class="icon-btn" onclick="toggleLayerVisibility('${layer.id}', event)" title="Toggle Visibility">
          ${eyeIcon}
        </button>
        <button class="icon-btn delete" onclick="deleteLayer('${layer.id}', event)" title="Delete Layer">
          ${trashIcon}
        </button>
      </div>
    `;
    layerListEl.appendChild(item);
  });

  // Append persistent Background Layer entry at bottom of stack
  const bgItem = document.createElement('div');
  const isBgSelected = state.selectedLayerId === '__background__';
  bgItem.className = `layer-item background-layer ${isBgSelected ? 'active' : ''}`;
  bgItem.onclick = () => selectLayer('__background__');

  const bgType = (state.background.type || 'color').toUpperCase();
  const bgScalePct = Math.round((state.background.scale || 1.0) * 100);
  const bgVisible = state.background.visible !== false;

  const bgEyeIcon = bgVisible
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  bgItem.innerHTML = `
    <div class="layer-info">
      <span style="display:inline-flex; align-items:center; color:var(--accent-cyan);">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
      </span>
      <span style="font-weight: 600; color: #fff;">Background (${bgType})</span>
      <span class="scale-badge">${bgScalePct}%</span>
    </div>
    <div class="layer-actions">
      <button class="icon-btn" onclick="toggleBackgroundVisibility(event)" title="Toggle Background Visibility">
        ${bgEyeIcon}
      </button>
    </div>
  `;
  layerListEl.appendChild(bgItem);
}

function toggleBackgroundVisibility(e) {
  if (e) e.stopPropagation();
  state.background.visible = state.background.visible === false ? true : false;
  renderLayerList();
}

// --- Background & Overall Theme Inspector ---
function scaleAllLayers(factor) {
  for (const layer of state.layers) {
    layer.x = Math.round(240 + (layer.x - 240) * factor);
    layer.y = Math.round(240 + (layer.y - 240) * factor);
    if (layer.fontSize) layer.fontSize = Math.max(10, Math.round(layer.fontSize * factor));
    if (layer.radius) layer.radius = Math.max(15, Math.round(layer.radius * factor));
    if (layer.lineWidth) layer.lineWidth = Math.max(2, Math.round(layer.lineWidth * factor));
    if (layer.width) layer.width = Math.max(20, Math.round(layer.width * factor));
    if (layer.height) layer.height = Math.max(4, Math.round(layer.height * factor));
    if (layer.paddingX) layer.paddingX = Math.max(2, Math.round(layer.paddingX * factor));
    if (layer.paddingY) layer.paddingY = Math.max(2, Math.round(layer.paddingY * factor));
  }
  updateInspector();
}

function renderBackgroundInspector() {
  inspectorTitleEl.textContent = `BACKGROUND (${(state.background.type || 'color').toUpperCase()})`;
  btnDeleteLayer.style.display = 'none';
  inspectorFieldsEl.innerHTML = '';

  const isMedia = state.background.type === 'video' || state.background.type === 'image';

  if (isMedia) {
    // 1. Background Zoom / Scale Slider & Presets
    const scaleRow = createFieldRow('Background Zoom / Size');
    const scaleControl = scaleRow.querySelector('.field-control');
    const currScale = Math.round((state.background.scale || 1.0) * 100);

    const sliderContainer = document.createElement('div');
    sliderContainer.style.display = 'flex';
    sliderContainer.style.flexDirection = 'column';
    sliderContainer.style.gap = '8px';
    sliderContainer.style.width = '100%';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '30';
    slider.max = '200';
    slider.step = '5';
    slider.value = String(currScale);

    const labelVal = document.createElement('span');
    labelVal.style.fontSize = '12px';
    labelVal.style.fontWeight = '700';
    labelVal.style.color = 'var(--accent-cyan)';
    labelVal.style.width = '42px';
    labelVal.textContent = `${currScale}%`;

    const sliderRow = document.createElement('div');
    sliderRow.style.display = 'flex';
    sliderRow.style.alignItems = 'center';
    sliderRow.style.gap = '8px';
    sliderRow.appendChild(slider);
    sliderRow.appendChild(labelVal);

    slider.oninput = (e) => {
      const v = parseInt(e.target.value, 10);
      state.background.scale = v / 100.0;
      labelVal.textContent = `${v}%`;
      const badge = document.querySelector('.background-layer .scale-badge');
      if (badge) badge.textContent = `${v}%`;
    };

    // Quick preset buttons: 75%, 100% Fit, 125%, 150%
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '4px';
    btnRow.style.marginTop = '4px';

    [
      { label: '75%', val: 0.75 },
      { label: '100% (Fit)', val: 1.00 },
      { label: '125%', val: 1.25 },
      { label: '150%', val: 1.50 },
    ].forEach((preset) => {
      const b = document.createElement('button');
      b.className = 'btn-secondary';
      b.style.flex = '1';
      b.style.padding = '4px 6px';
      b.style.fontSize = '10px';
      b.textContent = preset.label;
      b.onclick = () => {
        state.background.scale = preset.val;
        slider.value = String(Math.round(preset.val * 100));
        labelVal.textContent = `${Math.round(preset.val * 100)}%`;
        const badge = document.querySelector('.background-layer .scale-badge');
        if (badge) badge.textContent = `${Math.round(preset.val * 100)}%`;
      };
      btnRow.appendChild(b);
    });

    sliderContainer.appendChild(sliderRow);
    sliderContainer.appendChild(btnRow);
    scaleControl.appendChild(sliderContainer);
    inspectorFieldsEl.appendChild(scaleRow);
  } else {
    // Solid color background
    const colRow = createFieldRow('Background Color');
    const colorPicker = createColorInput(state.background.color || '#0a0a0f', (col) => {
      state.background.color = col;
    });
    colRow.querySelector('.field-control').appendChild(colorPicker);
    inspectorFieldsEl.appendChild(colRow);
  }

  // 2. Overall Theme Scaler (Scales ALL HUD Widgets)
  const themeScaleCard = document.createElement('div');
  themeScaleCard.style.background = 'rgba(0, 240, 255, 0.05)';
  themeScaleCard.style.border = '1px solid rgba(0, 240, 255, 0.15)';
  themeScaleCard.style.borderRadius = 'var(--radius-sm)';
  themeScaleCard.style.padding = '12px';
  themeScaleCard.style.display = 'flex';
  themeScaleCard.style.flexDirection = 'column';
  themeScaleCard.style.gap = '8px';
  themeScaleCard.style.marginTop = '10px';

  themeScaleCard.innerHTML = `
    <div style="font-size: 11px; font-weight: 700; color: var(--accent-cyan); text-transform: uppercase; display: flex; align-items: center; justify-content: space-between;">
      <span>📐 Resize Entire Theme (All Widgets)</span>
    </div>
    <div style="font-size: 10px; color: var(--text-dim);">
      Proportionally scale all dials, gauges, text, and telemetry together around center.
    </div>
  `;

  const scaleActions = document.createElement('div');
  scaleActions.style.display = 'flex';
  scaleActions.style.gap = '6px';

  const btnScaleDown = document.createElement('button');
  btnScaleDown.className = 'btn-secondary';
  btnScaleDown.style.flex = '1';
  btnScaleDown.style.padding = '6px 8px';
  btnScaleDown.style.fontSize = '11px';
  btnScaleDown.innerHTML = '➖ 10% Smaller';
  btnScaleDown.onclick = () => scaleAllLayers(0.90);

  const btnScaleUp = document.createElement('button');
  btnScaleUp.className = 'btn-secondary';
  btnScaleUp.style.flex = '1';
  btnScaleUp.style.padding = '6px 8px';
  btnScaleUp.style.fontSize = '11px';
  btnScaleUp.innerHTML = '➕ 10% Larger';
  btnScaleUp.onclick = () => scaleAllLayers(1.10);

  scaleActions.appendChild(btnScaleDown);
  scaleActions.appendChild(btnScaleUp);
  themeScaleCard.appendChild(scaleActions);

  inspectorFieldsEl.appendChild(themeScaleCard);
}

// --- Inspector Panel Rendering ---
function updateInspector() {
  if (state.selectedLayerId === '__background__') {
    renderBackgroundInspector();
    return;
  }

  const layer = getSelectedLayer();
  if (!layer) {
    inspectorTitleEl.textContent = 'LAYER PROPERTIES';
    btnDeleteLayer.style.display = 'none';
    inspectorFieldsEl.innerHTML = `
      <div style="font-size: 11px; color: var(--text-dim); text-align: center; padding: 12px 0;">
        Select a layer to edit properties
      </div>`;
    return;
  }

  btnDeleteLayer.style.display = 'flex';
  inspectorTitleEl.textContent = layer.name.toUpperCase();
  inspectorFieldsEl.innerHTML = '';

  // Common: X & Y Position
  const posRow = createFieldRow('Position (X, Y)');
  const xInput = createNumberInput(layer.x, 0, 480, (v) => { layer.x = v; });
  const yInput = createNumberInput(layer.y, 0, 480, (v) => { layer.y = v; });
  posRow.querySelector('.field-control').style.display = 'flex';
  posRow.querySelector('.field-control').style.gap = '8px';
  posRow.querySelector('.field-control').appendChild(xInput);
  posRow.querySelector('.field-control').appendChild(yInput);
  inspectorFieldsEl.appendChild(posRow);

  // Common: Primary Color
  if (layer.color !== undefined) {
    const colRow = createFieldRow('Color');
    const colInput = createColorInput(layer.color, (v) => { layer.color = v; });
    colRow.querySelector('.field-control').appendChild(colInput);
    inspectorFieldsEl.appendChild(colRow);
  }

  // Type Specific
  if (layer.type === 'cpu_temp' || layer.type === 'gpu_temp') {
    const fsRow = createFieldRow('Font Size');
    fsRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.fontSize, 18, 90, (v) => { layer.fontSize = v; })
    );
    inspectorFieldsEl.appendChild(fsRow);

    const lblRow = createFieldRow('Label Text');
    const lblInput = document.createElement('input');
    lblInput.type = 'text';
    lblInput.value = layer.label;
    lblInput.oninput = (e) => { layer.label = e.target.value; };
    lblRow.querySelector('.field-control').appendChild(lblInput);
    inspectorFieldsEl.appendChild(lblRow);

    const showLblRow = createFieldRow('Show Sublabel');
    const showCheck = document.createElement('input');
    showCheck.type = 'checkbox';
    showCheck.checked = layer.showLabel !== false;
    showCheck.onchange = (e) => { layer.showLabel = e.target.checked; };
    showLblRow.querySelector('.field-control').appendChild(showCheck);
    inspectorFieldsEl.appendChild(showLblRow);
  } else if (layer.type === 'dual_temp') {
    const fsRow = createFieldRow('Font Size');
    fsRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.fontSize, 14, 40, (v) => { layer.fontSize = v; })
    );
    inspectorFieldsEl.appendChild(fsRow);

    const cpuColRow = createFieldRow('CPU Color');
    cpuColRow.querySelector('.field-control').appendChild(
      createColorInput(layer.cpuColor || '#00f0ff', (v) => { layer.cpuColor = v; })
    );
    inspectorFieldsEl.appendChild(cpuColRow);

    const gpuColRow = createFieldRow('GPU Color');
    gpuColRow.querySelector('.field-control').appendChild(
      createColorInput(layer.gpuColor || '#ff007f', (v) => { layer.gpuColor = v; })
    );
    inspectorFieldsEl.appendChild(gpuColRow);
  } else if (layer.type === 'cpu_load' || layer.type === 'ram_stat') {
    const fsRow = createFieldRow('Font Size');
    fsRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.fontSize, 12, 50, (v) => { layer.fontSize = v; })
    );
    inspectorFieldsEl.appendChild(fsRow);
  } else if (layer.type === 'cpu_gauge' || layer.type === 'gpu_gauge') {
    const radRow = createFieldRow('Radius');
    radRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.radius, 40, 230, (v) => { layer.radius = v; })
    );
    inspectorFieldsEl.appendChild(radRow);

    const thickRow = createFieldRow('Thickness');
    thickRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.lineWidth, 2, 30, (v) => { layer.lineWidth = v; })
    );
    inspectorFieldsEl.appendChild(thickRow);
  } else if (layer.type === 'ram_gauge') {
    const wRow = createFieldRow('Width');
    wRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.width, 50, 400, (v) => { layer.width = v; })
    );
    inspectorFieldsEl.appendChild(wRow);

    const hRow = createFieldRow('Height');
    hRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.height, 4, 30, (v) => { layer.height = v; })
    );
    inspectorFieldsEl.appendChild(hRow);
  } else if (layer.type === 'clock') {
    const fsRow = createFieldRow('Font Size');
    fsRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.fontSize, 16, 96, (v) => { layer.fontSize = v; })
    );
    inspectorFieldsEl.appendChild(fsRow);

    const fmtRow = createFieldRow('Clock Format');
    const fmtSelect = document.createElement('select');
    fmtSelect.style.width = '100%';
    fmtSelect.innerHTML = `
      <option value="24" ${!layer.hour12 ? 'selected' : ''}>24-Hour (17:45)</option>
      <option value="12" ${layer.hour12 ? 'selected' : ''}>12-Hour (5:45)</option>
    `;
    fmtSelect.onchange = (e) => {
      layer.hour12 = e.target.value === '12';
      ampmRow.style.display = layer.hour12 ? 'flex' : 'none';
    };
    fmtRow.querySelector('.field-control').appendChild(fmtSelect);
    inspectorFieldsEl.appendChild(fmtRow);

    const ampmRow = createFieldRow('Show AM / PM');
    ampmRow.style.display = layer.hour12 ? 'flex' : 'none';
    const ampmCheckbox = document.createElement('input');
    ampmCheckbox.type = 'checkbox';
    ampmCheckbox.checked = Boolean(layer.showAmPm);
    ampmCheckbox.onchange = (e) => { layer.showAmPm = e.target.checked; };
    ampmRow.querySelector('.field-control').appendChild(ampmCheckbox);
    inspectorFieldsEl.appendChild(ampmRow);

    const secRow = createFieldRow('Show Seconds');
    const secCheckbox = document.createElement('input');
    secCheckbox.type = 'checkbox';
    secCheckbox.checked = layer.showSeconds;
    secCheckbox.onchange = (e) => { layer.showSeconds = e.target.checked; };
    secRow.querySelector('.field-control').appendChild(secCheckbox);
    inspectorFieldsEl.appendChild(secRow);

    const dateRow = createFieldRow('Show Date');
    const dateCheckbox = document.createElement('input');
    dateCheckbox.type = 'checkbox';
    dateCheckbox.checked = layer.showDate;
    dateCheckbox.onchange = (e) => { layer.showDate = e.target.checked; };
    dateRow.querySelector('.field-control').appendChild(dateCheckbox);
    inspectorFieldsEl.appendChild(dateRow);
  } else if (layer.type === 'text') {
    const textRow = createFieldRow('Text Content');
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = layer.text;
    textInput.oninput = (e) => { layer.text = e.target.value; };
    textRow.querySelector('.field-control').appendChild(textInput);
    inspectorFieldsEl.appendChild(textRow);

    const fsRow = createFieldRow('Font Size');
    fsRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.fontSize, 8, 48, (v) => { layer.fontSize = v; })
    );
    inspectorFieldsEl.appendChild(fsRow);
  } else if (layer.type === 'badge') {
    const textRow = createFieldRow('Badge Text');
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = layer.text;
    textInput.oninput = (e) => { layer.text = e.target.value; };
    textRow.querySelector('.field-control').appendChild(textInput);
    inspectorFieldsEl.appendChild(textRow);

    const fsRow = createFieldRow('Font Size');
    fsRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.fontSize || 13, 8, 36, (v) => { layer.fontSize = v; })
    );
    inspectorFieldsEl.appendChild(fsRow);

    const textColRow = createFieldRow('Text Color');
    textColRow.querySelector('.field-control').appendChild(
      createColorInput(layer.color || '#00f0ff', (v) => { layer.color = v; })
    );
    inspectorFieldsEl.appendChild(textColRow);

    const borderColRow = createFieldRow('Border Color');
    borderColRow.querySelector('.field-control').appendChild(
      createColorInput(layer.borderColor || layer.color || '#00f0ff', (v) => { layer.borderColor = v; })
    );
    inspectorFieldsEl.appendChild(borderColRow);

    const borderAlphaRow = createFieldRow('Border Opacity (%)');
    const curBAlpha = Math.round((layer.borderAlpha !== undefined ? layer.borderAlpha : 0.80) * 100);
    borderAlphaRow.querySelector('.field-control').appendChild(
      createSliderInput(curBAlpha, 0, 100, (v) => { layer.borderAlpha = v / 100; })
    );
    inspectorFieldsEl.appendChild(borderAlphaRow);

    const borderWRow = createFieldRow('Border Width (px)');
    borderWRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.borderWidth || 2, 1, 5, (v) => { layer.borderWidth = v; })
    );
    inspectorFieldsEl.appendChild(borderWRow);

    const bgColRow = createFieldRow('Background Glass Color');
    bgColRow.querySelector('.field-control').appendChild(
      createColorInput(cleanHexColor(layer.bgColor || '#0a0e1a', '#0a0e1a'), (v) => { layer.bgColor = v; })
    );
    inspectorFieldsEl.appendChild(bgColRow);

    const bgAlphaRow = createFieldRow('Background Opacity (%)');
    const curBgAlpha = Math.round((layer.bgAlpha !== undefined ? layer.bgAlpha : 0.85) * 100);
    bgAlphaRow.querySelector('.field-control').appendChild(
      createSliderInput(curBgAlpha, 0, 100, (v) => { layer.bgAlpha = v / 100; })
    );
    inspectorFieldsEl.appendChild(bgAlphaRow);

    const radiusRow = createFieldRow('Corner Radius');
    radiusRow.querySelector('.field-control').appendChild(
      createSliderInput(layer.borderRadius !== undefined ? layer.borderRadius : 6, 0, 16, (v) => { layer.borderRadius = v; })
    );
    inspectorFieldsEl.appendChild(radiusRow);
  }

  // --- Universal Visual FX & Glow Section ---
  const fxDivider = document.createElement('div');
  fxDivider.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
  fxDivider.style.marginTop = '14px';
  fxDivider.style.paddingTop = '10px';
  fxDivider.innerHTML = `
    <div style="font-size: 11px; font-weight: 700; color: var(--accent-cyan); letter-spacing: 0.8px; display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
      <span>✨</span> VISUAL FX & GLOW
    </div>
  `;
  inspectorFieldsEl.appendChild(fxDivider);

  // Effect Type Selector
  const fxTypeRow = createFieldRow('Effect Style');
  const fxTypeSelect = document.createElement('select');
  fxTypeSelect.className = 'studio-select';
  fxTypeSelect.style.width = '100%';

  const fxOptions = [
    { value: 'glow', label: '✨ Neon Bloom Glow' },
    { value: 'shadow', label: '🌑 Drop Shadow' },
    { value: 'outline', label: '🔲 High-Contrast Outline' },
    { value: 'none', label: '🚫 None' }
  ];

  fxOptions.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if ((layer.effectType || 'glow') === opt.value) o.selected = true;
    fxTypeSelect.appendChild(o);
  });

  fxTypeSelect.onchange = (e) => {
    layer.effectType = e.target.value;
    updateInspector();
  };
  fxTypeRow.querySelector('.field-control').appendChild(fxTypeSelect);
  inspectorFieldsEl.appendChild(fxTypeRow);

  const curFxType = layer.effectType || 'glow';

  if (curFxType !== 'none') {
    // Effect Color
    const fxColRow = createFieldRow(curFxType === 'shadow' ? 'Shadow Color' : 'Glow / Outline Color');
    const defaultEffCol = layer.effectColor || layer.color || (layer.type === 'gpu_temp' ? '#ff007f' : '#00f0ff');
    fxColRow.querySelector('.field-control').appendChild(
      createColorInput(cleanHexColor(defaultEffCol, '#00f0ff'), (v) => { layer.effectColor = v; })
    );
    inspectorFieldsEl.appendChild(fxColRow);

    // Effect Blur / Thickness Slider
    const fxBlurLabel = curFxType === 'outline' ? 'Outline Thickness (px)' : (curFxType === 'glow' ? 'Glow Bloom Intensity' : 'Shadow Blur Softness');
    const fxBlurRow = createFieldRow(fxBlurLabel);
    const maxVal = curFxType === 'outline' ? 6 : 30;
    const defaultBlur = curFxType === 'glow' ? 14 : (curFxType === 'shadow' ? 8 : 2);
    const curBlur = layer.effectBlur !== undefined ? layer.effectBlur : defaultBlur;
    fxBlurRow.querySelector('.field-control').appendChild(
      createSliderInput(curBlur, 1, maxVal, (v) => { layer.effectBlur = v; })
    );
    inspectorFieldsEl.appendChild(fxBlurRow);
  }
}

// Visual FX Canvas Helpers
function applyLayerFx(layer, defaultCol = '#00f0ff') {
  const fxType = (layer && layer.effectType) ? layer.effectType : 'glow';
  const fxCol = (layer && layer.effectColor) ? layer.effectColor : (layer && layer.color ? layer.color : defaultCol);
  const defBlur = fxType === 'glow' ? 14 : (fxType === 'shadow' ? 8 : 2);
  const fxBlur = (layer && layer.effectBlur !== undefined) ? layer.effectBlur : defBlur;

  if (fxType === 'none' || fxBlur <= 0) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return { type: 'none' };
  }

  if (fxType === 'glow') {
    ctx.shadowColor = fxCol;
    ctx.shadowBlur = fxBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return { type: 'glow', color: fxCol, blur: fxBlur };
  } else if (fxType === 'shadow') {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = fxBlur;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    return { type: 'shadow', color: 'rgba(0, 0, 0, 0.85)', blur: fxBlur };
  } else if (fxType === 'outline') {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return { type: 'outline', color: fxCol, width: Math.max(1, Math.min(6, fxBlur)) };
  }

  return { type: 'none' };
}

function clearLayerFx() {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// Field Helpers & Color Utils
function cleanHexColor(val, fallback = '#00f0ff') {
  if (!val || typeof val !== 'string') return fallback;
  const s = val.trim();
  if (s.startsWith('#')) {
    if (s.length === 4) {
      return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    if (s.length >= 7) {
      return s.substring(0, 7);
    }
  }
  if (s.startsWith('rgb')) {
    try {
      const parts = s.substring(s.indexOf('(') + 1, s.indexOf(')')).split(',');
      const r = Math.min(255, Math.max(0, parseInt(parts[0].trim(), 10))).toString(16).padStart(2, '0');
      const g = Math.min(255, Math.max(0, parseInt(parts[1].trim(), 10))).toString(16).padStart(2, '0');
      const b = Math.min(255, Math.max(0, parseInt(parts[2].trim(), 10))).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    } catch (e) {}
  }
  return fallback;
}

function hexToRgba(color, alpha = 1.0) {
  if (!color) return `rgba(255, 255, 255, ${alpha})`;
  const s = String(color).trim();
  if (s.startsWith('rgba')) {
    if (alpha !== undefined) {
      const parts = s.substring(s.indexOf('(') + 1, s.indexOf(')')).split(',');
      return `rgba(${parts[0].trim()}, ${parts[1].trim()}, ${parts[2].trim()}, ${alpha})`;
    }
    return s;
  }
  if (s.startsWith('rgb(')) {
    const parts = s.substring(s.indexOf('(') + 1, s.indexOf(')')).split(',');
    return `rgba(${parts[0].trim()}, ${parts[1].trim()}, ${parts[2].trim()}, ${alpha})`;
  }
  const hex = cleanHexColor(s, '#00f0ff');
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createFieldRow(label) {
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.flexDirection = 'column';
  div.style.gap = '4px';
  div.innerHTML = `
    <span style="font-size: 11px; color: var(--text-dim);">${label}</span>
    <div class="field-control"></div>
  `;
  return div;
}

function createNumberInput(val, min, max, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = Math.round(val);
  inp.min = min;
  inp.max = max;
  inp.style.width = '100%';
  inp.oninput = (e) => onChange(parseFloat(e.target.value) || 0);
  return inp;
}

function createSliderInput(val, min, max, onChange) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';

  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = min;
  inp.max = max;
  inp.value = val;
  inp.style.flex = '1';

  const num = document.createElement('span');
  num.style.fontSize = '11px';
  num.style.color = 'var(--accent-cyan)';
  num.style.width = '30px';
  num.textContent = val;

  inp.oninput = (e) => {
    num.textContent = e.target.value;
    onChange(parseInt(e.target.value, 10));
  };

  wrap.appendChild(inp);
  wrap.appendChild(num);
  return wrap;
}

function createColorInput(hex, onChange) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';

  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = cleanHexColor(hex, '#00f0ff');
  inp.style.width = '36px';
  inp.style.height = '28px';
  inp.style.border = 'none';
  inp.style.background = 'transparent';
  inp.style.cursor = 'pointer';

  const text = document.createElement('input');
  text.type = 'text';
  text.value = inp.value;
  text.style.flex = '1';

  inp.oninput = (e) => {
    text.value = e.target.value;
    onChange(e.target.value);
  };
  text.oninput = (e) => {
    const clean = cleanHexColor(e.target.value, inp.value);
    inp.value = clean;
    onChange(e.target.value);
  };

  wrap.appendChild(inp);
  wrap.appendChild(text);
  return wrap;
}

// --- Canvas Interactions (Mouse Drag & Select) ---
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onCanvasMouseDown(e) {
  const pos = getCanvasPos(e);

  let hitLayer = null;
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (!layer.visible) continue;

    const dx = pos.x - layer.x;
    const dy = pos.y - layer.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (layer.radius && Math.abs(dist - layer.radius) <= (layer.lineWidth || 10) + 12) {
      hitLayer = layer;
      break;
    } else if (dist <= 40) {
      hitLayer = layer;
      break;
    }
  }

  if (hitLayer) {
    selectLayer(hitLayer.id);
    state.isDragging = true;
    state.dragOffset = {
      x: pos.x - hitLayer.x,
      y: pos.y - hitLayer.y,
    };
  } else {
    state.selectedLayerId = null;
    renderLayerList();
    updateInspector();
  }
}

function onCanvasMouseMove(e) {
  if (!state.isDragging) return;
  const layer = getSelectedLayer();
  if (!layer) return;

  const pos = getCanvasPos(e);
  let newX = pos.x - state.dragOffset.x;
  let newY = pos.y - state.dragOffset.y;

  // Center magnetic snap (within 8 pixels)
  if (Math.abs(newX - 240) < 8) newX = 240;
  if (Math.abs(newY - 240) < 8) newY = 240;

  layer.x = Math.round(newX);
  layer.y = Math.round(newY);
  updateInspector();
}

function onCanvasMouseUp() {
  state.isDragging = false;
}

// --- Canvas Rendering Loop ---
function renderLoop() {
  renderCanvas();
  requestAnimationFrame(renderLoop);
}

function renderCanvas() {
  ctx.save();
  ctx.clearRect(0, 0, 480, 480);

  // 1. Draw Background
  if (state.background.visible !== false && state.background.element && (state.background.type === 'image' || state.background.type === 'video')) {
    const el = state.background.element;
    const elW = el.videoWidth || el.naturalWidth || 480;
    const elH = el.videoHeight || el.naturalHeight || 480;
    const minDim = Math.min(elW, elH);
    const sx = (elW - minDim) / 2;
    const sy = (elH - minDim) / 2;

    const scale = state.background.scale || 1.0;
    const drawSize = 480 * scale;
    const drawX = 240 - drawSize / 2;
    const drawY = 240 - drawSize / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 480, 480);
    ctx.drawImage(el, sx, sy, minDim, minDim, drawX, drawY, drawSize, drawSize);
  } else {
    ctx.fillStyle = state.background.color || '#0a0a0f';
    ctx.fillRect(0, 0, 480, 480);
  }

  // 2. Draw Layer Stack
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    drawLayer(layer);
  }

  // 3. Draw Selection Highlight
  if (state.selectedLayerId === '__background__') {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(3, 3, 474, 474);
    ctx.restore();
  } else {
    const sel = getSelectedLayer();
    if (sel && sel.visible) {
      drawSelectionGizmo(sel);
    }
  }

  ctx.restore();
}

function drawLayer(layer) {
  ctx.save();

  switch (layer.type) {
    case 'cpu_temp':
      drawCpuTemp(layer);
      break;

    case 'gpu_temp':
      drawGpuTemp(layer);
      break;

    case 'dual_temp':
      drawDualTemp(layer);
      break;

    case 'cpu_load':
      drawCpuLoad(layer);
      break;

    case 'ram_stat':
      drawRamStat(layer);
      break;

    case 'cpu_gauge':
    case 'gpu_gauge':
      drawCircularGauge(layer);
      break;

    case 'ram_gauge':
      drawProgressBar(layer);
      break;

    case 'clock':
      drawClock(layer);
      break;

    case 'text':
      drawText(layer);
      break;

    case 'badge':
      drawBadge(layer);
      break;
  }

  ctx.restore();
}

function drawCpuTemp(layer) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tempVal = `${Math.round(state.sensors.cpu_temp)}${layer.unit || '°C'}`;
  ctx.font = `800 ${layer.fontSize}px monospace`;
  ctx.fillStyle = layer.color || '#00f0ff';
  const fx = applyLayerFx(layer, layer.color || '#00f0ff');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(tempVal, layer.x, layer.y);
  }
  ctx.fillText(tempVal, layer.x, layer.y);
  clearLayerFx();

  if (layer.showLabel !== false) {
    ctx.font = '700 11px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.letterSpacing = '1.5px';
    ctx.fillText(layer.label || 'CPU TEMP', layer.x, layer.y - layer.fontSize * 0.65);
  }
  ctx.restore();
}

function drawGpuTemp(layer) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tempVal = `${Math.round(state.sensors.gpu_temp)}${layer.unit || '°C'}`;
  ctx.font = `800 ${layer.fontSize}px monospace`;
  ctx.fillStyle = layer.color || '#ff007f';
  const fx = applyLayerFx(layer, layer.color || '#ff007f');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(tempVal, layer.x, layer.y);
  }
  ctx.fillText(tempVal, layer.x, layer.y);
  clearLayerFx();

  if (layer.showLabel !== false) {
    ctx.font = '700 11px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.letterSpacing = '1.5px';
    ctx.fillText(layer.label || 'GPU TEMP', layer.x, layer.y - layer.fontSize * 0.65);
  }
  ctx.restore();
}

function drawDualTemp(layer) {
  ctx.save();
  const fs = layer.fontSize || 22;
  const cpuT = `${Math.round(state.sensors.cpu_temp)}°C`;
  const gpuT = `${Math.round(state.sensors.gpu_temp)}°C`;

  const w = 240;
  const h = fs + 26;
  const left = layer.x - w / 2;
  const top = layer.y - h / 2;

  // Background Box with FX
  applyLayerFx(layer, layer.borderColor || '#00f0ff');
  ctx.fillStyle = layer.bgColor || 'rgba(10, 10, 16, 0.85)';
  ctx.strokeStyle = layer.borderColor || 'rgba(0, 240, 255, 0.75)';
  ctx.lineWidth = layer.borderWidth || 2;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 10);
  ctx.fill();
  ctx.stroke();
  clearLayerFx();

  // Divider
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(layer.x, top + 6);
  ctx.lineTo(layer.x, top + h - 6);
  ctx.stroke();

  // CPU Section
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 10px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText('CPU', left + w * 0.25, top + 10);

  ctx.font = `800 ${fs}px monospace`;
  ctx.fillStyle = layer.cpuColor || '#00f0ff';
  const cpuFx = applyLayerFx({ effectType: layer.effectType || 'glow', effectColor: layer.cpuColor || '#00f0ff', effectBlur: Math.min(10, layer.effectBlur !== undefined ? layer.effectBlur : 8) });
  if (cpuFx.type === 'outline') {
    ctx.strokeStyle = cpuFx.color;
    ctx.lineWidth = cpuFx.width;
    ctx.strokeText(cpuT, left + w * 0.25, top + h * 0.62);
  }
  ctx.fillText(cpuT, left + w * 0.25, top + h * 0.62);
  clearLayerFx();

  // GPU Section
  ctx.font = '700 10px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText('GPU', left + w * 0.75, top + 10);

  ctx.font = `800 ${fs}px monospace`;
  ctx.fillStyle = layer.gpuColor || '#ff007f';
  const gpuFx = applyLayerFx({ effectType: layer.effectType || 'glow', effectColor: layer.gpuColor || '#ff007f', effectBlur: Math.min(10, layer.effectBlur !== undefined ? layer.effectBlur : 8) });
  if (gpuFx.type === 'outline') {
    ctx.strokeStyle = gpuFx.color;
    ctx.lineWidth = gpuFx.width;
    ctx.strokeText(gpuT, left + w * 0.75, top + h * 0.62);
  }
  ctx.fillText(gpuT, left + w * 0.75, top + h * 0.62);
  clearLayerFx();
  ctx.restore();
}

function drawCpuLoad(layer) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const loadVal = `${Math.round(state.sensors.cpu_pct)}%`;
  ctx.font = `800 ${layer.fontSize}px monospace`;
  ctx.fillStyle = layer.color || '#00f0ff';
  const fx = applyLayerFx(layer, layer.color || '#00f0ff');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(loadVal, layer.x, layer.y);
  }
  ctx.fillText(loadVal, layer.x, layer.y);
  clearLayerFx();

  ctx.font = '700 10px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillText(layer.label || 'CPU LOAD', layer.x, layer.y + layer.fontSize * 0.65);
  ctx.restore();
}

function drawRamStat(layer) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const used = state.sensors.ram_used_gb || 0;
  const total = state.sensors.ram_total_gb || 16;
  const pct = Math.round(state.sensors.ram_pct || 0);
  const fs = layer.fontSize || 16;
  const valY = layer.y - Math.round(fs * 0.45) - 2;
  const lblY = layer.y + Math.round(fs * 0.45) + 3;

  ctx.font = `800 ${fs}px monospace`;
  ctx.fillStyle = layer.color || '#00ff66';
  const fx = applyLayerFx(layer, layer.color || '#00ff66');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(`${used} / ${total} GB`, layer.x, valY);
  }
  ctx.fillText(`${used} / ${total} GB`, layer.x, valY);
  clearLayerFx();

  const lblFs = Math.max(9, Math.round(fs * 0.6));
  ctx.font = `700 ${lblFs}px monospace`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillText(`RAM USED (${pct}%)`, layer.x, lblY);
  ctx.restore();
}

function drawCircularGauge(layer) {
  const x = layer.x;
  const y = layer.y;
  const radius = layer.radius || 175;
  const lineWidth = layer.lineWidth || 12;
  const trackColor = layer.trackColor || 'rgba(255, 255, 255, 0.18)';
  const valColor = layer.color || '#00f0ff';
  const tempVal = layer.type === 'cpu_gauge' ? state.sensors.cpu_temp : state.sensors.gpu_temp;
  const pctClamped = tempVal / (layer.maxTemp || 90);
  const pct = Math.max(0.04, Math.min(1, pctClamped));
  const startAngle = -Math.PI * 0.75;
  const endAngle = Math.PI * 0.75;
  const totalArc = endAngle - startAngle;

  // Background Track
  ctx.beginPath();
  ctx.arc(x, y, radius, startAngle, endAngle);
  ctx.strokeStyle = trackColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Active Arc with FX
  ctx.beginPath();
  ctx.arc(x, y, radius, startAngle, startAngle + totalArc * pct);
  ctx.strokeStyle = valColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  const fx = applyLayerFx(layer, valColor);
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = lineWidth + fx.width * 2;
    ctx.stroke();
    // Inner stroke
    ctx.strokeStyle = valColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  } else {
    ctx.stroke();
  }
  clearLayerFx();
}

function drawProgressBar(layer) {
  const x = layer.x;
  const y = layer.y;
  const width = layer.width || 180;
  const height = layer.height || 12;
  const trackColor = layer.trackColor || 'rgba(255, 255, 255, 0.2)';
  const valColor = layer.color || '#00ff66';
  const pct = Math.max(0.04, Math.min(1, (state.sensors.ram_pct || 30) / 100));
  const left = x - width / 2;
  const top = y - height / 2;
  const radius = height / 2;

  // Track
  ctx.fillStyle = trackColor;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, radius);
  ctx.fill();

  // Active Fill with FX
  const fillW = Math.max(height, width * pct);
  ctx.fillStyle = valColor;
  const fx = applyLayerFx(layer, valColor);
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeRect(left, top, fillW, height);
  }
  ctx.beginPath();
  ctx.roundRect(left, top, fillW, height, radius);
  ctx.fill();
  clearLayerFx();

  // Label
  ctx.font = '700 10px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(layer.label || `RAM ${Math.round(state.sensors.ram_pct || 0)}%`, x, top - 4);
}

function drawClock(layer) {
  ctx.save();
  const now = new Date();
  const rawH = now.getHours();
  let ampm = '';
  let hNum = rawH;
  if (layer.hour12) {
    ampm = rawH >= 12 ? 'PM' : 'AM';
    hNum = rawH % 12;
    if (hNum === 0) hNum = 12;
  }
  const h = layer.hour12 ? String(hNum) : String(hNum).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  let timeStr = layer.showSeconds ? `${h}:${m}:${s}` : `${h}:${m}`;
  if (layer.hour12 && layer.showAmPm) {
    timeStr = `${timeStr} ${ampm}`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${layer.fontSize}px monospace`;
  ctx.fillStyle = layer.color || '#ffffff';
  
  const fx = applyLayerFx(layer, layer.color || '#ffffff');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(timeStr, layer.x, layer.y);
  }
  ctx.fillText(timeStr, layer.x, layer.y);
  clearLayerFx();

  if (layer.showDate) {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const dateStr = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
    ctx.font = `700 11px monospace`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(dateStr, layer.x, layer.y + layer.fontSize * 0.55);
  }
  ctx.restore();
}

function drawText(layer) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${layer.fontSize}px monospace`;
  ctx.fillStyle = layer.color || '#ffffff';
  ctx.letterSpacing = `${layer.letterSpacing || 1}px`;
  
  const fx = applyLayerFx(layer, layer.color || '#ffffff');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(layer.text, layer.x, layer.y);
  }
  ctx.fillText(layer.text, layer.x, layer.y);
  clearLayerFx();
  ctx.restore();
}

function drawBadge(layer) {
  ctx.save();
  const fs = layer.fontSize || 13;
  ctx.font = `800 ${fs}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = layer.text || 'AM5 RYZEN';
  const metrics = ctx.measureText(text);
  const px = layer.paddingX || 14;
  const py = layer.paddingY || 6;
  const w = metrics.width + px * 2;
  const h = fs + py * 2;
  const radius = layer.borderRadius !== undefined ? layer.borderRadius : 6;
  const borderW = layer.borderWidth || 2;

  // Background color with alpha
  let bgCol = layer.bgColor || '#0a0e1a';
  if (bgCol.includes('240, 255, 0.12')) bgCol = '#0a0e1a';
  const bgAlpha = layer.bgAlpha !== undefined ? layer.bgAlpha : 0.85;
  const bgRgba = hexToRgba(bgCol, bgAlpha);

  // Border color with alpha
  const borderCol = layer.borderColor || layer.color || '#00f0ff';
  const borderAlpha = layer.borderAlpha !== undefined ? layer.borderAlpha : 0.80;
  const borderRgba = hexToRgba(borderCol, borderAlpha);

  const left = layer.x - w / 2;
  const top = layer.y - h / 2;

  // 1. Frosted glass background fill
  ctx.fillStyle = bgRgba;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, radius);
  ctx.fill();

  // 2. Vibrant border with FX
  ctx.strokeStyle = borderRgba;
  ctx.lineWidth = borderW;
  applyLayerFx(layer, borderCol);
  ctx.stroke();
  clearLayerFx();

  // 3. Vibrant text with FX
  ctx.fillStyle = layer.color || '#00f0ff';
  const fx = applyLayerFx(layer, layer.color || '#00f0ff');
  if (fx.type === 'outline') {
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = fx.width;
    ctx.strokeText(text, layer.x, layer.y);
  }
  ctx.fillText(text, layer.x, layer.y);
  clearLayerFx();
  ctx.restore();
}

function drawSelectionGizmo(layer) {
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);

  if (layer.radius) {
    ctx.beginPath();
    ctx.arc(layer.x, layer.y, layer.radius + (layer.lineWidth || 10) / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const boxSize = 50;
    ctx.strokeRect(layer.x - boxSize / 2, layer.y - boxSize / 2, boxSize, boxSize);
  }

  ctx.setLineDash([]);
  ctx.fillStyle = '#00f0ff';
  ctx.beginPath();
  ctx.arc(layer.x, layer.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

// --- Presets with Image Backgrounds & Rich Widget Configurations ---
function loadPreset(name) {
  if (name === 'blank') {
    clearToBlank();
    return;
  }
  if (name && name.startsWith('custom:')) {
    loadCustomPreset(name.substring(7));
    return;
  }
  state.layers = [];

  switch (name) {
    case 'reactor_core':
      setBackgroundSource('/assets/presets/reactor_core.jpg', 'image', '/assets/presets/reactor_core.jpg');
      addWidget('cpu_gauge');
      addWidget('gpu_gauge');
      addWidget('dual_temp');
      addWidget('clock');
      addWidget('badge');

      const rCpuG = state.layers.find((l) => l.type === 'cpu_gauge');
      if (rCpuG) {
        rCpuG.radius = 188;
        rCpuG.lineWidth = 12;
        rCpuG.color = '#00f0ff';
      }
      const rGpuG = state.layers.find((l) => l.type === 'gpu_gauge');
      if (rGpuG) {
        rGpuG.radius = 158;
        rGpuG.lineWidth = 8;
        rGpuG.color = '#e600ff';
      }
      const rDual = state.layers.find((l) => l.type === 'dual_temp');
      if (rDual) {
        rDual.y = 240;
        rDual.fontSize = 22;
        rDual.cpuColor = '#00f0ff';
        rDual.gpuColor = '#e600ff';
      }
      const rClock = state.layers.find((l) => l.type === 'clock');
      if (rClock) {
        rClock.y = 155;
        rClock.fontSize = 36;
      }
      const rBadge = state.layers.find((l) => l.type === 'badge');
      if (rBadge) {
        rBadge.y = 330;
        rBadge.text = 'FUSION REACTOR ACTIVE';
        rBadge.color = '#00f0ff';
      }
      break;

    case 'turbo_gauge':
      setBackgroundSource('/assets/presets/turbo_gauge.jpg', 'image', '/assets/presets/turbo_gauge.jpg');
      addWidget('cpu_temp');
      addWidget('gpu_temp');
      addWidget('cpu_load');
      addWidget('badge');

      const tCpu = state.layers.find((l) => l.type === 'cpu_temp');
      if (tCpu) {
        tCpu.x = 240;
        tCpu.y = 175;
        tCpu.fontSize = 42;
        tCpu.color = '#00f0ff';
        tCpu.label = 'TACHOMETER CPU';
      }
      const tGpu = state.layers.find((l) => l.type === 'gpu_temp');
      if (tGpu) {
        tGpu.x = 240;
        tGpu.y = 265;
        tGpu.fontSize = 38;
        tGpu.color = '#ff9900';
        tGpu.label = 'BOOST GPU';
      }
      const tLoad = state.layers.find((l) => l.type === 'cpu_load');
      if (tLoad) {
        tLoad.x = 240;
        tLoad.y = 340;
        tLoad.fontSize = 24;
        tLoad.color = '#ff0055';
        tLoad.label = 'THROTTLE LOAD';
      }
      const tBadge = state.layers.find((l) => l.type === 'badge');
      if (tBadge) {
        tBadge.x = 240;
        tBadge.y = 390;
        tBadge.text = 'TURBO SPORT';
        tBadge.color = '#ff9900';
        tBadge.borderColor = '#ff9900';
      }
      break;

    case 'retrowave_car':
      setBackgroundSource('/assets/presets/cyber_car.jpg', 'image', '/assets/presets/cyber_car.jpg');
      addWidget('clock');
      addWidget('dual_temp');
      addWidget('badge');

      const rwClock = state.layers.find((l) => l.type === 'clock');
      if (rwClock) {
        rwClock.y = 120;
        rwClock.fontSize = 46;
        rwClock.color = '#ff007f';
      }
      const rwDual = state.layers.find((l) => l.type === 'dual_temp');
      if (rwDual) {
        rwDual.y = 370;
        rwDual.cpuColor = '#00f0ff';
        rwDual.gpuColor = '#ff007f';
      }
      const rwBadge = state.layers.find((l) => l.type === 'badge');
      if (rwBadge) {
        rwBadge.y = 420;
        rwBadge.text = 'OUTRUN AM5';
        rwBadge.color = '#ff007f';
      }
      break;

    case 'anime_cyber':
      setBackgroundSource('/assets/presets/cyber_anime.jpg', 'image', '/assets/presets/cyber_anime.jpg');
      addWidget('cpu_gauge');
      addWidget('clock');
      addWidget('cpu_temp');

      const aCpuG = state.layers.find((l) => l.type === 'cpu_gauge');
      if (aCpuG) {
        aCpuG.radius = 175;
        aCpuG.color = '#ff007f';
      }
      const aClock = state.layers.find((l) => l.type === 'clock');
      if (aClock) {
        aClock.y = 110;
        aClock.fontSize = 38;
      }
      const aCpuT = state.layers.find((l) => l.type === 'cpu_temp');
      if (aCpuT) {
        aCpuT.x = 240;
        aCpuT.y = 370;
        aCpuT.fontSize = 36;
        aCpuT.color = '#00f0ff';
      }
      break;

    case 'neon_alley':
      setBackgroundSource('/assets/presets/neon_alley.png', 'image', '/assets/presets/neon_alley.png');
      addWidget('clock');
      addWidget('dual_temp');

      const naClock = state.layers.find((l) => l.type === 'clock');
      if (naClock) {
        naClock.y = 180;
        naClock.fontSize = 48;
      }
      const naDual = state.layers.find((l) => l.type === 'dual_temp');
      if (naDual) {
        naDual.y = 300;
        naDual.cpuColor = '#00f0ff';
        naDual.gpuColor = '#00ff66';
      }
      break;

    case 'carbon_telemetry':
      setBackgroundSource('/assets/presets/carbon_telemetry.jpg', 'image', '/assets/presets/carbon_telemetry.jpg');
      addWidget('cpu_temp');
      addWidget('gpu_temp');
      addWidget('ram_stat');
      addWidget('badge');

      const cbCpu = state.layers.find((l) => l.type === 'cpu_temp');
      if (cbCpu) {
        cbCpu.x = 160;
        cbCpu.y = 230;
        cbCpu.fontSize = 36;
        cbCpu.color = '#00f0ff';
      }
      const cbGpu = state.layers.find((l) => l.type === 'gpu_temp');
      if (cbGpu) {
        cbGpu.x = 320;
        cbGpu.y = 230;
        cbGpu.fontSize = 36;
        cbGpu.color = '#00ff66';
      }
      const cbRam = state.layers.find((l) => l.type === 'ram_stat');
      if (cbRam) {
        cbRam.x = 240;
        cbRam.y = 310;
        cbRam.color = '#ffffff';
      }
      const cbBadge = state.layers.find((l) => l.type === 'badge');
      if (cbBadge) {
        cbBadge.x = 240;
        cbBadge.y = 365;
        cbBadge.text = 'STEALTH CARBON';
      }
      break;

    case 'cyberpunk':
      loadSampleBackground();
      addWidget('cpu_gauge');
      addWidget('gpu_gauge');
      addWidget('clock');
      addWidget('ram_gauge');
      addWidget('badge');

      const cpu = state.layers.find((l) => l.type === 'cpu_gauge');
      if (cpu) {
        cpu.radius = 180;
        cpu.lineWidth = 12;
        cpu.color = '#00f0ff';
        cpu.trackColor = 'rgba(255, 255, 255, 0.16)';
        cpu.effectType = 'glow';
        cpu.effectColor = '#00f0ff';
        cpu.effectBlur = 12;
      }
      const gpu = state.layers.find((l) => l.type === 'gpu_gauge');
      if (gpu) {
        gpu.radius = 150;
        gpu.lineWidth = 8;
        gpu.color = '#ff007f';
        gpu.trackColor = 'rgba(255, 255, 255, 0.16)';
        gpu.effectType = 'glow';
        gpu.effectColor = '#ff007f';
        gpu.effectBlur = 10;
      }
      const clock = state.layers.find((l) => l.type === 'clock');
      if (clock) {
        clock.x = 240;
        clock.y = 200;
        clock.fontSize = 52;
        clock.color = '#ffffff';
        clock.effectType = 'glow';
        clock.effectColor = '#ffffff';
        clock.effectBlur = 12;
      }
      const ram = state.layers.find((l) => l.type === 'ram_gauge');
      if (ram) {
        ram.x = 240;
        ram.y = 290;
        ram.width = 160;
        ram.color = '#00ff66';
        ram.effectType = 'glow';
        ram.effectColor = '#00ff66';
        ram.effectBlur = 8;
      }
      const badge = state.layers.find((l) => l.type === 'badge');
      if (badge) {
        badge.x = 240;
        badge.y = 350;
        badge.text = 'AM5 SERPANTINUM';
        badge.color = '#00f0ff';
        badge.borderColor = '#00f0ff';
        badge.borderAlpha = 0.8;
        badge.bgColor = '#0a0e1a';
        badge.bgAlpha = 0.85;
        badge.effectType = 'glow';
        badge.effectColor = '#00f0ff';
        badge.effectBlur = 8;
      }
      break;

    case 'minimal':
      state.background.type = 'color';
      state.background.color = '#06070a';
      state.background.element = null;
      bgTypeTag.textContent = 'COLOR';

      addWidget('cpu_gauge');
      addWidget('clock');

      const minCpu = state.layers.find((l) => l.type === 'cpu_gauge');
      if (minCpu) {
        minCpu.radius = 160;
        minCpu.lineWidth = 4;
        minCpu.color = '#00f0ff';
      }
      const minClock = state.layers.find((l) => l.type === 'clock');
      if (minClock) {
        minClock.x = 240;
        minClock.y = 240;
        minClock.fontSize = 44;
      }
      break;
  }

  selectLayer(state.layers[0]?.id || null);
  renderLayerList();
}

function clearToBlank() {
  state.layers = [];
  state.background = {
    type: 'color',
    color: '#05070a',
    src: null,
    serverPath: null,
    element: null,
  };
  bgTypeTag.textContent = 'BLANK';
  if (presetSelector) presetSelector.value = 'blank';
  selectLayer(null);
  renderLayerList();
  updateInspector();
}

function renderCustomPresets() {
  const group = document.getElementById('custom-presets-group');
  if (!group) return;
  group.innerHTML = '';

  const customKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('df_preset_')) {
      customKeys.push(key.substring('df_preset_'.length));
    }
  }
  customKeys.sort();

  if (customKeys.length > 0) {
    group.style.display = '';
    customKeys.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = `custom:${name}`;
      opt.textContent = `💾 ${name}`;
      group.appendChild(opt);
    });
  } else {
    group.style.display = 'none';
  }
}

function loadCustomPreset(name) {
  try {
    const raw = localStorage.getItem(`df_preset_${name}`);
    if (!raw) {
      alert(`Preset "${name}" not found.`);
      return;
    }
    const data = JSON.parse(raw);
    state.layers = data.layers || [];
    if (data.rotation !== undefined) {
      state.rotation = data.rotation;
      document.querySelectorAll('#rotation-group .pill-btn').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.angle, 10) === state.rotation);
      });
    }
    if (data.background) {
      if (data.background.type === 'color' || !data.background.src) {
        state.background = {
          type: 'color',
          color: data.background.color || '#05070a',
          src: null,
          serverPath: null,
          element: null,
        };
        bgTypeTag.textContent = 'COLOR';
      } else {
        setBackgroundSource(data.background.src, data.background.type || 'image', data.background.serverPath || data.background.src);
      }
    } else {
      clearToBlank();
      return;
    }
    selectLayer(state.layers[0]?.id || null);
    renderLayerList();
    updateInspector();
  } catch (err) {
    console.error('Failed to load custom preset:', err);
    alert('Failed to load custom preset: ' + err.message);
  }
}

function saveCustomPreset(name) {
  name = (name || '').trim();
  if (!name) return;

  if (localStorage.getItem(`df_preset_${name}`)) {
    if (!confirm(`Preset "${name}" already exists. Overwrite?`)) {
      return;
    }
  }

  const presetData = {
    rotation: state.rotation,
    background: {
      type: state.background.type,
      color: state.background.color,
      src: state.background.serverPath || state.background.src,
      serverPath: state.background.serverPath,
    },
    layers: state.layers,
  };
  localStorage.setItem(`df_preset_${name}`, JSON.stringify(presetData));
  renderCustomPresets();
  if (presetSelector) presetSelector.value = `custom:${name}`;
  alert(`Preset "${name}" saved!`);
}

// --- Apply to Cooler Trigger ---
async function applyToCooler() {
  btnApplyCooler.disabled = true;
  btnApplyCooler.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin">
      <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/>
    </svg>
    STREAMING TO DV360S...
  `;

  const payload = {
    rotation: state.rotation,
    brightness: state.brightness,
    background: {
      type: state.background.type,
      color: state.background.color,
      serverPath: state.background.serverPath,
      scale: state.background.scale || 1.0,
      visible: state.background.visible !== false,
    },
    layers: state.layers,
  };

  try {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      btnApplyCooler.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        APPLIED ✓
      `;
      setTimeout(() => {
        btnApplyCooler.disabled = false;
        btnApplyCooler.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          APPLY TO COOLER
        `;
      }, 2500);
    } else {
      const err = await res.json();
      alert(`Error applying to cooler: ${err.message || res.statusText}`);
      btnApplyCooler.disabled = false;
      btnApplyCooler.textContent = 'APPLY TO COOLER';
    }
  } catch (e) {
    alert(`Could not connect to Studio daemon: ${e.message}`);
    btnApplyCooler.disabled = false;
    btnApplyCooler.textContent = 'APPLY TO COOLER';
  }
}

// --- Navigation Tabs (RAW vs RENDERED) ---
function setupTabNavigation() {
  const tabRaw = document.getElementById('tab-raw');
  const tabRendered = document.getElementById('tab-rendered');
  const rawView = document.getElementById('raw-view');
  const renderedView = document.getElementById('rendered-view');

  if (!tabRaw || !tabRendered || !rawView || !renderedView) return;

  function switchTab(target) {
    if (target === 'raw') {
      tabRaw.classList.add('active');
      tabRendered.classList.remove('active');
      rawView.classList.add('active');
      rawView.style.display = 'flex';
      renderedView.classList.remove('active');
      renderedView.style.display = 'none';
    } else {
      tabRendered.classList.add('active');
      tabRaw.classList.remove('active');
      renderedView.classList.add('active');
      renderedView.style.display = 'flex';
      rawView.classList.remove('active');
      rawView.style.display = 'none';
    }
  }

  // Set initial display styles explicitly
  rawView.style.display = 'flex';
  renderedView.style.display = 'none';

  tabRaw.addEventListener('click', () => switchTab('raw'));
  tabRendered.addEventListener('click', () => switchTab('rendered'));
}

// --- Game Mode (Streaming Pause / 0% CPU) ---
let isGameModeActive = false;

function updateGameModeUI(enabled) {
  isGameModeActive = Boolean(enabled);
  const btn = document.getElementById('btn-gamemode');
  const text = document.getElementById('gamemode-text');
  if (!btn || !text) return;

  if (isGameModeActive) {
    btn.classList.add('active');
    text.textContent = 'GAME MODE: ON';
    btn.title = 'Game Mode is ACTIVE: Cooler streaming is paused (0% CPU/GPU). Click to resume.';
  } else {
    btn.classList.remove('active');
    text.textContent = 'GAME MODE: OFF';
    btn.title = 'Pause cooler display streaming during games to free up 100% CPU/GPU resources';
  }
}

function setupGameMode() {
  const btn = document.getElementById('btn-gamemode');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const targetState = !isGameModeActive;
    updateGameModeUI(targetState);
    try {
      const res = await fetch('/api/gamemode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: targetState }),
      });
      if (res.ok) {
        const data = await res.json();
        updateGameModeUI(data.gamemode);
      }
    } catch (e) {
      console.error('Failed to toggle Game Mode:', e);
    }
  });

  fetch('/api/gamemode')
    .then((r) => r.json())
    .then((data) => {
      if (data && data.gamemode !== undefined) {
        updateGameModeUI(data.gamemode);
      }
    })
    .catch(() => {});
}

// --- Rendered Official Themes ---
const RENDERED_THEMES = {
  theme_1: {
    name: 'Cyber Reactor Core',
    video: '/assets/official/theme_1.mp4',
    layers: [
      {
        id: 'theme1_badge',
        name: 'Header Badge',
        type: 'badge',
        text: 'DARKFLASH DF-360',
        x: 240,
        y: 160,
        fontSize: 13,
        color: '#00f0ff',
        bgColor: '#0a0e1a',
        bgAlpha: 0.85,
        borderColor: '#00f0ff',
        borderAlpha: 0.8,
        borderWidth: 2,
        borderRadius: 6,
        paddingX: 14,
        paddingY: 6,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 8,
        visible: true,
      },
      {
        id: 'theme1_dual_temp',
        name: 'Dual Temp Telemetry',
        type: 'dual_temp',
        x: 240,
        y: 240,
        fontSize: 34,
        color: '#00f0ff',
        cpuColor: '#00f0ff',
        gpuColor: '#ff007f',
        bgColor: '#0a0e1a',
        bgAlpha: 0.85,
        borderColor: '#00f0ff',
        borderAlpha: 0.75,
        borderWidth: 2,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 10,
        visible: true,
      },
      {
        id: 'theme1_clock',
        name: 'Digital Chrono',
        type: 'clock',
        x: 240,
        y: 320,
        fontSize: 30,
        color: '#ffffff',
        showDate: false,
        showSeconds: true,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 8,
        visible: true,
      },
    ],
  },
  splash: {
    name: 'Orbital Space Station',
    video: '/assets/official/splash.mp4',
    layers: [
      {
        id: 'splash_clock',
        name: 'Chrono Display',
        type: 'clock',
        x: 240,
        y: 150,
        fontSize: 44,
        color: '#00f0ff',
        showDate: true,
        showSeconds: false,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 12,
        visible: true,
      },
      {
        id: 'splash_dual_temp',
        name: 'Core Telemetry HUD',
        type: 'dual_temp',
        x: 240,
        y: 248,
        fontSize: 32,
        color: '#ffffff',
        cpuColor: '#00f0ff',
        gpuColor: '#ff9900',
        bgColor: '#080c18',
        bgAlpha: 0.85,
        borderColor: '#00f0ff',
        borderAlpha: 0.75,
        borderWidth: 2,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 8,
        visible: true,
      },
      {
        id: 'splash_ram',
        name: 'RAM Status',
        type: 'ram_stat',
        x: 240,
        y: 350,
        fontSize: 16,
        color: '#ffffff',
        effectType: 'none',
        visible: true,
      },
    ],
  },
  theme_2: {
    name: 'Turbo Mach Tachometer',
    video: '/assets/official/theme_2.mp4',
    layers: [
      {
        id: 'theme2_badge',
        name: 'Sport Badge',
        type: 'badge',
        text: 'TURBO SPORT',
        x: 240,
        y: 170,
        fontSize: 13,
        color: '#ff3366',
        bgColor: '#16080e',
        bgAlpha: 0.85,
        borderColor: '#ff3366',
        borderAlpha: 0.8,
        borderWidth: 2,
        borderRadius: 6,
        paddingX: 14,
        paddingY: 6,
        effectType: 'glow',
        effectColor: '#ff3366',
        effectBlur: 10,
        visible: true,
      },
      {
        id: 'theme2_cpu_temp',
        name: 'Boost Temp',
        type: 'cpu_temp',
        x: 240,
        y: 240,
        fontSize: 50,
        color: '#ffcc00',
        unit: '°C',
        effectType: 'glow',
        effectColor: '#ff9900',
        effectBlur: 14,
        visible: true,
      },
      {
        id: 'theme2_cpu_load',
        name: 'Boost Load',
        type: 'cpu_load',
        x: 240,
        y: 318,
        fontSize: 22,
        color: '#ffffff',
        label: 'BOOST LOAD',
        effectType: 'none',
        visible: true,
      },
    ],
  },
  theme_3: {
    name: 'Neon Cyber Vitals',
    video: '/assets/official/theme_3.mp4',
    layers: [
      {
        id: 'theme3_dual_temp',
        name: 'Dual Temp HUD',
        type: 'dual_temp',
        x: 240,
        y: 195,
        fontSize: 34,
        color: '#00f0ff',
        cpuColor: '#00f0ff',
        gpuColor: '#ff007f',
        bgColor: '#0a0e1a',
        bgAlpha: 0.85,
        borderColor: '#00f0ff',
        borderAlpha: 0.75,
        borderWidth: 2,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 10,
        visible: true,
      },
      {
        id: 'theme3_ram_bar',
        name: 'RAM Level Bar',
        type: 'ram_gauge',
        x: 240,
        y: 270,
        width: 220,
        height: 12,
        color: '#00f0ff',
        trackColor: 'rgba(255, 255, 255, 0.2)',
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 10,
        visible: true,
      },
      {
        id: 'theme3_clock',
        name: 'System Time',
        type: 'clock',
        x: 240,
        y: 338,
        fontSize: 34,
        color: '#ffffff',
        showDate: false,
        showSeconds: true,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 8,
        visible: true,
      },
    ],
  },
  theme_4: {
    name: 'Quantum Ring Accelerator',
    video: '/assets/official/theme_4.mp4',
    layers: [
      {
        id: 'theme4_cpu_gauge',
        name: 'Core Ring Dial',
        type: 'cpu_gauge',
        x: 240,
        y: 240,
        radius: 175,
        lineWidth: 12,
        color: '#00f0ff',
        trackColor: 'rgba(255, 255, 255, 0.18)',
        maxTemp: 90,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 14,
        visible: true,
      },
      {
        id: 'theme4_cpu_temp',
        name: 'Core Readout',
        type: 'cpu_temp',
        x: 240,
        y: 215,
        fontSize: 48,
        color: '#ffffff',
        unit: '°C',
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 12,
        visible: true,
      },
      {
        id: 'theme4_clock',
        name: 'Sub Chrono',
        type: 'clock',
        x: 240,
        y: 285,
        fontSize: 28,
        color: '#00f0ff',
        showDate: false,
        showSeconds: false,
        effectType: 'glow',
        effectColor: '#00f0ff',
        effectBlur: 8,
        visible: true,
      },
    ],
  },
  theme_5: {
    name: 'Quantum Particle Vortex',
    video: '/assets/official/theme_5.mp4',
    layers: [
      {
        id: 'theme5_badge',
        name: 'Vortex Badge',
        type: 'badge',
        text: 'QUANTUM VORTEX',
        x: 240,
        y: 175,
        fontSize: 13,
        color: '#a855f7',
        bgColor: '#12081a',
        bgAlpha: 0.85,
        borderColor: '#a855f7',
        borderAlpha: 0.8,
        borderWidth: 2,
        borderRadius: 6,
        paddingX: 14,
        paddingY: 6,
        effectType: 'glow',
        effectColor: '#a855f7',
        effectBlur: 10,
        visible: true,
      },
      {
        id: 'theme5_dual_temp',
        name: 'Vortex Telemetry',
        type: 'dual_temp',
        x: 240,
        y: 245,
        fontSize: 32,
        color: '#a855f7',
        cpuColor: '#a855f7',
        gpuColor: '#00f0ff',
        bgColor: '#12081a',
        bgAlpha: 0.85,
        borderColor: '#a855f7',
        borderAlpha: 0.75,
        borderWidth: 2,
        effectType: 'glow',
        effectColor: '#a855f7',
        effectBlur: 10,
        visible: true,
      },
      {
        id: 'theme5_ram_stat',
        name: 'RAM Monitor',
        type: 'ram_stat',
        x: 240,
        y: 345,
        fontSize: 16,
        color: '#ffffff',
        effectType: 'none',
        visible: true,
      },
    ],
  },
  theme_6: {
    name: 'Tokyo Cyberpunk Rain',
    video: '/assets/official/theme_6.mp4',
    layers: [
      {
        id: 'theme6_clock',
        name: 'Tokyo Clock',
        type: 'clock',
        x: 240,
        y: 190,
        fontSize: 48,
        color: '#ff007f',
        showDate: true,
        showSeconds: true,
        effectType: 'glow',
        effectColor: '#ff007f',
        effectBlur: 14,
        visible: true,
      },
      {
        id: 'theme6_dual_temp',
        name: 'Cyber Telemetry',
        type: 'dual_temp',
        x: 240,
        y: 295,
        fontSize: 32,
        color: '#00f0ff',
        cpuColor: '#00f0ff',
        gpuColor: '#ff007f',
        bgColor: '#0a0e1a',
        bgAlpha: 0.85,
        borderColor: '#ff007f',
        borderAlpha: 0.75,
        borderWidth: 2,
        effectType: 'glow',
        effectColor: '#ff007f',
        effectBlur: 10,
        visible: true,
      },
    ],
  },
};

let renderedThemeScale = 1.0;

function setupRenderedThemes() {
  const pillGroup = document.getElementById('rendered-size-pill-group');
  const slider = document.getElementById('rendered-scale-slider');
  const valDisplay = document.getElementById('rendered-scale-val');

  if (pillGroup) {
    pillGroup.querySelectorAll('.size-pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        pillGroup.querySelectorAll('.size-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderedThemeScale = parseFloat(btn.dataset.scale);
        if (slider) slider.value = String(Math.round(renderedThemeScale * 100));
        if (valDisplay) valDisplay.textContent = `${Math.round(renderedThemeScale * 100)}%`;
      });
    });
  }

  if (slider) {
    slider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      renderedThemeScale = v / 100.0;
      if (valDisplay) valDisplay.textContent = `${v}%`;
      if (pillGroup) {
        pillGroup.querySelectorAll('.size-pill-btn').forEach((b) => {
          b.classList.toggle('active', Math.abs(parseFloat(b.dataset.scale) - renderedThemeScale) < 0.02);
        });
      }
    });
  }

  document.querySelectorAll('.btn-apply-theme').forEach((btn) => {
    btn.addEventListener('click', () => {
      const themeId = btn.dataset.themeId;
      applyRenderedTheme(themeId, btn);
    });
  });
}

async function applyRenderedTheme(themeId, btnElement) {
  const theme = RENDERED_THEMES[themeId];
  if (!theme) {
    alert(`Unknown theme: ${themeId}`);
    return;
  }

  // Visual state on button
  const originalHtml = btnElement ? btnElement.innerHTML : '';
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = `⏳ APPLYING ${theme.name.toUpperCase()}...`;
  }

  // Load into editor state
  setBackgroundSource(theme.video, 'video', theme.video);
  state.background.scale = renderedThemeScale;

  // Scale layers if renderedThemeScale != 1.0
  const scaledLayers = JSON.parse(JSON.stringify(theme.layers));
  if (renderedThemeScale !== 1.0) {
    for (const layer of scaledLayers) {
      layer.x = Math.round(240 + (layer.x - 240) * renderedThemeScale);
      layer.y = Math.round(240 + (layer.y - 240) * renderedThemeScale);
      if (layer.fontSize) layer.fontSize = Math.max(10, Math.round(layer.fontSize * renderedThemeScale));
      if (layer.radius) layer.radius = Math.max(15, Math.round(layer.radius * renderedThemeScale));
      if (layer.lineWidth) layer.lineWidth = Math.max(2, Math.round(layer.lineWidth * renderedThemeScale));
      if (layer.width) layer.width = Math.max(20, Math.round(layer.width * renderedThemeScale));
      if (layer.height) layer.height = Math.max(4, Math.round(layer.height * renderedThemeScale));
      if (layer.paddingX) layer.paddingX = Math.max(2, Math.round(layer.paddingX * renderedThemeScale));
      if (layer.paddingY) layer.paddingY = Math.max(2, Math.round(layer.paddingY * renderedThemeScale));
    }
  }

  state.layers = scaledLayers;
  state.selectedLayerId = state.layers[0] ? state.layers[0].id : null;
  renderLayerList();
  updateInspector();

  // Prepare daemon payload
  const payload = {
    rotation: state.rotation,
    brightness: state.brightness,
    background: {
      type: 'video',
      serverPath: theme.video,
      scale: state.background.scale,
      visible: state.background.visible !== false,
    },
    layers: state.layers,
  };

  try {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      if (btnElement) {
        btnElement.innerHTML = `✓ APPLIED TO COOLER!`;
        btnElement.style.background = 'var(--accent-green)';
        btnElement.style.color = '#000';
      }
      setTimeout(() => {
        if (btnElement) {
          btnElement.disabled = false;
          btnElement.innerHTML = originalHtml;
          btnElement.style.background = '';
          btnElement.style.color = '';
        }
      }, 2500);
    } else {
      const err = await res.json();
      alert(`Error applying theme: ${err.message || res.statusText}`);
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = originalHtml;
      }
    }
  } catch (e) {
    alert(`Could not connect to Studio daemon: ${e.message}`);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = originalHtml;
    }
  }
}

// Global hooks for button clicks from HTML
window.addWidget = addWidget;
window.deleteLayer = deleteLayer;
window.toggleLayerVisibility = toggleLayerVisibility;
window.clearToBlank = clearToBlank;
window.applyRenderedTheme = applyRenderedTheme;

// Run on page load
document.addEventListener('DOMContentLoaded', init);

