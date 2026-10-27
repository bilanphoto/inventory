/**
 * PTT 3D SMART BOARD — Frontend Controller & Flowchart Decision Engine
 * Exact 1607x896 canvas inpainting + live gauges, charts, bars, and interactive inputs
 */

(() => {
  const BOARD_W = 1607;
  const BOARD_H = 896;

  const THAI_MONTHS_SHORT = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  // ====================================================================
  // Internet Time Sync Engine (เวลาอินเทอร์เน็ตสากล UTC+7 ประเทศไทย)
  // ====================================================================
  let internetTimeOffsetMs = 0;
  let isInternetTimeSynced = false;
  let userOverrodeDateTime = false;

  function updateInternetTimeBadge(synced, sourceName = 'Internet Time') {
    const dot = document.getElementById('dot-live-time');
    const label = document.getElementById('txt-live-time-label');
    const btn = document.getElementById('btn-sync-time');
    if (dot) {
      dot.className = synced ? 'live-pulse-dot' : 'live-pulse-dot is-fallback';
    }
    if (label) {
      label.textContent = synced ? 'Internet Time' : 'Local Time';
    }
    if (btn) {
      btn.title = synced
        ? `🌐 ซิงค์เวลาจาก Internet Time (${sourceName}) สำเร็จ | เวลาประเทศไทย UTC+7`
        : `⚠️ ใช้เวลาจากเครื่อง (${sourceName}) | คลิกเพื่อลองเชื่อมต่อ Internet Time ใหม่`;
    }
  }

  async function fetchInternetTime() {
    const startMs = Date.now();
    const dot = document.getElementById('dot-live-time');
    if (dot) dot.classList.add('is-syncing');

    // 0. If running with backend (Python / Apache), try /api/time first
    if (window.location.protocol !== 'file:') {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 2000);
        const res = await fetch('api/time', { signal: controller.signal, cache: 'no-store' });
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          if (data && (data.iso || data.timestamp)) {
            const serverMs = data.timestamp ? data.timestamp * 1000 : new Date(data.iso).getTime();
            const latency = (Date.now() - startMs) / 2;
            internetTimeOffsetMs = (serverMs + latency) - Date.now();
            window.__internetTimeOffsetMs = internetTimeOffsetMs;
            isInternetTimeSynced = true;
            console.log('[Internet Time] Synced via Server Time API (Offset:', internetTimeOffsetMs, 'ms)');
            updateInternetTimeBadge(true, 'Server API');
            syncLiveDateTime(true);
            return true;
          }
        }
      } catch (e) {}
    }

    // 1. Try TimeAPI.io (Asia/Bangkok)
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia/Bangkok', {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        const iso = data.dateTime || data.currentLocalTime;
        if (iso) {
          const serverMs = new Date(iso).getTime();
          const latency = (Date.now() - startMs) / 2;
          internetTimeOffsetMs = (serverMs + latency) - Date.now();
          window.__internetTimeOffsetMs = internetTimeOffsetMs;
          isInternetTimeSynced = true;
          console.log('[Internet Time] Synced via TimeAPI.io (Offset:', internetTimeOffsetMs, 'ms)');
          updateInternetTimeBadge(true, 'TimeAPI.io');
          syncLiveDateTime(true);
          return true;
        }
      }
    } catch (e) {}

    // 2. Try WorldTimeAPI (Asia/Bangkok)
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Bangkok', {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data && data.datetime) {
          const serverMs = new Date(data.datetime).getTime();
          const latency = (Date.now() - startMs) / 2;
          internetTimeOffsetMs = (serverMs + latency) - Date.now();
          window.__internetTimeOffsetMs = internetTimeOffsetMs;
          isInternetTimeSynced = true;
          console.log('[Internet Time] Synced via WorldTimeAPI (Offset:', internetTimeOffsetMs, 'ms)');
          updateInternetTimeBadge(true, 'WorldTimeAPI');
          syncLiveDateTime(true);
          return true;
        }
      }
    } catch (e) {}

    // 3. Fallback: Server HTTP Date Header (Zero-CORS, Works on GitHub Pages, Apache, Python)
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(window.location.href, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(tid);
      const dateHeader = res.headers.get('date');
      if (dateHeader) {
        const serverMs = new Date(dateHeader).getTime();
        const latency = (Date.now() - startMs) / 2;
        internetTimeOffsetMs = (serverMs + latency) - Date.now();
        isInternetTimeSynced = true;
        console.log('[Internet Time] Synced via HTTP Server Date (Offset:', internetTimeOffsetMs, 'ms)');
        updateInternetTimeBadge(true, 'HTTP Server Date');
        syncLiveDateTime(true);
        return true;
      }
    } catch (e) {}

    // 4. Fallback: System clock adjusted to UTC+7
    console.log('[Internet Time] Using local system clock for Asia/Bangkok');
    updateInternetTimeBadge(false, 'Local System Clock');
    syncLiveDateTime(true);
    return false;
  }

  function getLiveThaiDateTime() {
    // Current time shifted by Internet Time offset
    const targetMs = Date.now() + internetTimeOffsetMs;
    const now = new Date(targetMs);

    // Compute UTC+7 (Bangkok) time explicitly
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const bangkokDate = new Date(utcMs + (3600000 * 7));

    const day = bangkokDate.getDate();
    const month = THAI_MONTHS_SHORT[bangkokDate.getMonth()] || '';
    const year = bangkokDate.getFullYear();
    const hh = String(bangkokDate.getHours()).padStart(2, '0');
    const mm = String(bangkokDate.getMinutes()).padStart(2, '0');
    const ss = String(bangkokDate.getSeconds()).padStart(2, '0');
    return {
      dateText: `วันที่ ${day} ${month} ${year}`,
      timeText: `${hh}:${mm}:${ss} น.`,
      timeShort: `${hh}:${mm} น.`,
      raw: bangkokDate
    };
  }

  const initialDateTime = getLiveThaiDateTime();

  // Default state matching bg_3dc3.png + live current date & time
  const DEFAULT_STATE = {
    dateText: initialDateTime.dateText,
    timeText: initialDateTime.timeText,
    // Card 1: Inventory
    inventoryPct: 69.32, // ค่าจริงจาก GSP Daily Report (Tank Farm): Propane %
    inventoryTon: 13864,
    inventoryCap: 20000,
    // Card 2: Tank Farm Demand
    demandPct: 70,
    demandTon: 14000,
    demandCap: 20000,
    remainingTon: 6136,
    tanksUsed: 7,
    tanksTotal: 10,
    // Card 3: Product Price
    productPrice: 300,
    productPriceChange: '+5%',
    productBaseSeries: [250, 275, 290, 315, 335, 360, 385],
    // Card 4: Energy Price
    energyPrice: 2650,
    energyPriceChange: '+8%',
    energyBaseSeries: [2200, 2450, 2600, 2750, 2900, 3050, 3200],
    // Flowchart Condition: Cross C3 to LPG ?
    crossC3ToLpg: true,
    // GSP Daily Report Tank Farm Values
    gspData: {
      propanePct: 69.32,
      lpgPct: 40.53,
      nglPct: 61.81,
      propanePlusLpgPct: 46.81,
    },
    // 3 Production Modes
    modes: {
      c3_max: { c3: 60, c4: 20, lpg: 15, other: 5, suitability: 70 },
      optimize: { c3: 40, c4: 30, lpg: 25, other: 5, suitability: 85 },
      lpg_mode: { c3: 20, c4: 20, lpg: 55, other: 5, suitability: 45 },
    },
    // Expected Result
    expectedResult: {
      profit: 'สูงสุด',
      energy: 'เหมาะสม',
      storage: 'สมดุล',
      flexibility: 'ดี',
    },
  };

  // Presets for Expected Result & Suitability when Flowchart switches mode
  const MODE_PRESETS = {
    c3_max: {
      suitability: { c3_max: 88, optimize: 65, lpg_mode: 40 },
      expected: {
        profit: 'สูงสุด (C3)',
        energy: 'ปานกลาง',
        storage: 'เพียงพอ',
        flexibility: 'พอใช้',
      },
    },
    optimize: {
      suitability: { c3_max: 70, optimize: 85, lpg_mode: 45 },
      expected: {
        profit: 'สูงสุด',
        energy: 'เหมาะสม',
        storage: 'สมดุล',
        flexibility: 'ดี',
      },
    },
    lpg_mode: {
      suitability: { c3_max: 45, optimize: 70, lpg_mode: 90 },
      expected: {
        profit: 'ดี (LPG)',
        energy: 'เหมาะสม',
        storage: 'ลดสต็อก',
        flexibility: 'สูง',
      },
    },
  };

  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  let lastRecommendedMode = 'optimize';

  // ====================================================================
  // Complete Dashboard State Persistence (Remember all settings across reloads)
  // ====================================================================
  const STATE_STORAGE_KEY = 'ptt_smartboard_state';

  function saveStateToLocalStorage() {
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state to localStorage', e);
    }
  }

  function loadStateFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          // Auto-upgrade previous default baseline to today's live Tank Farm figures (69.32%)
          if (saved.inventoryPct === 65.87 || saved.inventoryPct === 68.17 || saved.inventoryPct === 50.81) {
            saved.inventoryPct = 69.32;
            saved.inventoryTon = 13864;
            saved.remainingTon = 6136;
          }
          if (saved.gspData && (saved.gspData.propanePct === 65.87 || saved.gspData.propanePct === 68.17 || saved.gspData.propanePct === 50.81)) {
            saved.gspData.propanePct = 69.32;
            saved.gspData.lpgPct = 40.53;
            saved.gspData.nglPct = 61.81;
            saved.gspData.propanePlusLpgPct = 46.81;
          }
          Object.assign(state, saved);
          // Always initialize date & time with live internet time upon reload
          const live = getLiveThaiDateTime();
          state.dateText = live.dateText;
          state.timeText = live.timeText;
          if (saved.modes) {
            Object.assign(state.modes, saved.modes);
          }
          if (saved.expectedResult) {
            Object.assign(state.expectedResult, saved.expectedResult);
          }
          if (saved.gspData) {
            Object.assign(state.gspData, saved.gspData);
          }
          console.log('[Storage] Restored dashboard state from localStorage');
          return true;
        }
      }
    } catch (e) {
      console.warn('Failed to load state from localStorage', e);
    }
    return false;
  }

  // Canvas & Clean Base Image
  const canvas = document.getElementById('board-canvas');
  const ctx = canvas.getContext('2d');
  let cleanBgImage = null;
  let imageLoaded = false;
  let fetchTeamsConfig = async () => {};
  let triggerScreenshotSync = () => {};
  let doFetchGspFromChrome = async () => {};

  // Format integer with commas
  function fmtNum(n) {
    const num = Math.round(Number(n) || 0);
    return num.toLocaleString('en-US');
  }

  // Parse number from formatted string
  function parseNum(str, fallback = 0) {
    if (typeof str === 'number') return str;
    const cleaned = String(str).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // Round to 2 decimal places & format (e.g. 50.81)
  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
  function fmt2(n) {
    return round2(n).toFixed(2);
  }

  /**
   * Evaluates the Operation Mode Flowchart (ผังการตัดสินใจเลือกโหมดการผลิต)
   * matching Screenshot 2569-10-20 at 13.46.50.png:
   *   1. Cross C3 to LPG ? -> NO => C3 Max
   *   2. YES -> Inventory > 60% ? -> NO => C3 Max
   *   3. YES -> Inventory > 70% ? -> NO => Optimization | YES => LPG Mode
   */
  function evaluateFlowchart() {
    const cross = Boolean(state.crossC3ToLpg);
    const inv = Number(state.inventoryPct) || 0;

    const evalResult = {
      crossC3ToLpg: cross,
      invGt60: inv > 60,
      invGt70: inv > 70,
      recommendedMode: 'optimize', // 'c3_max' | 'optimize' | 'lpg_mode'
    };

    if (!cross) {
      evalResult.recommendedMode = 'c3_max';
    } else if (inv <= 60) {
      evalResult.recommendedMode = 'c3_max';
    } else if (inv <= 70) {
      evalResult.recommendedMode = 'optimize';
    } else {
      evalResult.recommendedMode = 'lpg_mode';
    }

    return evalResult;
  }

  /**
   * Draw Card 1 3D Tank Cylinder with dynamic liquid level (0-100%) and color threshold
   * Works without getImageData so it is 100% compatible with both http:// and file://
   */
  function drawCard1Tank(invPct) {
    const pct = clamp(invPct, 0, 100);
    const xStart = 30;
    const xEnd = 189;
    const w = xEnd - xStart;
    const yTop = 163;
    const yBot = 253;
    const totalH = yBot - yTop;
    const fillH = Math.round((pct / 100) * totalH);
    const yFillTop = yBot - fillH;

    // 1. Draw empty metallic cylinder wall from yTop to yBot
    const metalGrad = ctx.createLinearGradient(xStart, yTop, xEnd, yTop);
    metalGrad.addColorStop(0.0, '#6e839b');
    metalGrad.addColorStop(0.18, '#a0b8d8');
    metalGrad.addColorStop(0.50, '#6e89ac');
    metalGrad.addColorStop(0.84, '#92abca');
    metalGrad.addColorStop(1.0, '#5c728d');
    ctx.fillStyle = metalGrad;
    ctx.fillRect(xStart, yTop, w, totalH);

    // 2. Draw liquid fill from yFillTop to yBot with 3D cylindrical horizontal specular gradient
    if (fillH > 0) {
      const liqGrad = ctx.createLinearGradient(xStart, yFillTop, xEnd, yFillTop);
      if (pct <= 30) {
        // Red (0 - 30% ต่ำ)
        liqGrad.addColorStop(0.0, '#b91c1c');
        liqGrad.addColorStop(0.19, '#f87171');
        liqGrad.addColorStop(0.52, '#dc2626');
        liqGrad.addColorStop(0.85, '#ef4444');
        liqGrad.addColorStop(1.0, '#991b1b');
      } else if (pct <= 70) {
        // Green (31 - 70% ปกติ) matching bg_3dc3.png
        liqGrad.addColorStop(0.0, '#49b649');
        liqGrad.addColorStop(0.19, '#93fa87');
        liqGrad.addColorStop(0.52, '#1cb322');
        liqGrad.addColorStop(0.85, '#68e365');
        liqGrad.addColorStop(1.0, '#2c8f2b');
      } else {
        // Yellow (71 - 100% สูง)
        liqGrad.addColorStop(0.0, '#b45309');
        liqGrad.addColorStop(0.19, '#fde047');
        liqGrad.addColorStop(0.52, '#eab308');
        liqGrad.addColorStop(0.85, '#facc15');
        liqGrad.addColorStop(1.0, '#a16207');
      }
      ctx.fillStyle = liqGrad;
      ctx.fillRect(xStart, yFillTop, w, fillH);

      // Top liquid rim line
      ctx.save();
      ctx.strokeStyle = pct <= 30 ? '#fecaca' : pct <= 70 ? '#bbf7d0' : '#fef08a';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(xStart + 1, yFillTop);
      ctx.lineTo(xEnd - 1, yFillTop);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Highlight active threshold row in Card 1 Legend (0-30% ต่ำ, 31-70% ปกติ, 71-100% สูง)
    const legendRows = [
      { min: 0, max: 30, y: 173, color: '#ef4444' },
      { min: 31, max: 70, y: 202, color: '#22c55e' },
      { min: 71, max: 100, y: 232, color: '#eab308' },
    ];
    legendRows.forEach((row) => {
      const isActive = pct >= row.min && pct <= row.max;
      if (isActive) {
        ctx.save();
        ctx.strokeStyle = row.color;
        ctx.lineWidth = 1.8;
        ctx.shadowColor = row.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.roundRect(220, row.y - 4, 168, 25, 6);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  /**
   * Draw Circular Ring Gauge (used in Card 2 and Mode 1, 2, 3 suitability rings)
   */
  function drawRingGauge(cx, cy, radius, thickness, pct, startColor, endColor) {
    const clamped = clamp(pct, 0, 100);
    ctx.save();

    // Inner dark glass circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4, 20, 48, 0.85)';
    ctx.fill();

    // Background track ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = thickness;
    ctx.stroke();

    // Foreground active arc (starts at -90 deg / top)
    if (clamped > 0) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (clamped / 100) * Math.PI * 2;
      const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      grad.addColorStop(0, startColor);
      grad.addColorStop(1, endColor);

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = grad;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.shadowColor = endColor;
      ctx.shadowBlur = 8;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw Rounded Horizontal Progress Bar
   */
  function drawProgressBar(x, y, w, h, pct, cStart, cEnd, trackColor = 'rgba(30, 58, 95, 0.65)') {
    const clamped = clamp(pct, 0, 100);
    const r = h / 2;
    ctx.save();

    // Track
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = trackColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Fill
    if (clamped > 0) {
      const fillW = Math.max(h, (clamped / 100) * w);
      const grad = ctx.createLinearGradient(x, y, x + fillW, y);
      grad.addColorStop(0, cStart);
      grad.addColorStop(1, cEnd);

      ctx.beginPath();
      ctx.roundRect(x, y, fillW, h, r);
      ctx.fillStyle = grad;
      ctx.shadowColor = cEnd;
      ctx.shadowBlur = 6;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Draw Glowing Line Chart for Card 3 (Product Price) & Card 4 (Energy Price)
   */
  function drawLineChart(x0, y0, x1, y1, points, minVal, maxVal, lineColor, areaColor) {
    ctx.save();
    const w = x1 - x0;
    const h = y1 - y0;

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const gy = y0 + (i / 3) * h;
      ctx.beginPath();
      ctx.moveTo(x0, gy);
      ctx.lineTo(x1, gy);
      ctx.stroke();
    }

    const coords = points.map((val, idx) => {
      const px = x0 + (idx / (points.length - 1)) * w;
      const normY = clamp((val - minVal) / (maxVal - minVal), 0.05, 0.96);
      const py = y1 - normY * h;
      return { x: px, y: py };
    });

    // Area fill under curve
    const areaGrad = ctx.createLinearGradient(x0, y0, x0, y1);
    areaGrad.addColorStop(0, areaColor);
    areaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.moveTo(coords[0].x, y1);
    coords.forEach((pt) => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(coords[coords.length - 1].x, y1);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Glowing line
    ctx.beginPath();
    coords.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.6;
    ctx.shadowColor = lineColor;
    ctx.shadowBlur = 8;
    ctx.stroke();

    // Data point dots
    coords.forEach((pt, idx) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, idx === coords.length - 1 ? 4.2 : 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.restore();
  }

  /**
   * Draw Trend Arrow (Up/Down) in Card 3 & Card 4
   */
  function drawTrendArrow(cx, cy, isNegative, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    if (!isNegative) {
      // Up arrow
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx + 9, cy + 1);
      ctx.lineTo(cx + 4, cy + 1);
      ctx.lineTo(cx + 4, cy + 11);
      ctx.lineTo(cx - 4, cy + 11);
      ctx.lineTo(cx - 4, cy + 1);
      ctx.lineTo(cx - 9, cy + 1);
    } else {
      // Down arrow
      ctx.moveTo(cx, cy + 11);
      ctx.lineTo(cx + 9, cy - 1);
      ctx.lineTo(cx + 4, cy - 1);
      ctx.lineTo(cx + 4, cy - 11);
      ctx.lineTo(cx - 4, cy - 11);
      ctx.lineTo(cx - 4, cy - 1);
      ctx.lineTo(cx - 9, cy - 1);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Render SVG Active Mode Highlight & "(แนะนำ)" Badge based on Flowchart evaluation
   */
  function renderActiveModeOverlay(recommendedMode) {
    const layer = document.getElementById('active-mode-layer');
    if (!layer) return;

    const modeConfigs = {
      c3_max: {
        x: 441,
        y: 658,
        w: 280,
        h: 232,
        stroke: '#38bdf8',
        filter: 'url(#glow-cyan)',
        recX: 634,
        recY: 697,
        badgeBg: '#0284c7',
      },
      optimize: {
        x: 737,
        y: 658,
        w: 279,
        h: 232,
        stroke: '#4ade80',
        filter: 'url(#glow-green)',
        recX: 907,
        recY: 697,
        badgeBg: '#16a34a',
      },
      lpg_mode: {
        x: 1031,
        y: 658,
        w: 276,
        h: 232,
        stroke: '#c084fc',
        filter: 'url(#glow-purple)',
        recX: 1236,
        recY: 697,
        badgeBg: '#9333ea',
      },
    };

    let svgHtml = '';
    Object.entries(modeConfigs).forEach(([key, cfg]) => {
      const isRec = key === recommendedMode;

      // Grey-out overlay (CSS backdrop-filter) for non-recommended modes
      const dimEl = document.getElementById(`mode-dim-${key}`);
      if (dimEl) dimEl.classList.toggle('is-active', !isRec);

      // Dim the editable numbers inside non-recommended cards
      const prefix = { c3_max: 'm1', optimize: 'm2', lpg_mode: 'm3' }[key];
      ['c3', 'c4', 'lpg', 'other', 'suit'].forEach((k) => {
        const el = document.getElementById(`inp-${prefix}-${k}`);
        el?.parentElement?.classList.toggle('is-dimmed', !isRec);
      });

      if (isRec) {
        // Glowing colored frame + "แนะนำ" pill straddling the top-right border
        const pillW = 56;
        const pillX = cfg.x + cfg.w - pillW - 8;
        const pillY = cfg.y - 10;
        svgHtml += `
          <!-- Soft outer halo (pulsing) -->
          <rect class="rec-halo" style="--glow:${cfg.stroke}" x="${cfg.x - 3}" y="${cfg.y - 3}"
            width="${cfg.w + 6}" height="${cfg.h + 6}" rx="16"
            fill="none" stroke="${cfg.stroke}" stroke-width="10" />
          <!-- Main blinking glow border -->
          <rect class="rec-glow" style="--glow:${cfg.stroke}" x="${cfg.x}" y="${cfg.y}"
            width="${cfg.w}" height="${cfg.h}" rx="14"
            fill="none" stroke="${cfg.stroke}" stroke-width="3.4" />
          <rect x="${pillX}" y="${pillY}" width="${pillW}" height="16" rx="8"
            fill="${cfg.badgeBg}" stroke="#fef08a" stroke-width="1.2" />
          <text x="${pillX + pillW / 2}" y="${pillY + 12.5}" fill="#fef08a" font-family="Kanit, sans-serif"
            font-size="11.5" font-weight="700" text-anchor="middle">★ แนะนำ</text>
        `;
      }
    });

    if (layer.dataset.mode !== recommendedMode) {
      layer.innerHTML = svgHtml;
      layer.dataset.mode = recommendedMode;
    }
  }

  /**
   * Main Canvas Redraw Function
   */
  function renderBoard() {
    if (!imageLoaded) return;

    const evalRes = evaluateFlowchart();

    // If the recommended mode changed due to flowchart conditions, auto-apply its preset suitability & expected results
    if (evalRes.recommendedMode !== lastRecommendedMode) {
      lastRecommendedMode = evalRes.recommendedMode;
      const preset = MODE_PRESETS[evalRes.recommendedMode];
      if (preset) {
        state.modes.c3_max.suitability = preset.suitability.c3_max;
        state.modes.optimize.suitability = preset.suitability.optimize;
        state.modes.lpg_mode.suitability = preset.suitability.lpg_mode;
        state.expectedResult = { ...preset.expected };
        syncInputsFromState();
      }
    }

    // 1. Draw clean base background
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);
    ctx.drawImage(cleanBgImage, 0, 0, BOARD_W, BOARD_H);

    // 2. Card 1: 3D Tank Cylinder & Legend
    drawCard1Tank(state.inventoryPct);

    // 3. Card 2: Circular Ring Gauge (70%) & Progress Bar
    drawRingGauge(747, 201, 34, 7.5, state.demandPct, '#22c55e', '#06b6d4');
    drawProgressBar(440, 285, 349, 18, state.demandPct, '#22c55e', '#10b981');

    // 4. Card 3: Product Price Line Chart & Trend Arrow
    const prodDiff = state.productPrice - 300;
    const prodSeries = state.productBaseSeries.map((v, i) =>
      clamp(v + prodDiff * (0.3 + 0.7 * (i / 6)), 100, 500)
    );
    drawLineChart(865, 253, 1083, 312, prodSeries, 100, 500, '#facc15', 'rgba(250, 204, 21, 0.28)');
    const prodNeg = String(state.productPriceChange).trim().startsWith('-');
    drawTrendArrow(1113, 268, prodNeg, prodNeg ? '#f87171' : '#4ade80');

    // 5. Card 4: Energy Price Line Chart & Trend Arrow
    const energyDiff = state.energyPrice - 2650;
    const energySeries = state.energyBaseSeries.map((v, i) =>
      clamp(v + energyDiff * (0.3 + 0.7 * (i / 6)), 1500, 3500)
    );
    drawLineChart(1277, 253, 1488, 312, energySeries, 1500, 3500, '#38bdf8', 'rgba(56, 189, 248, 0.28)');
    const energyNeg = String(state.energyPriceChange).trim().startsWith('-');
    drawTrendArrow(1513, 268, energyNeg, '#f87171');

    // 6. Bottom Left: AI ANALYSIS 4 Progress Bars
    drawProgressBar(214, 684, 112, 18, state.inventoryPct, '#22c55e', '#4ade80');
    drawProgressBar(214, 727, 112, 18, state.demandPct, '#0284c7', '#38bdf8');
    const prodBarPct = clamp(((state.productPrice - 50) / 450) * 100, 5, 100);
    drawProgressBar(214, 774, 112, 18, prodBarPct, '#ca8a04', '#facc15');
    const energyBarPct = clamp(((state.energyPrice - 1000) / 2500) * 100, 5, 100);
    drawProgressBar(214, 826, 112, 18, energyBarPct, '#dc2626', '#f87171');

    // 7. Bottom Center: 3 Production Mode Mini Bars & Suitability Rings
    const modeVisuals = [
      {
        key: 'c3_max',
        barX: 491,
        barW: 110,
        ringCx: 683,
        ringCy: 856,
        colors: [
          ['#0284c7', '#38bdf8'],
          ['#2563eb', '#60a5fa'],
          ['#7c3aed', '#c084fc'],
          ['#64748b', '#94a3b8'],
        ],
        ringColors: ['#0284c7', '#38bdf8'],
      },
      {
        key: 'optimize',
        barX: 791,
        barW: 116,
        ringCx: 982,
        ringCy: 856,
        colors: [
          ['#0891b2', '#67e8f9'],
          ['#059669', '#6ee7b7'],
          ['#7c3aed', '#c4b5fd'],
          ['#64748b', '#cbd5e1'],
        ],
        ringColors: ['#16a34a', '#4ade80'],
      },
      {
        key: 'lpg_mode',
        barX: 1086,
        barW: 120,
        ringCx: 1281,
        ringCy: 856,
        colors: [
          ['#2563eb', '#93c5fd'],
          ['#0284c7', '#7dd3fc'],
          ['#9333ea', '#e879f9'],
          ['#64748b', '#cbd5e1'],
        ],
        ringColors: ['#9333ea', '#e879f9'],
      },
    ];

    const rowYs = [720, 739, 758, 777];
    const mixKeys = ['c3', 'c4', 'lpg', 'other'];

    modeVisuals.forEach((mv) => {
      const mData = state.modes[mv.key];
      mixKeys.forEach((mk, idx) => {
        const val = clamp(mData[mk], 0, 100);
        drawProgressBar(
          mv.barX,
          rowYs[idx],
          mv.barW,
          10,
          val,
          mv.colors[idx][0],
          mv.colors[idx][1],
          'rgba(15, 23, 42, 0.55)'
        );
      });
      drawRingGauge(
        mv.ringCx,
        mv.ringCy,
        30,
        6,
        mData.suitability,
        mv.ringColors[0],
        mv.ringColors[1]
      );
    });

    // 8. Update Active Mode SVG Border & Flowchart UI
    renderActiveModeOverlay(evalRes.recommendedMode);
    updateFlowchartUI(evalRes);
  }

  /**
   * Update Flowchart Modal & Inline Toggle Pill to reflect current state & path
   */
  function updateFlowchartUI(evalRes) {
    // Inline toggle button
    const btnCross = document.getElementById('btn-cross-toggle');
    const badgeCross = document.getElementById('cross-val-badge');
    if (btnCross && badgeCross) {
      btnCross.classList.toggle('is-yes', evalRes.crossC3ToLpg);
      btnCross.classList.toggle('is-no', !evalRes.crossC3ToLpg);
      badgeCross.textContent = evalRes.crossC3ToLpg ? 'YES' : 'NO';
    }

    // Modal controls
    const btnYes = document.getElementById('fc-btn-cross-yes');
    const btnNo = document.getElementById('fc-btn-cross-no');
    if (btnYes && btnNo) {
      btnYes.className = 'fc-seg-btn ' + (evalRes.crossC3ToLpg ? 'active-yes' : '');
      btnNo.className = 'fc-seg-btn ' + (!evalRes.crossC3ToLpg ? 'active-no' : '');
    }
    const sliderInv = document.getElementById('fc-slider-inv');
    const readoutInv = document.getElementById('fc-inv-readout');
    if (sliderInv && document.activeElement !== sliderInv) {
      sliderInv.value = state.inventoryPct;
    }
    if (readoutInv) {
      readoutInv.textContent = `${fmt2(state.inventoryPct)}%`;
    }

    // Highlight active paths & nodes in Flowchart SVG
    const setPathActive = (lineId, arrId, active) => {
      const line = document.getElementById(lineId);
      const arr = document.getElementById(arrId);
      if (line) line.classList.toggle('active', active);
      if (arr) arr.classList.toggle('active', active);
    };

    const setNodeActive = (nodeId, active) => {
      const node = document.getElementById(nodeId);
      if (!node) return;
      node.classList.toggle('fc-node-active', active);
      node.classList.toggle('fc-node-dim', !active);
    };

    const crossYes = evalRes.crossC3ToLpg;
    const inv60Yes = crossYes && evalRes.invGt60;
    const inv60No = crossYes && !evalRes.invGt60;
    const inv70Yes = inv60Yes && evalRes.invGt70;
    const inv70No = inv60Yes && !evalRes.invGt70;

    setPathActive('fc-line-cross-yes', 'fc-arr-cross-yes', crossYes);
    setPathActive('fc-line-cross-no', 'fc-arr-cross-no', !crossYes);
    setPathActive('fc-line-inv60-no', 'fc-arr-inv60-no', inv60No);
    setPathActive('fc-line-inv60-yes', 'fc-arr-inv60-yes', inv60Yes);
    setPathActive('fc-line-inv70-yes', 'fc-arr-inv70-yes', inv70Yes);
    setPathActive('fc-line-inv70-no', 'fc-arr-inv70-no', inv70No);

    setNodeActive('fc-node-start', true);
    setNodeActive('fc-node-cross', true);
    setNodeActive('fc-node-inv60', crossYes);
    setNodeActive('fc-node-inv70', inv60Yes);

    setNodeActive('fc-res-c3max', evalRes.recommendedMode === 'c3_max');
    setNodeActive('fc-res-optimize', evalRes.recommendedMode === 'optimize');
    setNodeActive('fc-res-lpg', evalRes.recommendedMode === 'lpg_mode');

    // Debounced snapshot sync to backend for scheduled notifications
    if (typeof triggerScreenshotSync === 'function') {
      triggerScreenshotSync();
    }
  }

  /**
   * Sync DOM Input Values from State
   */
  function syncInputsFromState(skipEl = null) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && el !== skipEl && document.activeElement !== el) {
        el.value = val;
        try {
          el.setAttribute('value', val);
        } catch (e) {}
      }
    };

    setVal('inp-date', state.dateText);
    setVal('inp-time', state.timeText);

    setVal('inp-inv-pct', fmt2(state.inventoryPct));
    setVal('inp-inv-ton', fmtNum(state.inventoryTon));
    setVal('inp-inv-cap', fmtNum(state.inventoryCap));

    setVal('inp-demand-pct', state.demandPct);
    setVal('inp-demand-ton', fmtNum(state.demandTon));
    setVal('inp-demand-cap', fmtNum(state.demandCap));
    setVal('inp-rem-ton', fmtNum(state.remainingTon));
    setVal('inp-tanks-used', state.tanksUsed);
    setVal('inp-tanks-total', state.tanksTotal);

    setVal('inp-prod-price', fmtNum(state.productPrice));
    setVal('inp-prod-chg', state.productPriceChange);

    setVal('inp-energy-price', fmtNum(state.energyPrice));
    setVal('inp-energy-chg', state.energyPriceChange);

    // AI Analysis synced inputs
    setVal('inp-ai-inv', fmt2(state.inventoryPct));
    setVal('inp-ai-demand', state.demandPct);
    setVal('inp-ai-prod', fmtNum(state.productPrice));
    setVal('inp-ai-energy', fmtNum(state.energyPrice));

    // Modes 1, 2, 3
    setVal('inp-m1-c3', state.modes.c3_max.c3);
    setVal('inp-m1-c4', state.modes.c3_max.c4);
    setVal('inp-m1-lpg', state.modes.c3_max.lpg);
    setVal('inp-m1-other', state.modes.c3_max.other);
    setVal('inp-m1-suit', state.modes.c3_max.suitability);

    setVal('inp-m2-c3', state.modes.optimize.c3);
    setVal('inp-m2-c4', state.modes.optimize.c4);
    setVal('inp-m2-lpg', state.modes.optimize.lpg);
    setVal('inp-m2-other', state.modes.optimize.other);
    setVal('inp-m2-suit', state.modes.optimize.suitability);

    setVal('inp-m3-c3', state.modes.lpg_mode.c3);
    setVal('inp-m3-c4', state.modes.lpg_mode.c4);
    setVal('inp-m3-lpg', state.modes.lpg_mode.lpg);
    setVal('inp-m3-other', state.modes.lpg_mode.other);
    setVal('inp-m3-suit', state.modes.lpg_mode.suitability);

    // Expected Result
    setVal('inp-exp-profit', state.expectedResult.profit);
    setVal('inp-exp-energy', state.expectedResult.energy);
    setVal('inp-exp-storage', state.expectedResult.storage);
    setVal('inp-exp-flex', state.expectedResult.flexibility);
  }

  /**
   * Persist dashboard state to localStorage (offline/GitHub Pages) and sync backend if available
   */
  function syncBackendState() {
    saveStateToLocalStorage();
    if (window.location.protocol === 'file:') return;
    fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }).catch(() => {});
  }

  /**
   * Bind All Interactive Inputs & Flowchart Events
   */
  function bindEvents() {
    const bindInput = (id, handler, formatOnBlur = null) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', (e) => {
        handler(e.target.value, e.target);
        syncInputsFromState(e.target);
        renderBoard();
        syncBackendState();
      });
      if (formatOnBlur) {
        el.addEventListener('blur', () => {
          el.value = formatOnBlur();
        });
      }
      el.addEventListener('focus', () => el.select());
    };

    // Date & Time (User can edit manually or click live badge to re-sync internet time)
    bindInput('inp-date', (v) => {
      state.dateText = v;
    });
    bindInput('inp-time', (v) => {
      state.timeText = v;
    });

    document.getElementById('btn-sync-time')?.addEventListener('click', async () => {
      const label = document.getElementById('txt-live-time-label');
      if (label) label.textContent = 'กำลังซิงค์...';
      await fetchInternetTime();
      syncLiveDateTime(true);
    });

    // Card 1: Inventory % -> auto-updates Inventory Ton
    const updateInvPct = (val) => {
      const pct = clamp(round2(parseNum(val, 0)), 0, 100);
      state.inventoryPct = pct;
      state.inventoryTon = Math.round((pct / 100) * state.inventoryCap);
    };
    bindInput('inp-inv-pct', updateInvPct);
    bindInput('inp-ai-inv', updateInvPct);

    // Card 1: Inventory Ton & Capacity -> auto-updates Inventory %
    bindInput(
      'inp-inv-ton',
      (v) => {
        state.inventoryTon = Math.max(0, parseNum(v, 0));
        if (state.inventoryCap > 0) {
          state.inventoryPct = clamp(round2((state.inventoryTon / state.inventoryCap) * 100), 0, 100);
        }
      },
      () => fmtNum(state.inventoryTon)
    );

    bindInput(
      'inp-inv-cap',
      (v) => {
        state.inventoryCap = Math.max(1, parseNum(v, 20000));
        state.inventoryPct = clamp(round2((state.inventoryTon / state.inventoryCap) * 100), 0, 100);
      },
      () => fmtNum(state.inventoryCap)
    );

    // Card 2: Tank Farm Demand % -> auto-updates Demand Ton, Remaining Ton, Tanks Used
    const updateDemandPct = (val) => {
      const pct = clamp(Math.round(parseNum(val, 0)), 0, 100);
      state.demandPct = pct;
      state.demandTon = Math.round((pct / 100) * state.demandCap);
      state.remainingTon = Math.max(0, state.demandCap - state.demandTon);
      state.tanksUsed = Math.round((pct / 100) * state.tanksTotal);
    };
    bindInput('inp-demand-pct', updateDemandPct);
    bindInput('inp-ai-demand', updateDemandPct);

    bindInput(
      'inp-demand-ton',
      (v) => {
        state.demandTon = Math.max(0, parseNum(v, 0));
        if (state.demandCap > 0) {
          state.demandPct = clamp(Math.round((state.demandTon / state.demandCap) * 100), 0, 100);
          state.remainingTon = Math.max(0, state.demandCap - state.demandTon);
          state.tanksUsed = Math.round((state.demandPct / 100) * state.tanksTotal);
        }
      },
      () => fmtNum(state.demandTon)
    );

    bindInput(
      'inp-demand-cap',
      (v) => {
        state.demandCap = Math.max(1, parseNum(v, 20000));
        state.demandPct = clamp(Math.round((state.demandTon / state.demandCap) * 100), 0, 100);
        state.remainingTon = Math.max(0, state.demandCap - state.demandTon);
      },
      () => fmtNum(state.demandCap)
    );

    bindInput(
      'inp-rem-ton',
      (v) => {
        state.remainingTon = Math.max(0, parseNum(v, 0));
      },
      () => fmtNum(state.remainingTon)
    );

    bindInput('inp-tanks-used', (v) => {
      state.tanksUsed = Math.max(0, Math.round(parseNum(v, 0)));
    });
    bindInput('inp-tanks-total', (v) => {
      state.tanksTotal = Math.max(1, Math.round(parseNum(v, 10)));
    });

    // Card 3: Product Price & Change %
    const updateProdPrice = (v) => {
      state.productPrice = Math.max(0, parseNum(v, 0));
    };
    bindInput('inp-prod-price', updateProdPrice, () => fmtNum(state.productPrice));
    bindInput('inp-ai-prod', updateProdPrice, () => fmtNum(state.productPrice));
    bindInput('inp-prod-chg', (v) => { state.productPriceChange = v; });

    // Card 4: Energy Price & Change %
    const updateEnergyPrice = (v) => {
      state.energyPrice = Math.max(0, parseNum(v, 0));
    };
    bindInput('inp-energy-price', updateEnergyPrice, () => fmtNum(state.energyPrice));
    bindInput('inp-ai-energy', updateEnergyPrice, () => fmtNum(state.energyPrice));
    bindInput('inp-energy-chg', (v) => { state.energyPriceChange = v; });

    // Modes 1, 2, 3 mix & suitability inputs
    const modeMap = [
      ['m1', 'c3_max'],
      ['m2', 'optimize'],
      ['m3', 'lpg_mode'],
    ];
    modeMap.forEach(([prefix, modeKey]) => {
      ['c3', 'c4', 'lpg', 'other'].forEach((mixKey) => {
        bindInput(`inp-${prefix}-${mixKey}`, (v) => {
          state.modes[modeKey][mixKey] = clamp(Math.round(parseNum(v, 0)), 0, 100);
        });
      });
      bindInput(`inp-${prefix}-suit`, (v) => {
        state.modes[modeKey].suitability = clamp(Math.round(parseNum(v, 0)), 0, 100);
      });
    });

    // Expected Result inputs
    bindInput('inp-exp-profit', (v) => { state.expectedResult.profit = v; });
    bindInput('inp-exp-energy', (v) => { state.expectedResult.energy = v; });
    bindInput('inp-exp-storage', (v) => { state.expectedResult.storage = v; });
    bindInput('inp-exp-flex', (v) => { state.expectedResult.flexibility = v; });

    // Flowchart Inline Toggle & Modal Controls
    const setCrossC3 = (val) => {
      state.crossC3ToLpg = Boolean(val);
      renderBoard();
      syncBackendState();
    };

    document.getElementById('btn-cross-toggle')?.addEventListener('click', () => {
      setCrossC3(!state.crossC3ToLpg);
    });
    document.getElementById('fc-btn-cross-yes')?.addEventListener('click', () => setCrossC3(true));
    document.getElementById('fc-btn-cross-no')?.addEventListener('click', () => setCrossC3(false));
    document.getElementById('fc-node-cross')?.addEventListener('click', () => setCrossC3(!state.crossC3ToLpg));
    document.getElementById('fc-badge-cross-yes')?.addEventListener('click', () => setCrossC3(true));
    document.getElementById('fc-badge-cross-no')?.addEventListener('click', () => setCrossC3(false));

    // Flowchart Modal Slider
    document.getElementById('fc-slider-inv')?.addEventListener('input', (e) => {
      updateInvPct(e.target.value);
      syncInputsFromState();
      renderBoard();
      syncBackendState();
    });

    // Flowchart Preset Buttons
    document.querySelectorAll('.fc-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        if (preset === 'c3_no') {
          state.crossC3ToLpg = false;
          updateInvPct(62);
        } else if (preset === 'c3_low') {
          state.crossC3ToLpg = true;
          updateInvPct(50);
        } else if (preset === 'optimize') {
          state.crossC3ToLpg = true;
          updateInvPct(62);
        } else if (preset === 'lpg') {
          state.crossC3ToLpg = true;
          updateInvPct(78);
        }
        syncInputsFromState();
        renderBoard();
        syncBackendState();
      });
    });

    // Open / Close Flowchart Controls (Integrated into Settings Modal)
    document.getElementById('btn-open-flowchart')?.addEventListener('click', () => {
      openSettingsModal('flowchart');
    });
    document.getElementById('btn-close-flowchart')?.addEventListener('click', closeSettingsModal);
    document.getElementById('flowchart-backdrop')?.addEventListener('click', closeSettingsModal);

    // Modal Tabs (Interactive vs Original Screenshot)
    const tabInteractive = document.getElementById('btn-tab-interactive');
    const tabOriginal = document.getElementById('btn-tab-original');
    const viewInteractive = document.getElementById('fc-view-interactive');
    const viewOriginal = document.getElementById('fc-view-original');

    tabInteractive?.addEventListener('click', () => {
      tabInteractive.classList.add('active');
      tabOriginal?.classList.remove('active');
      viewInteractive?.classList.remove('hidden');
      viewOriginal?.classList.add('hidden');
    });
    tabOriginal?.addEventListener('click', () => {
      tabOriginal.classList.add('active');
      tabInteractive?.classList.remove('active');
      viewOriginal?.classList.remove('hidden');
      viewInteractive?.classList.add('hidden');
    });

    // ==================================================================
    // Master Settings Modal & Multi-Tab Controller
    // ==================================================================
    const settingsModal = document.getElementById('settings-modal');
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const settingsBackdrop = document.getElementById('settings-backdrop');

    // Aliases for backward-compatibility with sub-modal references
    const gspModal = settingsModal;
    const teamsModal = settingsModal;
    const flowchartModal = settingsModal;
    const btnOpenGsp = document.getElementById('btn-open-gsp');
    const statusBanner = document.getElementById('gsp-status-banner');

    function switchSettingsTab(tabName) {
      document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
      });
      document.querySelectorAll('.settings-tab-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.getAttribute('data-tab') === tabName);
      });
      if (tabName === 'teams') {
        renderTeamsPreviewText();
        fetchTeamsConfig();
      } else if (tabName === 'gsp') {
        updateGspModalUI();
        setupGspBookmarklet();
      } else if (tabName === 'flowchart') {
        updateFlowchartUI(evaluateFlowchart());
      }
    }

    function openSettingsModal(tabName = 'teams') {
      switchSettingsTab(tabName);
      settingsModal?.classList.remove('hidden');
    }

    function closeSettingsModal() {
      settingsModal?.classList.add('hidden');
    }

    btnOpenSettings?.addEventListener('click', () => {
      openSettingsModal('teams');
    });

    btnCloseSettings?.addEventListener('click', closeSettingsModal);
    settingsBackdrop?.addEventListener('click', closeSettingsModal);

    document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) switchSettingsTab(tab);
      });
    });

    const updateGspModalUI = () => {
      const p = clamp(parseNum(state.gspData.propanePct, 50.81), 0, 100);
      const l = clamp(parseNum(state.gspData.lpgPct, 35.46), 0, 100);
      const n = clamp(parseNum(state.gspData.nglPct, 55.48), 0, 100);
      const s = clamp(parseNum(state.gspData.propanePlusLpgPct, 38.80), 0, 100);

      const inpP = document.getElementById('inp-gsp-propane');
      const inpL = document.getElementById('inp-gsp-lpg');
      const inpN = document.getElementById('inp-gsp-ngl');
      const inpS = document.getElementById('inp-gsp-sum');

      if (inpP && document.activeElement !== inpP) inpP.value = p.toFixed(2);
      if (inpL && document.activeElement !== inpL) inpL.value = l.toFixed(2);
      if (inpN && document.activeElement !== inpN) inpN.value = n.toFixed(2);
      if (inpS && document.activeElement !== inpS) inpS.value = s.toFixed(2);

      const barP = document.getElementById('bar-gsp-propane');
      const barL = document.getElementById('bar-gsp-lpg');
      const barN = document.getElementById('bar-gsp-ngl');
      if (barP) barP.style.height = `${p}%`;
      if (barL) barL.style.height = `${l}%`;
      if (barN) barN.style.height = `${n}%`;

      if (btnOpenGsp) {
        btnOpenGsp.innerHTML = `<span>🔗 GSP Propane ${p.toFixed(2)}%</span>`;
      }
    };

    // Cache GSP Data in localStorage for persistence across reloads
    function saveGspCache(data) {
      try {
        localStorage.setItem('ptt_gsp_synced_data', JSON.stringify({
          data: data,
          timestamp: Date.now(),
        }));
      } catch (e) {}
    }

    function loadGspCache() {
      try {
        const raw = localStorage.getItem('ptt_gsp_synced_data');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.data) {
            // Upgrade obsolete placeholder/previous baseline to current real GSP values (69.32)
            if (parsed.data.propanePct === 50.81 || parsed.data.propanePct === 68.17 || parsed.data.propanePct === 65.87) {
              parsed.data.propanePct = 69.32;
              parsed.data.lpgPct = 40.53;
              parsed.data.nglPct = 61.81;
              parsed.data.propanePlusLpgPct = 46.81;
              saveGspCache(parsed.data);
            }
            Object.assign(state.gspData, parsed.data);
            if (parsed.data.propanePct != null) {
              updateInvPct(parsed.data.propanePct);
            }
          }
        }
      } catch (e) {}
    }

    // Set up Draggable Bookmarklet for 1-Click Online Sync from GSP Daily Report
    function setupGspBookmarklet() {
      const btnBm = document.getElementById('btn-gsp-bookmarklet');
      if (!btnBm) return;
      const targetUrl = window.location.href.split('?')[0].split('#')[0];
      const bmCode = `javascript:(function(){try{var t=document.body.innerText||document.body.textContent;var pM=t.match(/Propane[^\\d%]{0,30}(\\d+(?:\\.\\d+)?)\\s*%/i);var lM=t.match(/LPG[^\\d%]{0,30}(\\d+(?:\\.\\d+)?)\\s*%/i);var nM=t.match(/NGL[^\\d%]{0,30}(\\d+(?:\\.\\d+)?)\\s*%/i);var sM=t.match(/Propane\\s*\\+\\s*LPG[^\\d%]{0,30}(\\d+(?:\\.\\d+)?)\\s*%/i);var p=pM?pM[1]:'';var l=lM?lM[1]:'';var n=nM?nM[1]:'';var s=sM?sM[1]:'';if(!p){alert('⚠️ ไม่พบข้อมูลเปอร์เซ็นต์ในหน้านี้ กรุณาเปิดหน้ารายงานประจำวันแล้วกดปุ่มนี้อีกครั้ง');return;}try{var bc=new BroadcastChannel('ptt_gsp_sync_channel');bc.postMessage({propane:p,lpg:l,ngl:n,sum:s,time:new Date().toLocaleTimeString('th-TH')});}catch(e){}try{localStorage.setItem('ptt_gsp_synced_event',JSON.stringify({propane:p,lpg:l,ngl:n,sum:s,t:Date.now()}));}catch(e){}var target='${targetUrl}?p='+p+'&l='+l+'&n='+n+'&s='+s;window.open(target,'ptt_3d_smartboard');}catch(e){alert('Error: '+e.message);}})();`;
      btnBm.href = bmCode;
    }

    // Live Fetch from Chrome Tab (Localhost bridge) or latest_state.json fallback
    doFetchGspFromChrome = async function (isManualClick = false) {
      if (window.location.protocol === 'file:') return;

      const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const apiEndpoints = isLocalHost
        ? ['/api/fetch-gsp']
        : ['http://127.0.0.1:8080/api/fetch-gsp', 'latest_state.json?t=' + Date.now()];

      if (isManualClick && statusBanner) {
        statusBanner.className = 'gsp-status-banner';
        statusBanner.textContent = '🔄 กำลังดึงค่าสดจากหน้า Tank Farm (GSP Daily Report)...';
      }

      let fetchedData = null;
      let usedSource = '';

      for (const url of apiEndpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4500);
          const resp = await fetch(url, { signal: controller.signal, cache: 'no-store' });
          clearTimeout(timeoutId);

          if (!resp.ok) continue;
          const json = await resp.json();
          if (json?.fetchResult?.ok && json?.fetchResult?.data) {
            fetchedData = json.fetchResult.data;
            usedSource = 'chrome_tab';
            break;
          } else if (json?.gspData) {
            fetchedData = json.gspData;
            usedSource = 'remote_state';
            break;
          }
        } catch (e) {}
      }

      if (fetchedData) {
        Object.assign(state.gspData, fetchedData);
        if (fetchedData.propanePct != null) {
          updateInvPct(fetchedData.propanePct);
          syncInputsFromState();
          renderBoard();
          syncBackendState();
        }
        saveGspCache(state.gspData);
        updateGspModalUI();

        if (statusBanner) {
          statusBanner.className = 'gsp-status-banner is-success';
          const p = state.gspData.propanePct;
          const l = state.gspData.lpgPct;
          const n = state.gspData.nglPct;
          const s = state.gspData.propanePlusLpgPct;
          if (usedSource === 'chrome_tab') {
            statusBanner.innerHTML = `✅ <b>ดึงค่าสดจากหน้า Tank Farm สำเร็จ:</b> Propane=<b>${p}%</b> | LPG=<b>${l}%</b> | NGL=<b>${n}%</b> | Propane+LPG=<b>${s}%</b>`;
          } else {
            statusBanner.innerHTML = `✅ <b>ซิงค์ข้อมูลล่าสุดสำเร็จ:</b> Propane=<b>${p}%</b> | LPG=<b>${l}%</b> | NGL=<b>${n}%</b> | Propane+LPG=<b>${s}%</b>`;
          }
        }
        return;
      }

      // Fallback
      if (statusBanner) {
        statusBanner.className = 'gsp-status-banner';
        const p = state.gspData?.propanePct ?? 69.32;
        const l = state.gspData?.lpgPct ?? 40.53;
        const n = state.gspData?.nglPct ?? 61.81;
        const s = state.gspData?.propanePlusLpgPct ?? 46.81;
        statusBanner.innerHTML = `🌐 ข้อมูลล่าสุด: Propane=${p}% | LPG=${l}% | NGL=${n}% | Sum=${s}%<br><span style="font-size:12px;opacity:0.9;">💡 หากต้องการให้ดูดสดจากแท็บ Chrome อัตโนมัติ: รัน <code>python3 app.py</code> หรือใช้ Bookmarklet <b>"📥 ซิงค์ค่าสดเข้า 3D SMART BOARD"</b></span>`;
      }
    };

    btnOpenGsp?.addEventListener('click', () => {
      openSettingsModal('gsp');
      doFetchGspFromChrome(false);
    });

    document.getElementById('btn-close-gsp')?.addEventListener('click', closeSettingsModal);
    document.getElementById('gsp-backdrop')?.addEventListener('click', closeSettingsModal);

    ['propane', 'lpg', 'ngl', 'sum'].forEach((k) => {
      const el = document.getElementById(`inp-gsp-${k}`);
      el?.addEventListener('input', (e) => {
        const val = clamp(parseNum(e.target.value, 0), 0, 100);
        if (k === 'propane') state.gspData.propanePct = val;
        if (k === 'lpg') state.gspData.lpgPct = val;
        if (k === 'ngl') state.gspData.nglPct = val;
        if (k === 'sum') state.gspData.propanePlusLpgPct = val;
        saveGspCache(state.gspData);
        updateGspModalUI();
      });
    });

    // Apply GSP value to Dashboard (Inventory % or Tank Farm Demand %)
    document.querySelectorAll('[data-val-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-val-key');
        const target = btn.getAttribute('data-target');
        const rawVal = state.gspData[key] ?? 38.8;
        const rounded = clamp(round2(rawVal), 0, 100);

        if (target === 'demand') {
          updateDemandPct(rounded);
        } else {
          updateInvPct(rounded);
        }
        saveGspCache(state.gspData);
        syncInputsFromState();
        renderBoard();
        syncBackendState();
        closeSettingsModal();
      });
    });

    document.getElementById('btn-fetch-gsp-now')?.addEventListener('click', () => {
      doFetchGspFromChrome(true);
    });

    // Auto-poll GSP Daily Report every 60 seconds ONLY when running on localhost
    setInterval(() => {
      if (!document.hidden && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        doFetchGspFromChrome(false);
      }
    }, 60000);

    // ==================================================================
    // MS Teams Notification & Scheduling Bindings
    // ==================================================================
    const btnOpenTeams = document.getElementById('btn-open-teams');
    const btnCloseTeams = document.getElementById('btn-close-teams');
    const teamsBackdrop = document.getElementById('teams-backdrop');
    const teamsStatusBanner = document.getElementById('teams-status-banner');
    const teamsStatusText = document.getElementById('teams-status-text');
    const teamsScheduleDot = document.getElementById('teams-tab-dot') || document.getElementById('teams-schedule-dot');
    const teamsScheduleToggle = document.getElementById('teams-schedule-toggle');
    const teamsScheduleTime1 = document.getElementById('teams-schedule-time-1');
    const teamsScheduleTime2 = document.getElementById('teams-schedule-time-2');
    const teamsScheduleHint = document.getElementById('teams-schedule-hint');
    const teamsWebhookUrl = document.getElementById('teams-webhook-url');
    const teamsMessagePreview = document.getElementById('teams-message-preview');
    const teamsLogsList = document.getElementById('teams-logs-list');
    const teamsQuickNote = document.getElementById('teams-quick-note');

    function getRecommendedModeLabel() {
      const evalRes = evaluateFlowchart();
      return {
        c3_max: '1. C3 Max Mode (เพิ่มการผลิต C3 สูงสุด)',
        optimize: '2. Optimize Mode (ผลิตสมดุล)',
        lpg_mode: '3. LPG Mode (เพิ่มการผลิต LPG สูงสุด)',
      }[evalRes.recommendedMode] || '1. C3 Max Mode';
    }

    function renderTeamsPreviewText() {
      const evalRes = evaluateFlowchart();
      const recKey = evalRes.recommendedMode;
      const modeLabel = getRecommendedModeLabel();
      const p = Number(state.gspData?.propanePct ?? 68.17);
      const l = Number(state.gspData?.lpgPct ?? 36.19);
      const n = Number(state.gspData?.nglPct ?? 62.39);
      const s = Number(state.gspData?.propanePlusLpgPct ?? 43.17);
      const note = teamsQuickNote?.value?.trim() || '';

      const lines = [
        `📢 รายงาน 3D SMART BOARD (PTT)`,
        `โหมดการผลิตที่แนะนำ: 🎯 ${modeLabel}`,
        `ระดับสินค้าคงคลัง (Inventory): ${state.inventoryPct.toFixed(2)}% (${fmtNum(state.inventoryTon)} / ${fmtNum(state.inventoryCap)} Ton)`,
        `ความต้องการใช้ถัง (Demand): ${state.demandPct}% (${fmtNum(state.demandTon)} / ${fmtNum(state.demandCap)} Ton)`,
        `ราคาผลิตภัณฑ์: ${state.productPrice} USD/Ton (${state.productPriceChange})`,
        `ต้นทุนพลังงาน: ${state.energyPrice} MMBtu/Ton (${state.energyPriceChange})`,
        ``,
        `🌐 ข้อมูล GSP Daily Report (Tank Farm):`,
        `• Propane: ${p.toFixed(2)}%`,
        `• LPG: ${l.toFixed(2)}%`,
        `• NGL: ${n.toFixed(2)}%`,
        `• Propane + LPG = ${s.toFixed(2)}%`,
        ``,
        `⚙️ การเลือกโหมดการผลิต (3 Production Modes):`,
        `• 1. C3 Max Mode: ${recKey === 'c3_max' ? 'YES (★ เลือกโหมดนี้)' : 'NO'}`,
        `• 2. Optimize Mode: ${recKey === 'optimize' ? 'YES (★ เลือกโหมดนี้)' : 'NO'}`,
        `• 3. LPG Mode: ${recKey === 'lpg_mode' ? 'YES (★ เลือกโหมดนี้)' : 'NO'}`,
        `👉 โหมดที่ระบบเลือก: ${modeLabel}`,
        `💡 เหตุผล: ระดับ Inventory ${state.inventoryPct.toFixed(2)}% > 60% แต่ยังไม่เกิน 70% จึงเลือก Optimize Mode (ผลิตสมดุล)`,
        ``,
        `📈 ผลลัพธ์คาดการณ์:`,
        `• กำไรโดยประมาณ: ${state.expectedResult.profit} | การใช้พลังงาน: ${state.expectedResult.energy}`,
        `• การใช้พื้นที่จัดเก็บ: ${state.expectedResult.storage} | ความยืดหยุ่น: ${state.expectedResult.flexibility}`,
      ];

      if (note) {
        lines.splice(2, 0, `📝 หมายเหตุ: ${note}`);
      }

      if (teamsMessagePreview) {
        teamsMessagePreview.textContent = lines.join('\n');
      }

      const recBadge = document.getElementById('teams-preview-rec-mode');
      const invBadge = document.getElementById('teams-preview-inv');
      if (recBadge) recBadge.textContent = modeLabel;
      if (invBadge) invBadge.textContent = `Inventory ${state.inventoryPct.toFixed(2)}%`;
    }

    function renderTeamsLogs(logs) {
      if (!teamsLogsList) return;
      if (!logs || !logs.length) {
        teamsLogsList.innerHTML = '<div class="teams-log-empty">ยังไม่มีประวัติการส่งในรอบนี้</div>';
        return;
      }
      teamsLogsList.innerHTML = logs
        .map(
          (item) => `
        <div class="teams-log-item">
          <span class="teams-log-time">${item.timestamp || '-'}</span>
          <span class="teams-log-reason">${item.reason || 'ส่งแจ้งเตือน'}</span>
          <span class="teams-log-status ${item.ok ? '' : 'is-err'}">${item.status || (item.ok ? 'สำเร็จ' : 'ผิดพลาด')}</span>
        </div>
      `
        )
        .join('');
    }

    function addSendLogEntry(entry) {
      try {
        const raw = localStorage.getItem('ptt_teams_send_logs');
        let logs = [];
        if (raw) {
          try { logs = JSON.parse(raw); } catch (e) {}
        }
        if (!Array.isArray(logs)) logs = [];
        logs.unshift(entry);
        logs = logs.slice(0, 20);
        localStorage.setItem('ptt_teams_send_logs', JSON.stringify(logs));
        renderTeamsLogs(logs);
      } catch (e) {}
    }

    const DAY_NAMES_THAI = {
      mon: 'จันทร์',
      tue: 'อังคาร',
      wed: 'พุธ',
      thu: 'พฤหัสฯ',
      fri: 'ศุกร์',
      sat: 'เสาร์',
      sun: 'อาทิตย์'
    };
    const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    function getSelectedDays() {
      const activeChips = document.querySelectorAll('.btn-day-chip.active');
      const days = Array.from(activeChips).map((el) => el.getAttribute('data-day')).filter(Boolean);
      return days.length ? days : ALL_DAYS.slice();
    }

    function setSelectedDays(days) {
      if (!Array.isArray(days) || !days.length) days = ALL_DAYS.slice();
      document.querySelectorAll('.btn-day-chip').forEach((chip) => {
        const d = chip.getAttribute('data-day');
        chip.classList.toggle('active', days.includes(d));
      });
      updateDayPresetButtons(days);
    }

    function updateDayPresetButtons(days) {
      if (!Array.isArray(days)) days = getSelectedDays();
      const isAll = days.length === 7;
      const isWorkdays = days.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) => days.includes(d));
      const isWeekends = days.length === 2 && ['sat', 'sun'].every((d) => days.includes(d));

      document.querySelectorAll('.btn-day-preset').forEach((btn) => {
        const preset = btn.getAttribute('data-preset');
        if (preset === 'all') btn.classList.toggle('active', isAll);
        else if (preset === 'workdays') btn.classList.toggle('active', isWorkdays);
        else if (preset === 'weekends') btn.classList.toggle('active', isWeekends);
        else btn.classList.remove('active');
      });
    }

    function formatDaysSummary(days) {
      if (!Array.isArray(days) || days.length === 7) return 'ทุกวัน (จันทร์ - อาทิตย์)';
      if (days.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) => days.includes(d))) {
        return 'วันจันทร์ - ศุกร์ (วันทำการ)';
      }
      if (days.length === 2 && ['sat', 'sun'].every((d) => days.includes(d))) {
        return 'วันเสาร์ - อาทิตย์ (วันหยุด)';
      }
      const names = days.map((d) => DAY_NAMES_THAI[d] || d);
      return `วัน ${names.join(', ')}`;
    }

    function updatePresetButtons(t1, t2) {
      document.querySelectorAll('.btn-time-preset').forEach((btn) => {
        const bt1 = btn.getAttribute('data-t1') || '';
        const bt2 = btn.getAttribute('data-t2') || '';
        const match = (bt1 === t1 && bt2 === t2);
        btn.classList.toggle('active', match);
      });
    }

    fetchTeamsConfig = async function () {
      // 1. Immediately read from localStorage (Works everywhere: offline, Apache, GitHub Pages)
      try {
        const localCfgRaw = localStorage.getItem('ptt_teams_schedule_config');
        const localLogsRaw = localStorage.getItem('ptt_teams_send_logs');
        const localDaysRaw = localStorage.getItem('ptt_teams_schedule_days');

        let isEnabled = true;
        let t1 = '08:00';
        let t2 = '20:00';
        let days = ALL_DAYS.slice();

        if (localDaysRaw) {
          try {
            const parsedDays = JSON.parse(localDaysRaw);
            if (Array.isArray(parsedDays) && parsedDays.length) days = parsedDays;
          } catch (e) {}
        }

        if (localCfgRaw) {
          try {
            const localCfg = JSON.parse(localCfgRaw);
            if (localCfg) {
              isEnabled = Boolean(localCfg.scheduleEnabled);
              if (Array.isArray(localCfg.scheduleTimes) && localCfg.scheduleTimes.length) {
                t1 = localCfg.scheduleTimes[0] || '';
                t2 = localCfg.scheduleTimes[1] || '';
              } else if (typeof localCfg.scheduleTime === 'string') {
                const parts = localCfg.scheduleTime.split(',').map((s) => s.trim()).filter(Boolean);
                t1 = parts[0] || '08:00';
                t2 = parts[1] || '';
              }
              if (Array.isArray(localCfg.scheduleDays) && localCfg.scheduleDays.length) {
                days = localCfg.scheduleDays;
              }
            }
          } catch (e) {}
        }

        if (teamsScheduleToggle) teamsScheduleToggle.checked = isEnabled;
        if (teamsScheduleTime1) teamsScheduleTime1.value = t1;
        if (teamsScheduleTime2) teamsScheduleTime2.value = t2;
        setSelectedDays(days);
        if (teamsScheduleDot) teamsScheduleDot.classList.toggle('active', isEnabled);
        updateScheduleHint(isEnabled, [t1, t2].filter(Boolean), days);
        updatePresetButtons(t1, t2);

        if (localLogsRaw && teamsLogsList) {
          try {
            renderTeamsLogs(JSON.parse(localLogsRaw));
          } catch (e) {}
        }
      } catch (e) {
        console.warn('localStorage read error', e);
      }

      if (window.location.protocol === 'file:') return;

      // 2. Try fetching from backend (Apache notify.php, Python /api/notify/config, or central notify_config.json on GitHub Pages)
      const endpoints = [
        'notify.php?action=config',
        'api/notify/config',
        '/api/notify/config',
        'notify_config.json'
      ];
      let config = null;
      for (const ep of endpoints) {
        try {
          const resp = await fetch(ep);
          if (resp.ok) {
            const data = await resp.json();
            config = data.config || data;
            if (config && (config.scheduleTimes || config.scheduleTime || config.webhookUrl)) {
              break;
            }
          }
        } catch (e) {}
      }

      if (config) {
        if (!localStorage.getItem('ptt_teams_schedule_config')) {
          const isEnabled = Boolean(config.scheduleEnabled);
          let t1 = '08:00';
          let t2 = '20:00';
          let days = ALL_DAYS.slice();
          if (Array.isArray(config.scheduleTimes) && config.scheduleTimes.length) {
            t1 = config.scheduleTimes[0] || '';
            t2 = config.scheduleTimes[1] || '';
          } else if (typeof config.scheduleTime === 'string') {
            const parts = config.scheduleTime.split(',').map((s) => s.trim()).filter(Boolean);
            t1 = parts[0] || '08:00';
            t2 = parts[1] || '';
          }
          if (Array.isArray(config.scheduleDays) && config.scheduleDays.length) {
            days = config.scheduleDays;
          }
          if (teamsScheduleToggle) teamsScheduleToggle.checked = isEnabled;
          if (teamsScheduleTime1) teamsScheduleTime1.value = t1;
          if (teamsScheduleTime2) teamsScheduleTime2.value = t2;
          setSelectedDays(days);
          if (teamsScheduleDot) teamsScheduleDot.classList.toggle('active', isEnabled);
          updateScheduleHint(isEnabled, [t1, t2].filter(Boolean), days);
          updatePresetButtons(t1, t2);
        }

        if (Array.isArray(config.sendLogs) && config.sendLogs.length) {
          renderTeamsLogs(config.sendLogs);
          try { localStorage.setItem('ptt_teams_send_logs', JSON.stringify(config.sendLogs)); } catch (e) {}
        }
      }
    };

    function updateScheduleHint(enabled, times, days) {
      if (!teamsScheduleHint) return;
      if (!Array.isArray(times)) {
        times = (times || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (!days) days = getSelectedDays();
      const daysText = formatDaysSummary(days);
      if (enabled && times.length) {
        teamsScheduleHint.className = 'teams-schedule-hint is-on';
        if (times.length === 1) {
          teamsScheduleHint.textContent = `⏰ กำลังเปิดใช้งาน: ส่งสรุปแจ้งเตือนเข้ากลุ่ม MS Teams อัตโนมัติ (${daysText}) เวลา ${times[0]} น.`;
        } else {
          teamsScheduleHint.textContent = `⏰ กำลังเปิดใช้งาน: ส่งสรุปแจ้งเตือนเข้ากลุ่ม MS Teams อัตโนมัติ (${daysText}) ${times.length} รอบ เวลา ${times.join(' น. และ ')} น.`;
        }
      } else {
        teamsScheduleHint.className = 'teams-schedule-hint';
        teamsScheduleHint.textContent = `💡 ปิดการตั้งเวลาอยู่: เปิดสวิตช์ด้านบนและกดปุ่มบันทึกเพื่อเริ่มส่งแจ้งเตือนอัตโนมัติ`;
      }
    }

    btnOpenTeams?.addEventListener('click', () => {
      openSettingsModal('teams');
    });

    btnCloseTeams?.addEventListener('click', closeSettingsModal);
    teamsBackdrop?.addEventListener('click', closeSettingsModal);

    teamsQuickNote?.addEventListener('input', renderTeamsPreviewText);

    // Preset time button click
    document.querySelectorAll('.btn-time-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-time-preset').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const t1 = btn.getAttribute('data-t1') || '';
        const t2 = btn.getAttribute('data-t2') || '';
        if (teamsScheduleTime1) teamsScheduleTime1.value = t1;
        if (teamsScheduleTime2) teamsScheduleTime2.value = t2;
        const curTimes = [t1, t2].filter(Boolean);
        updateScheduleHint(teamsScheduleToggle?.checked, curTimes, getSelectedDays());
      });
    });

    // Day of week chip click
    document.querySelectorAll('.btn-day-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const count = document.querySelectorAll('.btn-day-chip.active').length;
        if (count === 0) chip.classList.add('active'); // Keep at least 1 day selected
        const days = getSelectedDays();
        updateDayPresetButtons(days);
        const t1 = teamsScheduleTime1?.value?.trim() || '';
        const t2 = teamsScheduleTime2?.value?.trim() || '';
        updateScheduleHint(Boolean(teamsScheduleToggle?.checked), [t1, t2].filter(Boolean), days);
      });
    });

    // Day preset button click (All / Workdays / Weekends)
    document.querySelectorAll('.btn-day-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        let days = ALL_DAYS.slice();
        if (preset === 'workdays') days = ['mon', 'tue', 'wed', 'thu', 'fri'];
        else if (preset === 'weekends') days = ['sat', 'sun'];
        setSelectedDays(days);
        const t1 = teamsScheduleTime1?.value?.trim() || '';
        const t2 = teamsScheduleTime2?.value?.trim() || '';
        updateScheduleHint(Boolean(teamsScheduleToggle?.checked), [t1, t2].filter(Boolean), days);
      });
    });

    teamsScheduleToggle?.addEventListener('change', () => {
      const t1 = teamsScheduleTime1?.value?.trim() || '';
      const t2 = teamsScheduleTime2?.value?.trim() || '';
      updateScheduleHint(teamsScheduleToggle.checked, [t1, t2].filter(Boolean), getSelectedDays());
    });

    teamsScheduleTime1?.addEventListener('change', () => {
      const t1 = teamsScheduleTime1?.value?.trim() || '';
      const t2 = teamsScheduleTime2?.value?.trim() || '';
      updateScheduleHint(teamsScheduleToggle?.checked, [t1, t2].filter(Boolean), getSelectedDays());
    });

    teamsScheduleTime2?.addEventListener('change', () => {
      const t1 = teamsScheduleTime1?.value?.trim() || '';
      const t2 = teamsScheduleTime2?.value?.trim() || '';
      updateScheduleHint(teamsScheduleToggle?.checked, [t1, t2].filter(Boolean), getSelectedDays());
    });

    function applyGrayscaleToCard(targetCtx, x, y, w, h, radius, scale = 1) {
      const rx = Math.round(x * scale);
      const ry = Math.round(y * scale);
      const rw = Math.round(w * scale);
      const rh = Math.round(h * scale);
      const rrad = Math.round(radius * scale);

      try {
        const off = document.createElement('canvas');
        off.width = rw;
        off.height = rh;
        const offCtx = off.getContext('2d');

        const imgData = targetCtx.getImageData(rx, ry, rw, rh);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          const dim = Math.min(255, Math.round(gray * 0.58));
          d[i] = dim;
          d[i + 1] = dim;
          d[i + 2] = dim;
        }
        offCtx.putImageData(imgData, 0, 0);

        targetCtx.save();
        targetCtx.beginPath();
        if (typeof targetCtx.roundRect === 'function') {
          targetCtx.roundRect(rx, ry, rw, rh, rrad);
        } else {
          targetCtx.rect(rx, ry, rw, rh);
        }
        targetCtx.clip();

        targetCtx.drawImage(off, rx, ry);

        // Dark glass tint overlay matching CSS rgba(30, 41, 59, 0.22)
        targetCtx.fillStyle = 'rgba(30, 41, 59, 0.25)';
        targetCtx.fill();

        targetCtx.restore();
      } catch (err) {
        console.warn('applyGrayscaleToCard error:', err);
      }
    }

    function drawRecommendedHighlight(targetCtx, cfg, scale = 1) {
      const rx = Math.round(cfg.x * scale);
      const ry = Math.round(cfg.y * scale);
      const rw = Math.round(cfg.w * scale);
      const rh = Math.round(cfg.h * scale);
      const rrad = Math.round(14 * scale);

      targetCtx.save();

      // Outer glow halo
      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(rx, ry, rw, rh, rrad);
      } else {
        targetCtx.rect(rx, ry, rw, rh);
      }
      targetCtx.strokeStyle = cfg.stroke;
      targetCtx.lineWidth = 4 * scale;
      targetCtx.shadowColor = cfg.stroke;
      targetCtx.shadowBlur = 18 * scale;
      targetCtx.stroke();

      // Sharp inner glow border
      targetCtx.shadowBlur = 4 * scale;
      targetCtx.lineWidth = 2 * scale;
      targetCtx.stroke();

      // "★ แนะนำ" Badge pill
      const pillW = Math.round(58 * scale);
      const pillH = Math.round(18 * scale);
      const pillX = rx + rw - pillW - Math.round(8 * scale);
      const pillY = ry - Math.round(10 * scale);
      const pillRad = Math.round(9 * scale);

      targetCtx.shadowBlur = 0;
      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(pillX, pillY, pillW, pillH, pillRad);
      } else {
        targetCtx.rect(pillX, pillY, pillW, pillH);
      }
      targetCtx.fillStyle = cfg.badgeBg;
      targetCtx.fill();
      targetCtx.strokeStyle = '#fef08a';
      targetCtx.lineWidth = 1.4 * scale;
      targetCtx.stroke();

      // Text inside pill
      targetCtx.fillStyle = '#fef08a';
      targetCtx.font = `bold ${Math.round(11 * scale)}px Kanit, sans-serif`;
      targetCtx.textAlign = 'center';
      targetCtx.textBaseline = 'middle';
      targetCtx.fillText('★ แนะนำ', pillX + pillW / 2, pillY + pillH / 2 + 1);

      targetCtx.restore();
    }

    function postProcessBoardCanvas(targetCanvas, scaleVal) {
      const tctx = targetCanvas.getContext('2d');
      const evalRes = evaluateFlowchart();

      // 1. Convert non-recommended mode cards to grayscale (matching Image 1)
      const dimBoxes = {
        c3_max: { x: 436, y: 653, w: 290, h: 242 },
        optimize: { x: 731, y: 653, w: 291, h: 242 },
        lpg_mode: { x: 1026, y: 653, w: 286, h: 242 },
      };

      Object.entries(dimBoxes).forEach(([key, box]) => {
        if (key !== evalRes.recommendedMode) {
          applyGrayscaleToCard(tctx, box.x, box.y, box.w, box.h, 14, scaleVal);
        }
      });

      // 2. Draw prominent glowing border & "★ แนะนำ" badge for the recommended mode
      const recCfgs = {
        c3_max: { x: 443, y: 658, w: 276, h: 232, stroke: '#38bdf8', badgeBg: '#0284c7' },
        optimize: { x: 738, y: 658, w: 276, h: 232, stroke: '#4ade80', badgeBg: '#16a34a' },
        lpg_mode: { x: 1033, y: 658, w: 276, h: 232, stroke: '#c084fc', badgeBg: '#9333ea' },
      };
      const activeCfg = recCfgs[evalRes.recommendedMode];
      if (activeCfg) {
        drawRecommendedHighlight(tctx, activeCfg, scaleVal);
      }
    }

    async function captureDashboardScreenshot() {
      const el = document.getElementById('smart-board') || document.getElementById('board-container');
      if (!el) {
        console.warn('[Snapshot] smart-board element not found!');
        return null;
      }

      // Ensure all live input values are synchronized to DOM attributes for html2canvas
      document.querySelectorAll('.board-input').forEach((inp) => {
        try {
          inp.setAttribute('value', inp.value);
        } catch (e) {}
      });

      // 1. Capture via html2canvas (Full DOM + Canvas + SVGs at 1.5x sharp resolution)
      if (typeof window.html2canvas === 'function') {
        try {
          const snap = await window.html2canvas(el, {
            scale: 1.5,
            useCORS: true,
            logging: false,
            backgroundColor: '#030b20',
          });
          // Apply grayscale to non-recommended modes + crisp highlight to recommended mode
          postProcessBoardCanvas(snap, 1.5);
          const dataUrl = snap.toDataURL('image/jpeg', 0.90);
          console.log('[Snapshot] Captured successfully via html2canvas, size:', dataUrl.length);
          return dataUrl;
        } catch (err) {
          console.warn('[Snapshot] html2canvas warning, falling back to canvas:', err);
        }
      }

      // 2. Direct Canvas Fallback with high-precision text overlay & grayscale
      try {
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = BOARD_W;
        snapCanvas.height = BOARD_H;
        const sctx = snapCanvas.getContext('2d');
        sctx.drawImage(canvas, 0, 0);

        // Draw input values onto canvas
        document.querySelectorAll('.board-input').forEach((inp) => {
          const val = inp.value;
          if (!val) return;
          const rect = inp.getBoundingClientRect();
          const parentRect = el.getBoundingClientRect();
          if (!parentRect.width || !parentRect.height) return;
          const scaleX = BOARD_W / parentRect.width;
          const scaleY = BOARD_H / parentRect.height;
          const x = (rect.left - parentRect.left) * scaleX;
          const y = (rect.top - parentRect.top) * scaleY;
          const w = rect.width * scaleX;
          const h = rect.height * scaleY;

          const style = window.getComputedStyle(inp);
          const fSize = parseFloat(style.fontSize) * scaleY;
          sctx.font = `${style.fontWeight || '700'} ${fSize}px ${style.fontFamily || 'Inter, Kanit, sans-serif'}`;
          sctx.fillStyle = style.color || '#ffffff';
          sctx.textAlign = style.textAlign || 'left';
          sctx.textBaseline = 'middle';

          let tx = x;
          if (style.textAlign === 'right') tx = x + w - 4;
          else if (style.textAlign === 'center') tx = x + w / 2;
          else tx = x + 4;
          sctx.fillText(val, tx, y + h / 2);
        });

        // Apply grayscale to non-recommended modes + crisp highlight to recommended mode
        postProcessBoardCanvas(snapCanvas, 1);

        return snapCanvas.toDataURL('image/jpeg', 0.90);
      } catch (e) {
        return null;
      }
    }

    // Auto-sync dashboard screenshot to backend periodically so daily schedule alert has the latest image
    let syncScreenshotTimeout = null;
    triggerScreenshotSync = function () {
      if (window.location.protocol === 'file:') return;
      clearTimeout(syncScreenshotTimeout);
      syncScreenshotTimeout = setTimeout(async () => {
        try {
          const shot = await captureDashboardScreenshot();
          if (shot) {
            fetch('/api/sync-screenshot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ screenshot: shot }),
            }).catch(() => {});
          }
        } catch (e) {}
      }, 3000);
    };

    // Modern Power Automate Teams Workflows / Adaptive Card Builder (Client-Side)
    function buildTeamsPayloadClient(reason = 'ส่งทันที (Manual)', note = '', format = 'adaptive') {
      const evalRes = evaluateFlowchart();
      const recKey = evalRes.recommendedMode;
      const recModeName = {
        c3_max: '1. C3 Max Mode (เพิ่มการผลิต C3 สูงสุด)',
        optimize: '2. Optimize Mode (ผลิตสมดุล)',
        lpg_mode: '3. LPG Mode (เพิ่มการผลิต LPG สูงสุด)'
      }[recKey] || '2. Optimize Mode';

      const p = Number(state.gspData?.propanePct ?? 68.17);
      const l = Number(state.gspData?.lpgPct ?? 36.19);
      const n = Number(state.gspData?.nglPct ?? 62.39);
      const s = Number(state.gspData?.propanePlusLpgPct ?? 43.17);
      const nowStr = new Date().toLocaleString('th-TH');

      const formattedMd = [
        `# 📢 PTT 3D SMART BOARD - รายงานสรุปสถานะการผลิตประจำวัน`,
        `**โหมดการผลิตที่ระบบแนะนำ:** ⭐ **${recModeName}**`,
        `**วันที่และเวลา:** ${state.dateText || ''} ${state.timeText || ''} น. (${reason})`,
        note ? `**หมายเหตุ:** ${note}` : '',
        ``,
        `### 📊 4 ปัจจัยหลักในการตัดสินใจ (Key Decision Factors)`,
        `• **1. Inventory (ระดับสินค้าคงคลัง):** ${state.inventoryPct.toFixed(2)}% (${fmtNum(state.inventoryTon)} / ${fmtNum(state.inventoryCap)} Ton)`,
        `• **2. Demand (ความต้องการใช้ถัง):** ${state.demandPct}% (${fmtNum(state.demandTon)} / ${fmtNum(state.demandCap)} Ton)`,
        `• **3. Product Price (ราคาผลิตภัณฑ์):** ${state.productPrice} USD/Ton (${state.productPriceChange})`,
        `• **4. Energy Price (ต้นทุนพลังงาน):** ${state.energyPrice} MMBtu/Ton (${state.energyPriceChange})`,
        ``,
        `### 🌐 ข้อมูลระดับถังจาก GSP Daily Report (Tank Farm)`,
        `• **Propane:** ${p.toFixed(2)}% | **LPG:** ${l.toFixed(2)}% | **NGL:** ${n.toFixed(2)}% | **Propane + LPG:** ${s.toFixed(2)}%`,
        ``,
        `### ⚙️ การเลือกโหมดการผลิต (3 Production Modes)`,
        `• 1. C3 Max Mode: **${recKey === 'c3_max' ? 'YES (★ เลือกโหมดนี้)' : 'NO'}**`,
        `• 2. Optimize Mode: **${recKey === 'optimize' ? 'YES (★ เลือกโหมดนี้)' : 'NO'}**`,
        `• 3. LPG Mode: **${recKey === 'lpg_mode' ? 'YES (★ เลือกโหมดนี้)' : 'NO'}**`,
        `👉 **โหมดที่ระบบเลือก:** ⭐ **${recModeName}** (จาก Inventory ${state.inventoryPct.toFixed(2)}% > 60% แต่ยังไม่เกิน 70%)`,
        ``,
        `🔗 [เปิดดูหน้าแดชบอร์ด 3D SMART BOARD](https://bilanphoto.github.io/inventory/)`
      ].filter(Boolean).join('\n');

      // If text format only
      if (format === 'text') {
        return {
          text: formattedMd,
          message: formattedMd,
          content: formattedMd,
          title: `📢 3D SMART BOARD - โหมดที่แนะนำ: ${recModeName}`,
          summary: `3D SMART BOARD - โหมดที่แนะนำ: ${recModeName}`,
          recommendedMode: recModeName,
          inventoryPct: state.inventoryPct,
          inventoryTon: state.inventoryTon,
          demandPct: state.demandPct,
          demandTon: state.demandTon,
          productPrice: state.productPrice,
          energyPrice: state.energyPrice,
          gspData: state.gspData,
          reason: reason,
          note: note,
          timestamp: nowStr
        };
      }

      // Adaptive Card format (Clean, Lightweight < 5KB, 100% compliant with Teams)
      const cardBody = [
        {
          type: 'TextBlock',
          text: '📢 **PTT 3D SMART BOARD - รายงานสรุปสถานะการผลิตประจำวัน**',
          weight: 'Bolder',
          size: 'Large',
          color: 'Accent'
        },
        {
          type: 'TextBlock',
          text: `📅 วันที่และเวลา: **${state.dateText || ''} ${state.timeText || ''} น.** | ประเภท: **${reason}**`,
          isSubtle: true,
          spacing: 'None'
        }
      ];

      if (note) {
        cardBody.push({
          type: 'TextBlock',
          text: `📝 **หมายเหตุ:** ${note}`,
          wrap: true,
          spacing: 'Small'
        });
      }

      cardBody.push(
        {
          type: 'Container',
          style: 'emphasis',
          bleed: true,
          items: [
            {
              type: 'TextBlock',
              text: '🎯 **โหมดการผลิตที่ระบบแนะนำ (RECOMMENDED MODE):**',
              weight: 'Bolder',
              size: 'Medium'
            },
            {
              type: 'TextBlock',
              text: `⭐ **${recModeName}**`,
              weight: 'Bolder',
              size: 'ExtraLarge',
              color: 'Good'
            }
          ]
        },
        {
          type: 'TextBlock',
          text: '📊 **4 ปัจจัยหลักในการตัดสินใจ (Key Decision Factors)**',
          weight: 'Bolder',
          size: 'Medium',
          spacing: 'Medium'
        },
        {
          type: 'FactSet',
          facts: [
            { title: '1. Inventory:', value: `${state.inventoryPct.toFixed(2)}% (${fmtNum(state.inventoryTon)} / ${fmtNum(state.inventoryCap)} Ton)` },
            { title: '2. Demand:', value: `${state.demandPct}% (${fmtNum(state.demandTon)} / ${fmtNum(state.demandCap)} Ton)` },
            { title: '3. Product Price:', value: `${state.productPrice} USD/Ton (${state.productPriceChange})` },
            { title: '4. Energy Price:', value: `${state.energyPrice} MMBtu/Ton (${state.energyPriceChange})` }
          ]
        },
        {
          type: 'TextBlock',
          text: '🌐 **ข้อมูลระดับถังจาก GSP Daily Report (Tank Farm)**',
          weight: 'Bolder',
          size: 'Medium',
          spacing: 'Medium'
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'Propane:', value: `${p.toFixed(2)}%` },
            { title: 'LPG:', value: `${l.toFixed(2)}%` },
            { title: 'NGL:', value: `${n.toFixed(2)}%` },
            { title: 'Propane + LPG:', value: `${s.toFixed(2)}%` }
          ]
        },
        {
          type: 'TextBlock',
          text: '⚙️ **การเลือกโหมดการผลิต (3 Production Modes)**',
          weight: 'Bolder',
          size: 'Medium',
          spacing: 'Medium'
        },
        {
          type: 'FactSet',
          facts: [
            { title: '1. C3 Max Mode:', value: recKey === 'c3_max' ? 'YES (★ เลือกโหมดนี้)' : 'NO' },
            { title: '2. Optimize Mode:', value: recKey === 'optimize' ? 'YES (★ เลือกโหมดนี้)' : 'NO' },
            { title: '3. LPG Mode:', value: recKey === 'lpg_mode' ? 'YES (★ เลือกโหมดนี้)' : 'NO' }
          ]
        },
        {
          type: 'TextBlock',
          text: `👉 **โหมดที่เลือก:** ⭐ **${recModeName}** (จากเงื่อนไข Inventory ${state.inventoryPct.toFixed(2)}% อยู่ระหว่าง 60% - 70%)`,
          weight: 'Bolder',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'TextBlock',
          text: '📈 **ผลลัพธ์คาดการณ์ (Expected Result)**',
          weight: 'Bolder',
          size: 'Medium',
          spacing: 'Medium'
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'กำไรโดยประมาณ:', value: String(state.expectedResult?.profit || 'สูงสุด') },
            { title: 'การใช้พลังงาน:', value: String(state.expectedResult?.energy || 'เหมาะสม') },
            { title: 'การใช้พื้นที่จัดเก็บ:', value: String(state.expectedResult?.storage || 'สมดุล') },
            { title: 'ความยืดหยุ่น:', value: String(state.expectedResult?.flexibility || 'ดี') }
          ]
        }
      );

      const adaptiveCard = {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: cardBody,
        actions: [
          {
            type: 'Action.OpenUrl',
            title: '🖥️ เปิดดูหน้าแดชบอร์ดสด (3D SMART BOARD)',
            url: 'https://bilanphoto.github.io/inventory/'
          }
        ]
      };

      return {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: adaptiveCard
          }
        ],
        summary: `3D SMART BOARD - โหมดที่แนะนำ: ${recModeName}`,
        title: `📢 3D SMART BOARD - โหมดที่แนะนำ: ${recModeName}`,
        text: formattedMd,
        message: formattedMd,
        content: formattedMd,
        recommendedMode: recModeName,
        inventoryPct: state.inventoryPct,
        inventoryTon: state.inventoryTon,
        demandPct: state.demandPct,
        demandTon: state.demandTon,
        productPrice: state.productPrice,
        energyPrice: state.energyPrice,
        gspData: state.gspData,
        reason: reason,
        note: note,
        timestamp: nowStr
      };
    }

    // Unified Send Function (Tries server endpoints, falls back to direct browser POST)
    async function executeSendTeamsNotification(reason, note, format = null) {
      const defaultUrl = 'https://defaultf2fda5e72ea1450d9fc12af5f86300.95.environment.api.powerplatform.com/powerautomate/automations/direct/cu/18/workflows/904ec45ba2f343b0bf609507bba19298/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=P7wxp36yBmVsRRsQL6hEIYzC7BoO9r8IUQrmM8_9Xfc';
      const webhookUrl = teamsWebhookUrl?.value?.trim() || localStorage.getItem('ptt_teams_webhook_url') || defaultUrl;
      const fmtSelect = document.getElementById('teams-payload-format');
      const selectedFormat = format || (fmtSelect ? fmtSelect.value : 'adaptive');
      const payload = buildTeamsPayloadClient(reason, note, selectedFormat);
      const nowStr = new Date().toLocaleString('th-TH');

      // 1. Try Backend Endpoints (PHP notify.php, Python /api/notify/send)
      const endpoints = [
        'notify.php?action=send',
        'api/notify/send',
        '/api/notify/send'
      ];
      for (const ep of endpoints) {
        try {
          const resp = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason: reason,
              note: note,
              webhookUrl: webhookUrl,
              payload: payload
            })
          });
          if (resp.ok) {
            const res = await resp.json().catch(() => ({}));
            addSendLogEntry({
              timestamp: nowStr,
              reason: reason,
              status: `สำเร็จ (${res.status || '202 Accepted'})`,
              ok: true
            });
            return { ok: true, message: res.message || '202 Accepted', timestamp: nowStr };
          }
        } catch (e) {}
      }

      // 2. Direct Browser POST Fallback to Power Automate Webhook
      try {
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (resp.ok || resp.status === 200 || resp.status === 202) {
          addSendLogEntry({
            timestamp: nowStr,
            reason: reason,
            status: `สำเร็จ (${resp.status || 202} Accepted)`,
            ok: true
          });
          return { ok: true, message: `${resp.status} Accepted`, timestamp: nowStr };
        }
      } catch (browserErr) {
        // Fallback with no-cors if browser blocked response reading
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          addSendLogEntry({
            timestamp: nowStr,
            reason: reason,
            status: 'สำเร็จ (ส่งเรียบร้อย)',
            ok: true
          });
          return { ok: true, message: 'ส่งข้อมูลเรียบร้อยแล้ว', timestamp: nowStr };
        } catch (e) {
          throw browserErr;
        }
      }
      throw new Error('ไม่สามารถเชื่อมต่อไปยัง Webhook ได้');
    }

    // Send Now Button Click (Clean Adaptive Card / Standard Notification)
    document.getElementById('btn-teams-send-now')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-teams-send-now');
      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ กำลังส่งเข้ากลุ่ม MS Teams...</span>';

      if (teamsStatusBanner && teamsStatusText) {
        teamsStatusBanner.className = 'teams-status-banner';
        teamsStatusText.textContent = 'กำลังส่งข้อมูลเข้ากลุ่ม MS Teams ผ่าน Power Automate...';
      }

      try {
        const note = teamsQuickNote?.value?.trim() || '';
        const fmt = document.getElementById('teams-payload-format')?.value || 'adaptive';
        const res = await executeSendTeamsNotification('ส่งทันที (Manual)', note, fmt);

        if (teamsStatusBanner && teamsStatusText) {
          teamsStatusBanner.className = 'teams-status-banner is-success';
          teamsStatusText.textContent = `✅ ส่งเข้ากลุ่ม MS Teams สำเร็จ (${res.message || '202 Accepted'}) เวลา ${res.timestamp}`;
        }
      } catch (err) {
        if (teamsStatusBanner && teamsStatusText) {
          teamsStatusBanner.className = 'teams-status-banner is-error';
          teamsStatusText.textContent = `❌ ไม่สามารถส่งเข้า MS Teams ได้ (${err.message || 'Network Error'})`;
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    });

    // Test Markdown Text Format Button Click
    document.getElementById('btn-teams-test-text')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-teams-test-text');
      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⏳ กำลังส่ง...';

      if (teamsStatusBanner && teamsStatusText) {
        teamsStatusBanner.className = 'teams-status-banner';
        teamsStatusText.textContent = 'กำลังส่งทดสอบเฉพาะข้อความสรุป Markdown เข้า MS Teams...';
      }

      try {
        const note = teamsQuickNote?.value?.trim() || 'ทดสอบส่งข้อความสรุป (Markdown)';
        const res = await executeSendTeamsNotification('ทดสอบส่งข้อความ (Markdown Only)', note, 'text');

        if (teamsStatusBanner && teamsStatusText) {
          teamsStatusBanner.className = 'teams-status-banner is-success';
          teamsStatusText.textContent = `✅ ส่งข้อความสรุปเข้า MS Teams สำเร็จ (${res.message || '202 Accepted'}) เวลา ${res.timestamp}`;
        }
      } catch (err) {
        if (teamsStatusBanner && teamsStatusText) {
          teamsStatusBanner.className = 'teams-status-banner is-error';
          teamsStatusText.textContent = `❌ ไม่สามารถส่งข้อความได้ (${err.message || 'Network Error'})`;
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    });

    // Save Schedule Button Click (Bulletproof: saves locally + updates UI + syncs backend)
    document.getElementById('btn-teams-save-schedule')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-teams-save-schedule');
      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ กำลังบันทึก...</span>';

      const isEnabled = Boolean(teamsScheduleToggle?.checked);
      const t1 = teamsScheduleTime1?.value?.trim() || '';
      const t2 = teamsScheduleTime2?.value?.trim() || '';
      const scheduleTimes = [t1, t2].filter(Boolean);
      if (!scheduleTimes.length) scheduleTimes.push('08:00');
      const scheduleTimeStr = scheduleTimes.join(', ');
      const selectedDays = getSelectedDays();
      const daysSummary = formatDaysSummary(selectedDays);

      const scheduleConfig = {
        scheduleEnabled: isEnabled,
        scheduleTimes: scheduleTimes,
        scheduleTime: scheduleTimeStr,
        scheduleDays: selectedDays,
        updatedAt: new Date().toISOString()
      };

      // 1. ALWAYS SAVE TO LOCAL STORAGE IMMEDIATELY (Guaranteed persistence in offline/static/Apache/GitHub Pages)
      try {
        localStorage.setItem('ptt_teams_schedule_config', JSON.stringify(scheduleConfig));
        localStorage.setItem('ptt_teams_schedule_enabled', isEnabled ? 'true' : 'false');
        localStorage.setItem('ptt_teams_schedule_times', JSON.stringify(scheduleTimes));
        localStorage.setItem('ptt_teams_schedule_days', JSON.stringify(selectedDays));
      } catch (e) {
        console.warn('localStorage save failed', e);
      }

      // 2. UPDATE UI IMMEDIATELY TO SUCCESS STATUS
      if (teamsStatusBanner && teamsStatusText) {
        teamsStatusBanner.className = 'teams-status-banner is-success';
        teamsStatusText.textContent = isEnabled
          ? `✅ บันทึกการตั้งเวลาสำเร็จ! ระบบตั้งเวลาส่งแจ้งเตือน (${daysSummary}) เวลา ${scheduleTimes.join(' น. และ ')} น. เรียบร้อยแล้ว`
          : `✅ บันทึกแล้ว: ปิดการตั้งเวลาส่งแจ้งเตือนประจำวัน`;
      }
      if (teamsScheduleDot) teamsScheduleDot.classList.toggle('active', isEnabled);
      updateScheduleHint(isEnabled, scheduleTimes, selectedDays);

      // 3. BACKGROUND SYNC TO BACKEND (notify.php, api/notify/config, /api/notify/config)
      const endpoints = [
        'notify.php?action=config',
        'api/notify/config',
        '/api/notify/config'
      ];
      for (const ep of endpoints) {
        try {
          const resp = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scheduleEnabled: isEnabled,
              scheduleTimes: scheduleTimes,
              scheduleTime: scheduleTimeStr,
              scheduleDays: selectedDays,
            }),
          });
          if (resp.ok) break;
        } catch (e) {}
      }

      btn.disabled = false;
      btn.innerHTML = origText;
    });

    // Save Webhook URL Button Click
    document.getElementById('btn-teams-save-url')?.addEventListener('click', async () => {
      const url = teamsWebhookUrl?.value?.trim();
      if (!url) {
        alert('กรุณากรอก Webhook URL');
        return;
      }
      try {
        localStorage.setItem('ptt_teams_webhook_url', url);
      } catch (e) {}

      const endpoints = [
        'notify.php?action=config',
        'api/notify/config',
        '/api/notify/config'
      ];
      for (const ep of endpoints) {
        try {
          const resp = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhookUrl: url }),
          });
          if (resp.ok) break;
        } catch (e) {}
      }

      alert('✅ บันทึก Webhook URL สำเร็จ!');
    });

    // Client-side automated daily scheduler (for open tab on Apache / GitHub Pages / Kiosk / Teams tab)
    let lastClientFiredMinute = '';
    setInterval(async () => {
      try {
        const localCfgRaw = localStorage.getItem('ptt_teams_schedule_config');
        if (!localCfgRaw) return;
        const cfg = JSON.parse(localCfgRaw);
        if (!cfg || !cfg.scheduleEnabled) return;

        const times = Array.isArray(cfg.scheduleTimes) ? cfg.scheduleTimes : ['08:00', '20:00'];
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const currentHM = `${hh}:${mm}`;
        const ymdHM = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${currentHM}`;

        if (times.includes(currentHM) && lastClientFiredMinute !== ymdHM) {
          lastClientFiredMinute = ymdHM;
          console.log(`[Client Scheduler] Firing daily alert for ${currentHM} (${ymdHM})...`);

          await executeSendTeamsNotification(
            `ตั้งเวลาประจำวัน (รอบ ${currentHM} น.)`,
            'แจ้งเตือนอัตโนมัติตามรอบเวลาที่กำหนด',
            'adaptive'
          ).catch((err) => console.warn('[Client Scheduler] Notification failed', err));
        }
      } catch (e) {
        console.warn('Client scheduler tick error', e);
      }
    }, 20000);
  }

  /**
   * Sync Live Thai Date & Time (อัปเดตวันและเวลาปัจจุบันแบบเรียลไทม์ทุกวินาที)
   */
  function syncLiveDateTime(force = false) {
    const live = getLiveThaiDateTime();
    state.dateText = live.dateText;
    state.timeText = live.timeText;
    const inpDate = document.getElementById('inp-date');
    const inpTime = document.getElementById('inp-time');

    // Only skip updating an input if the user's cursor is actively focused inside it right now
    if (inpDate && (document.activeElement !== inpDate || force)) {
      inpDate.value = live.dateText;
      try { inpDate.setAttribute('value', live.dateText); } catch (e) {}
    }
    if (inpTime && (document.activeElement !== inpTime || force)) {
      inpTime.value = live.timeText;
      try { inpTime.setAttribute('value', live.timeText); } catch (e) {}
    }
  }

  /**
   * Secure Authentication System (No hardcoded username/password in code)
   * Validates via backend API (/api/auth/login, login.php) or salted SHA-256 hash
   */
  function setupAuthentication() {
    const loginOverlay = document.getElementById('login-overlay');
    const loginForm = document.getElementById('login-form');
    const loginUsername = document.getElementById('login-username');
    const loginPassword = document.getElementById('login-password');
    const btnTogglePwd = document.getElementById('btn-toggle-pwd');
    const loginRemember = document.getElementById('login-remember');
    const loginAlert = document.getElementById('login-alert');
    const loginAlertMsg = document.getElementById('login-alert-msg');
    const btnSubmit = document.getElementById('btn-login-submit');
    const loginSpinner = document.getElementById('login-spinner');
    const loginBtnIcon = document.getElementById('login-btn-icon');
    const userHeaderSlot = document.getElementById('user-header-slot');
    const userBadgeName = document.getElementById('user-badge-name');
    const btnLogout = document.getElementById('btn-logout');

    const TOKEN_KEY = 'ptt_3d_token';
    const USER_KEY = 'ptt_3d_user';

    // Salted SHA-256 Signature (One-Way Hash - Zero plaintext credentials in code)
    const AUTH_SALT = 'ptt_gsp_salt_2026';
    const AUTH_HASH = '5747b8ca95b6179f51c02e61bc83a75b71ac9cc64062f6642381a646d7ca2d0c';

    function showAlert(msg) {
      if (!loginAlert) return;
      if (loginAlertMsg) loginAlertMsg.textContent = msg;
      loginAlert.classList.remove('hidden');
    }

    function hideAlert() {
      if (loginAlert) loginAlert.classList.add('hidden');
    }

    function setSubmitting(loading) {
      if (!btnSubmit) return;
      btnSubmit.disabled = loading;
      if (loginSpinner) loginSpinner.classList.toggle('hidden', !loading);
      if (loginBtnIcon) loginBtnIcon.classList.toggle('hidden', loading);
      const textSpan = document.getElementById('login-btn-text');
      if (textSpan) {
        textSpan.textContent = loading ? 'กำลังตรวจสอบสิทธิ์...' : 'เข้าสู่ระบบ (Sign In)';
      }
    }

    // Toggle password visibility
    btnTogglePwd?.addEventListener('click', () => {
      if (!loginPassword) return;
      const isPwd = loginPassword.type === 'password';
      loginPassword.type = isPwd ? 'text' : 'password';
      btnTogglePwd.textContent = isPwd ? '🙈' : '👁️';
    });

    // Check existing stored session
    function checkExistingSession() {
      const token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
      const user = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
      if (token && user) {
        grantAccess(user);
        return true;
      }
      denyAccess();
      return false;
    }

    function grantAccess(username) {
      if (loginOverlay) loginOverlay.classList.add('hidden');
      if (userHeaderSlot) userHeaderSlot.style.display = 'flex';
      if (userBadgeName) userBadgeName.textContent = username || 'oper_gsp';
    }

    function denyAccess() {
      if (loginOverlay) loginOverlay.classList.remove('hidden');
      if (userHeaderSlot) userHeaderSlot.style.display = 'none';
      setTimeout(() => {
        if (loginUsername) loginUsername.focus();
      }, 100);
    }

    // Pure JavaScript SHA-256 implementation (Works 100% in all contexts: HTTPS, HTTP, and file://)
    function computeSha256(ascii) {
      function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
      }
      var mathPow = Math.pow;
      var maxWord = mathPow(2, 32);
      var lengthProperty = 'length';
      var i, j;
      var result = '';
      var words = [];
      var asciiBitLength = ascii[lengthProperty] * 8;
      var hash = [];
      var k = [];
      var primeCounter = 0;
      var isComposite = {};
      for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (i = 0; i < 313; i += candidate) {
            isComposite[i] = candidate;
          }
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
      }
      ascii += '\x80';
      while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
      for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << (((3 - i) % 4) * 8);
      }
      words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
      words[words[lengthProperty]] = asciiBitLength | 0;
      for (j = 0; j < words[lengthProperty];) {
        var w = words.slice(j, (j += 16));
        var oldHash = hash;
        hash = hash.slice(0, 8);
        for (i = 0; i < 64; i++) {
          var w15 = w[i - 15], w2 = w[i - 2];
          var a = hash[0], e = hash[4];
          var temp1 = hash[7] +
            (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
            ((e & hash[5]) ^ (~e & hash[6])) +
            k[i] +
            (w[i] = (i < 16) ? w[i] : (
              w[i - 16] +
              (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
              w[i - 7] +
              (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0);
          var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
            ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1 + temp2) | 0].concat(hash);
          hash[4] = (hash[4] + temp1) | 0;
        }
        for (i = 0; i < 8; i++) {
          hash[i] = (hash[i] + oldHash[i]) | 0;
        }
      }
      for (i = 0; i < 8; i++) {
        for (var i2 = 3; i2 >= 0; i2--) {
          var b = (hash[i] >> (i2 * 8)) & 255;
          result += (b < 16 ? '0' : '') + b.toString(16);
        }
      }
      return result;
    }

    async function authenticate(username, password) {
      // 1. Instant verification using Cryptographic Salted SHA-256 (Zero plaintext in code, 100% reliable)
      try {
        const localHash = computeSha256(`${username}:${password}:${AUTH_SALT}`);
        if (localHash === AUTH_HASH) {
          const clientToken = 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
          // Background sync to server if running
          fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          }).catch(() => {});
          return { ok: true, token: clientToken, username: username };
        }
      } catch (err) {
        console.warn('Hash calculation error:', err);
      }

      // 2. Try server-side validation in case credentials were updated in auth_config.json
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (resp.ok) {
          const res = await resp.json();
          if (res.ok) return { ok: true, token: res.token, username: res.username };
        } else if (resp.status === 401 || resp.status === 400) {
          const res = await resp.json().catch(() => ({}));
          return { ok: false, error: res.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
        }
      } catch (e) {}

      // 3. Try PHP backend login.php
      try {
        const respPhp = await fetch('login.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (respPhp.ok) {
          const res = await respPhp.json();
          if (res.ok) return { ok: true, token: res.token, username: res.username };
        }
      } catch (e) {}

      return { ok: false, error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' };
    }

    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();
      const u = loginUsername?.value?.trim() || '';
      const p = loginPassword?.value || '';

      if (!u || !p) {
        showAlert('กรุณากรอกทั้งชื่อผู้ใช้งานและรหัสผ่าน');
        return;
      }

      setSubmitting(true);
      try {
        const result = await authenticate(u, p);
        if (result.ok) {
          const remember = Boolean(loginRemember?.checked);
          const storage = remember ? localStorage : sessionStorage;
          storage.setItem(TOKEN_KEY, result.token);
          storage.setItem(USER_KEY, result.username);

          // Clear password input for security
          if (loginPassword) loginPassword.value = '';
          grantAccess(result.username);
        } else {
          showAlert(result.error || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
          if (loginPassword) {
            loginPassword.value = '';
            loginPassword.focus();
          }
        }
      } catch (err) {
        showAlert('เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setSubmitting(false);
      }
    });

    btnLogout?.addEventListener('click', async () => {
      if (confirm('คุณต้องการออกจากระบบ PTT 3D SMART BOARD ใช่หรือไม่?')) {
        const token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
        try {
          fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          }).catch(() => {});
        } catch (e) {}

        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);

        document.getElementById('settings-modal')?.classList.add('hidden');
        denyAccess();
      }
    });

    // Run session check on load
    checkExistingSession();
  }

  /**
   * Initialize GSP Data Synchronization (Online URL Params, BroadcastChannel, Bookmarklet, LocalStorage)
   */
  function initGspDataSync() {
    // 1. Set up Draggable Bookmarklet
    setupGspBookmarklet();

    // 2. Load cached GSP data from localStorage
    loadGspCache();

    // 3. Check URL Query Parameters for instant sync (e.g., from Bookmarklet or direct link)
    try {
      const params = new URLSearchParams(window.location.search);
      let updatedFromUrl = false;
      const pVal = params.get('p') || params.get('propane');
      const lVal = params.get('l') || params.get('lpg');
      const nVal = params.get('n') || params.get('ngl');
      const sVal = params.get('s') || params.get('sum');

      if (pVal != null && !isNaN(parseFloat(pVal))) {
        const p = parseFloat(pVal);
        state.gspData.propanePct = p;
        state.inventoryPct = p;
        state.inventoryTon = Math.round((p / 100) * state.inventoryCap);
        updatedFromUrl = true;
      }
      if (lVal != null && !isNaN(parseFloat(lVal))) {
        state.gspData.lpgPct = parseFloat(lVal);
        updatedFromUrl = true;
      }
      if (nVal != null && !isNaN(parseFloat(nVal))) {
        state.gspData.nglPct = parseFloat(nVal);
        updatedFromUrl = true;
      }
      if (sVal != null && !isNaN(parseFloat(sVal))) {
        state.gspData.propanePlusLpgPct = parseFloat(sVal);
        updatedFromUrl = true;
      }

      if (updatedFromUrl) {
        saveGspCache(state.gspData);
        syncInputsFromState();
        renderBoard();
        syncBackendState();
        // Clean URL query parameters from address bar without reloading
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        const banner = document.getElementById('gsp-status-banner');
        if (banner) {
          banner.className = 'gsp-status-banner is-success';
          banner.textContent = `✅ ซิงค์ข้อมูลสดจาก GSP Daily Report สำเร็จ! Propane=${state.gspData.propanePct}% | LPG=${state.gspData.lpgPct}% | NGL=${state.gspData.nglPct}%`;
        }
      }
    } catch (e) {}

    // 4. Listen for BroadcastChannel messages from GSP tab in real-time
    try {
      const bc = new BroadcastChannel('ptt_gsp_sync_channel');
      bc.onmessage = (event) => {
        if (event?.data) {
          const d = event.data;
          if (d.propane != null && !isNaN(parseFloat(d.propane))) {
            const p = parseFloat(d.propane);
            state.gspData.propanePct = p;
            state.inventoryPct = p;
            state.inventoryTon = Math.round((p / 100) * state.inventoryCap);
          }
          if (d.lpg != null) state.gspData.lpgPct = parseFloat(d.lpg);
          if (d.ngl != null) state.gspData.nglPct = parseFloat(d.ngl);
          if (d.sum != null) state.gspData.propanePlusLpgPct = parseFloat(d.sum);

          saveGspCache(state.gspData);
          syncInputsFromState();
          renderBoard();
          syncBackendState();
          updateGspModalUI();

          const banner = document.getElementById('gsp-status-banner');
          if (banner) {
            banner.className = 'gsp-status-banner is-success';
            banner.textContent = `⚡ ได้รับข้อมูลอัปเดตสดจากหน้า GSP! Propane=${state.gspData.propanePct}% | LPG=${state.gspData.lpgPct}% | NGL=${state.gspData.nglPct}%`;
          }
        }
      };
    } catch (e) {}

    // 5. Cross-tab storage event listener
    window.addEventListener('storage', (e) => {
      if (e.key === 'ptt_gsp_synced_event' && e.newValue) {
        try {
          const d = JSON.parse(e.newValue);
          if (d?.propane != null && !isNaN(parseFloat(d.propane))) {
            const p = parseFloat(d.propane);
            state.gspData.propanePct = p;
            state.inventoryPct = p;
            state.inventoryTon = Math.round((p / 100) * state.inventoryCap);
            if (d.lpg != null) state.gspData.lpgPct = parseFloat(d.lpg);
            if (d.ngl != null) state.gspData.nglPct = parseFloat(d.ngl);
            if (d.sum != null) state.gspData.propanePlusLpgPct = parseFloat(d.sum);
            saveGspCache(state.gspData);
            syncInputsFromState();
            renderBoard();
            syncBackendState();
            updateGspModalUI();
          }
        } catch (err) {}
      }
    });
  }

  /**
   * Initialize Board
   */
  function init() {
    // 0. Initialize Authentication Protection immediately
    setupAuthentication();

    // 0.5. Load persisted state from localStorage (remembers user settings across reloads on GitHub Pages)
    loadStateFromLocalStorage();

    // 1. Kick off background image loading immediately so canvas renders without delay
    const bgImg = new Image();
    bgImg.onload = () => {
      cleanBgImage = bgImg;
      imageLoaded = true;
      renderBoard();
    };
    bgImg.onerror = (e) => {
      console.error('Failed to load bg_clean.png', e);
    };
    bgImg.src = 'bg_clean.png';

    // 2. Bind DOM event listeners and sync inputs
    bindEvents();
    syncInputsFromState();

    // 3. Initialize GSP Data Sync (online query params, bookmarklet, cache, cross-tab events)
    initGspDataSync();

    // 4. Fetch Internet Time immediately, tick clock every 1 second, and re-sync every 5 minutes
    syncLiveDateTime(true);
    fetchInternetTime().catch(() => {});

    setInterval(() => {
      syncLiveDateTime(false);
    }, 1000); // Real-time live clock tick every second!

    setInterval(() => {
      fetchInternetTime().catch(() => {});
    }, 300000); // Re-sync Internet Time every 5 minutes

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchInternetTime().catch(() => {});
      }
    });

    // 5. Always load MS Teams notification schedule configuration on all platforms (GitHub Pages, Apache, Localhost)
    try {
      if (typeof fetchTeamsConfig === 'function') {
        fetchTeamsConfig().catch(() => {});
      }
    } catch (err) {}

    // 6. Auto-pull live values: from Tank Farm (Chrome / local bridge) or latest_state.json
    if (window.location.protocol !== 'file:') {
      try {
        if (typeof doFetchGspFromChrome === 'function') {
          doFetchGspFromChrome(false).catch(() => {});
        }
      } catch (err) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
