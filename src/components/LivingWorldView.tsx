import { useEffect, useRef, useState, type JSX } from 'react';
import {
  CloudRain,
  Compass,
  Droplets,
  RotateCcw,
  Snowflake,
  Sparkles,
  Sun,
  Thermometer,
  Trees,
  Wind,
} from 'lucide-react';
import {
  createForestScene,
  type ForestSceneController,
} from '../services/forestSceneBuilder';
import {
  LIVING_WORLD_PRESETS,
  createInitialForestSimState,
  stepForestWeather,
} from '../services/forestWeatherPhysics';
import type {
  ForestSceneStats,
  LivingWorldControls,
  LivingWorldPreset,
  LivingWorldSimState,
  PrecipMode,
} from '../types/livingWorld';

const FALLBACK_CONTROLS: LivingWorldControls = {
  tempC: 16,
  precipMode: 'clear',
  precipIntensity: 0,
  windStrength: 0.25,
  timeOfDayHours: 14.2,
};

const PRECIP_OPTIONS: {
  mode: PrecipMode;
  label: string;
  Icon: typeof Sun;
}[] = [
  { mode: 'clear', label: 'Açık', Icon: Sun },
  { mode: 'rain', label: 'Yağmur', Icon: CloudRain },
  { mode: 'snow', label: 'Kar', Icon: Snowflake },
  { mode: 'auto', label: 'Otomatik', Icon: Sparkles },
];

function formatTimeOfDay(hours: number): string {
  const wrapped = ((hours % 24) + 24) % 24;
  const totalMinutes = Math.round(wrapped * 60) % (24 * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getRateBadge(
  sim: LivingWorldSimState,
  tempC: number
): { text: string; toneClass: string } {
  if (sim.snowRateCmPerMin > 0.05) {
    return {
      text: `❄️ Kar birikiyor (+${sim.snowRateCmPerMin.toFixed(1)} cm/dk)`,
      toneClass: 'is-snow',
    };
  }
  if (sim.meltRateCmPerMin > 0.05) {
    return {
      text: `💧 Eriyor (-${sim.meltRateCmPerMin.toFixed(1)} cm/dk)`,
      toneClass: 'is-melt',
    };
  }
  if (sim.snowDepthCm > 0.1 && tempC <= 0) {
    return {
      text: '🧊 Donmuş kar örtüsü',
      toneClass: 'is-frozen',
    };
  }
  if (sim.activePrecipKind === 'rain') {
    return {
      text: '🌧️ Ormana yağmur yağıyor',
      toneClass: 'is-rain',
    };
  }
  return {
    text: '🌿 Sakin orman havası',
    toneClass: '',
  };
}

export function LivingWorldView(): JSX.Element {
  const initialPreset = LIVING_WORLD_PRESETS[0];

  const [controls, setControls] = useState<LivingWorldControls>(() =>
    initialPreset ? { ...initialPreset.controls } : { ...FALLBACK_CONTROLS }
  );
  const [activePresetId, setActivePresetId] = useState<string | null>(
    initialPreset ? initialPreset.id : null
  );
  const [hudSim, setHudSim] = useState<LivingWorldSimState>(() =>
    createInitialForestSimState()
  );
  const [fps, setFps] = useState<number>(60);
  const [stats, setStats] = useState<ForestSceneStats>({
    trees: 2200,
    grassBlades: 22000,
    ferns: 3200,
    rocks: 220,
    particles: 9640,
  });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ForestSceneController | null>(null);
  const controlsRef = useRef<LivingWorldControls>(controls);
  const simStateRef = useRef<LivingWorldSimState>(createInitialForestSimState());

  controlsRef.current = controls;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const controller = createForestScene(host);
    controllerRef.current = controller;
    setStats(controller.getStats());

    const syncSize = () => {
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      if (width > 0 && height > 0) {
        controller.resize(width, height);
      }
    };

    syncSize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            controller.resize(width, height);
            return;
          }
        }
        syncSize();
      });
      resizeObserver.observe(host);
    }

    window.addEventListener('resize', syncSize);

    let rafId = 0;
    let lastTime = performance.now();
    let lastHudSync = lastTime;
    let framesSinceHud = 0;

    const tick = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dtSec = Math.min(0.1, Math.max(0.001, rawDt));

      const currentControls = controlsRef.current;
      const nextSim = stepForestWeather(
        simStateRef.current,
        currentControls,
        dtSec
      );
      simStateRef.current = nextSim;
      controller.update(dtSec, currentControls, nextSim);

      framesSinceHud += 1;
      const hudElapsed = now - lastHudSync;
      if (hudElapsed >= 180) {
        const measuredFps = Math.max(
          1,
          Math.min(144, Math.round((framesSinceHud * 1000) / hudElapsed))
        );
        setHudSim({ ...nextSim });
        setFps(measuredFps);
        lastHudSync = now;
        framesSinceHud = 0;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', syncSize);
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateControls = (patch: Partial<LivingWorldControls>) => {
    setControls((prev) => {
      const next = { ...prev, ...patch };
      controlsRef.current = next;
      return next;
    });
    setActivePresetId(null);
  };

  const handleSelectPrecipMode = (mode: PrecipMode) => {
    setControls((prev) => {
      const needsIntensity = mode !== 'clear' && prev.precipIntensity <= 0.05;
      const next: LivingWorldControls = {
        ...prev,
        precipMode: mode,
        precipIntensity: needsIntensity ? 0.7 : prev.precipIntensity,
      };
      controlsRef.current = next;
      return next;
    });
    setActivePresetId(null);
  };

  const handleSelectPreset = (preset: LivingWorldPreset) => {
    const nextControls: LivingWorldControls = { ...preset.controls };
    controlsRef.current = nextControls;
    setControls(nextControls);
    setActivePresetId(preset.id);

    if (preset.resetSnowToCm !== undefined) {
      const depth = Math.max(0, Math.min(80, preset.resetSnowToCm));
      const coverage = Math.max(0, Math.min(1, 1 - Math.exp(-depth / 7.5)));
      const canopy = depth > 0.1 ? Math.min(1, coverage * 0.72) : 0;
      const resetSim: LivingWorldSimState = {
        ...simStateRef.current,
        snowDepthCm: depth,
        snowCoverage: coverage,
        canopySnow: canopy,
        snowRateCmPerMin: 0,
        meltRateCmPerMin: 0,
      };
      simStateRef.current = resetSim;
      setHudSim({ ...resetSim });
    }
  };

  const handleResetSnow = () => {
    const resetSim: LivingWorldSimState = {
      ...simStateRef.current,
      snowDepthCm: 0,
      snowCoverage: 0,
      canopySnow: 0,
      snowRateCmPerMin: 0,
      meltRateCmPerMin: 0,
    };
    simStateRef.current = resetSim;
    setHudSim({ ...resetSim });
  };

  const handleResetCamera = () => {
    controllerRef.current?.resetCamera();
  };

  const rateBadge = getRateBadge(hudSim, controls.tempC);
  const tempColor = controls.tempC < 0 ? '#7dd3fc' : '#fbbf24';

  return (
    <div className="living-world-shell">
      <div ref={hostRef} className="world-canvas-host" />

      <aside
        className="glass-panel world-hud"
        aria-label="Canlı Dünya atmosfer telemetrisi"
      >
        <div className="world-hud-header">
          <div className="world-hud-title">
            <Trees size={15} color="#34d399" />
            <span>Canlı Dünya — Yoğun Orman</span>
          </div>
          <span className="world-fps-pill">{fps} FPS</span>
        </div>

        <div className="world-hud-grid">
          <div className="world-hud-stat">
            <span className="world-hud-stat-label">
              <Thermometer size={12} color={tempColor} />
              Sıcaklık
            </span>
            <strong
              className="world-hud-stat-value"
              style={{ color: tempColor }}
            >
              {controls.tempC.toFixed(0)}°C
            </strong>
          </div>

          <div className="world-hud-stat">
            <span className="world-hud-stat-label">
              <Snowflake size={12} color="#bae6fd" />
              Kar Kalınlığı
            </span>
            <strong className="world-hud-stat-value">
              {hudSim.snowDepthCm.toFixed(1)} cm
            </strong>
          </div>

          <div className="world-hud-stat">
            <span className="world-hud-stat-label">
              <Sparkles size={12} color="#e2e8f0" />
              Kar Örtüsü
            </span>
            <strong className="world-hud-stat-value">
              %{Math.round(hudSim.snowCoverage * 100)}
            </strong>
          </div>

          <div className="world-hud-stat">
            <span className="world-hud-stat-label">
              <Droplets size={12} color="#38bdf8" />
              Zemin Nemi
            </span>
            <strong className="world-hud-stat-value">
              %{Math.round(hudSim.wetness * 100)}
            </strong>
          </div>
        </div>

        <div
          className={`world-rate-pill${
            rateBadge.toneClass ? ` ${rateBadge.toneClass}` : ''
          }`}
        >
          {rateBadge.text}
        </div>

        <div className="world-stats-line">
          {stats.trees.toLocaleString('tr-TR')} ağaç ·{' '}
          {stats.grassBlades.toLocaleString('tr-TR')} çimen ·{' '}
          {stats.ferns.toLocaleString('tr-TR')} eğrelti
        </div>
      </aside>

      <section
        className="glass-panel world-dock"
        aria-label="Canlı Dünya hava ve zaman kontrolleri"
      >
        <div className="world-presets-row">
          <div className="world-presets-list">
            {LIVING_WORLD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`world-preset-btn${
                  activePresetId === preset.id ? ' is-active' : ''
                }`}
                onClick={() => handleSelectPreset(preset)}
                title={preset.description}
              >
                <span>{preset.emoji}</span>
                <span>{preset.label}</span>
              </button>
            ))}
          </div>

          <div className="world-actions-group">
            <button
              type="button"
              className="world-action-btn"
              onClick={handleResetSnow}
              title="Birikmiş karı sıfırla"
            >
              <RotateCcw size={13} />
              <span>Karı Sıfırla</span>
            </button>
            <button
              type="button"
              className="world-action-btn"
              onClick={handleResetCamera}
              title="Kamerayı başlangıç noktasına döndür"
            >
              <Compass size={13} />
              <span>Kamerayı Sıfırla</span>
            </button>
          </div>
        </div>

        <div className="world-controls-row">
          <div
            className="world-precip-group"
            role="group"
            aria-label="Yağış türü"
          >
            {PRECIP_OPTIONS.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                className={`world-precip-btn${
                  controls.precipMode === mode ? ' is-active' : ''
                }`}
                onClick={() => handleSelectPrecipMode(mode)}
              >
                <Icon size={13} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="world-sliders-grid">
            <label className="world-slider-item">
              <div className="world-slider-head">
                <span className="world-slider-label">
                  <Thermometer size={12} />
                  Sıcaklık
                </span>
                <span className="world-slider-val" style={{ color: tempColor }}>
                  {controls.tempC}°C
                </span>
              </div>
              <input
                type="range"
                min={-20}
                max={25}
                step={1}
                value={controls.tempC}
                onChange={(e) =>
                  updateControls({ tempC: Number(e.target.value) })
                }
                className="range-input world-slider-input"
                aria-label="Sıcaklık"
              />
            </label>

            <label className="world-slider-item">
              <div className="world-slider-head">
                <span className="world-slider-label">
                  <Droplets size={12} />
                  Yağış
                </span>
                <span className="world-slider-val">
                  %{Math.round(controls.precipIntensity * 100)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={controls.precipIntensity}
                onChange={(e) =>
                  updateControls({ precipIntensity: Number(e.target.value) })
                }
                className="range-input world-slider-input"
                aria-label="Yağış şiddeti"
              />
            </label>

            <label className="world-slider-item">
              <div className="world-slider-head">
                <span className="world-slider-label">
                  <Wind size={12} />
                  Rüzgar
                </span>
                <span className="world-slider-val">
                  %{Math.round(controls.windStrength * 100)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={controls.windStrength}
                onChange={(e) =>
                  updateControls({ windStrength: Number(e.target.value) })
                }
                className="range-input world-slider-input"
                aria-label="Rüzgar hızı"
              />
            </label>

            <label className="world-slider-item">
              <div className="world-slider-head">
                <span className="world-slider-label">
                  <Sun size={12} />
                  Saat
                </span>
                <span className="world-slider-val">
                  {formatTimeOfDay(controls.timeOfDayHours)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={23.75}
                step={0.25}
                value={controls.timeOfDayHours}
                onChange={(e) =>
                  updateControls({ timeOfDayHours: Number(e.target.value) })
                }
                className="range-input world-slider-input"
                aria-label="Günün saati"
              />
            </label>
          </div>
        </div>

        <div className="world-controls-hint">
          Sol tık + sürükle: Bakış · Tekerlek: Yakınlaş · WASD / Yön tuşları:
          Ormanda yürü
        </div>
      </section>
    </div>
  );
}

export default LivingWorldView;
