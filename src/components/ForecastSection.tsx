import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Droplets, Loader2, Snowflake } from 'lucide-react';
import {
  fetchWeatherForecast,
  type DailyForecastPoint,
  type HourlyForecastPoint,
  type WeatherForecastData,
} from '../services/forecastService';
import { WeatherIcon } from './WeatherIcon';

export interface ForecastSectionProps {
  lat: number;
  lng: number;
  elevationMeters?: number;
  refreshToken?: number;
}

type ForecastTab = 'hourly' | 'daily';

function isSnowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

function tempToBarColor(tempC: number): string {
  if (tempC <= 0) return '#93c5fd';
  if (tempC <= 12) return '#38bdf8';
  if (tempC <= 22) return '#34d399';
  if (tempC <= 30) return '#fbbf24';
  return '#f97316';
}

function buildSmoothCurvePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  if (points.length === 2) {
    return `${d} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }

  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

function HourlySparkline({
  hourly,
  gradientId,
}: {
  hourly: HourlyForecastPoint[];
  gradientId: string;
}): JSX.Element {
  const temps = hourly.map((h) => h.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const precipValues = hourly
    .map((h) => h.precipProb)
    .filter((v): v is number => typeof v === 'number');
  const maxPrecipProb = precipValues.length > 0 ? Math.max(...precipValues) : null;

  const width = 280;
  const height = 76;
  const padX = 12;
  const topY = 12;
  const baseY = 56;
  const plotW = width - padX * 2;
  const plotH = baseY - topY;

  const tempRange = maxTemp - minTemp;
  const effectiveMin = tempRange < 0.5 ? minTemp - 1 : minTemp;
  const effectiveMax = tempRange < 0.5 ? maxTemp + 1 : maxTemp;
  const effectiveSpan = effectiveMax - effectiveMin;

  const toX = (idx: number): number => {
    if (hourly.length <= 1) return width / 2;
    return padX + (idx / (hourly.length - 1)) * plotW;
  };

  const toY = (temp: number): number => {
    const ratio = (temp - effectiveMin) / effectiveSpan;
    return baseY - ratio * plotH;
  };

  const coords = hourly.map((h, i) => ({
    x: toX(i),
    y: toY(h.temperature),
    point: h,
  }));

  const linePath = buildSmoothCurvePath(coords);
  const firstPt = coords[0];
  const lastPt = coords[coords.length - 1];
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${lastPt.x.toFixed(1)} ${baseY} L ${firstPt.x.toFixed(1)} ${baseY} Z`
      : '';

  const crossesZero = minTemp < 0 && maxTemp > 0;
  const zeroY = crossesZero ? toY(0) : null;

  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < hourly.length; i++) {
    if (hourly[i].temperature < hourly[minIdx].temperature) minIdx = i;
    if (hourly[i].temperature > hourly[maxIdx].temperature) maxIdx = i;
  }

  const labelIndicesSet = new Set<number>();
  const labelSteps = Math.min(5, hourly.length);
  for (let k = 0; k < labelSteps; k++) {
    const idx =
      labelSteps <= 1
        ? 0
        : Math.round((k * (hourly.length - 1)) / (labelSteps - 1));
    labelIndicesSet.add(idx);
  }
  const labelIndices = Array.from(labelIndicesSet).sort((a, b) => a - b);

  const barWidth = Math.max(3, Math.min(7, plotW / Math.max(hourly.length, 1) - 3));
  const strokeGradId = `${gradientId}-stroke`;
  const fillGradId = `${gradientId}-fill`;

  return (
    <div className="forecast-hourly-wrap">
      <div className="forecast-hourly-summary">
        <span className="forecast-hourly-minmax">
          <span>
            Min <strong>{Math.round(minTemp)}°</strong>
          </span>
          <span className="forecast-dot-sep">·</span>
          <span>
            Maks <strong>{Math.round(maxTemp)}°</strong>
          </span>
        </span>
        {maxPrecipProb !== null && maxPrecipProb > 0 && (
          <span className="forecast-hourly-precip" title="24 saatlik en yüksek yağış olasılığı">
            <Droplets size={11} />
            <span>%{maxPrecipProb}</span>
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="forecast-sparkline"
        role="img"
        aria-label={`24 saatlik sıcaklık tahmini: en düşük ${Math.round(minTemp)}°C, en yüksek ${Math.round(maxTemp)}°C`}
      >
        <defs>
          <linearGradient id={strokeGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
          <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
            <stop offset="55%" stopColor="#38bdf8" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Subtle precipitation probability bars along baseline */}
        {coords.map(({ x, point }, idx) => {
          if (point.precipProb === null || point.precipProb <= 0) return null;
          const barH = Math.max(2, (Math.min(100, point.precipProb) / 100) * 18);
          return (
            <rect
              key={`precip-${point.timeIso}-${idx}`}
              x={x - barWidth / 2}
              y={baseY - barH}
              width={barWidth}
              height={barH}
              rx={1.5}
              fill="rgba(56, 189, 248, 0.28)"
            >
              <title>
                {point.hourLabel} · %{point.precipProb} yağış olasılığı
              </title>
            </rect>
          );
        })}

        {/* Baseline */}
        <line
          x1={padX}
          y1={baseY}
          x2={width - padX}
          y2={baseY}
          stroke="rgba(148, 163, 184, 0.16)"
          strokeWidth="1"
        />

        {/* Optional 0°C freezing threshold line */}
        {zeroY !== null && (
          <g>
            <line
              x1={padX}
              y1={zeroY}
              x2={width - padX}
              y2={zeroY}
              stroke="rgba(186, 230, 253, 0.42)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text
              x={width - padX}
              y={Math.max(10, zeroY - 3)}
              textAnchor="end"
              fontSize="8.5"
              fill="rgba(186, 230, 253, 0.78)"
              fontFamily="var(--font-mono, monospace)"
            >
              0°
            </text>
          </g>
        )}

        {/* Soft gradient fill under curve */}
        {areaPath && <path d={areaPath} fill={`url(#${fillGradId})`} />}

        {/* Temperature curve */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={`url(#${strokeGradId})`}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Min / Max highlight markers */}
        {coords[maxIdx] && (
          <circle
            cx={coords[maxIdx].x}
            cy={coords[maxIdx].y}
            r="2.6"
            fill="#fbbf24"
            stroke="rgba(11, 18, 30, 0.9)"
            strokeWidth="1"
          >
            <title>
              {coords[maxIdx].point.hourLabel} · {Math.round(coords[maxIdx].point.temperature)}°C
            </title>
          </circle>
        )}
        {coords[minIdx] && minIdx !== maxIdx && (
          <circle
            cx={coords[minIdx].x}
            cy={coords[minIdx].y}
            r="2.6"
            fill="#38bdf8"
            stroke="rgba(11, 18, 30, 0.9)"
            strokeWidth="1"
          >
            <title>
              {coords[minIdx].point.hourLabel} · {Math.round(coords[minIdx].point.temperature)}°C
            </title>
          </circle>
        )}

        {/* 5 evenly spaced hour labels */}
        {labelIndices.map((idx, pos) => {
          const item = coords[idx];
          if (!item) return null;
          const anchor =
            pos === 0
              ? 'start'
              : pos === labelIndices.length - 1
                ? 'end'
                : 'middle';
          const xPos =
            pos === 0
              ? padX
              : pos === labelIndices.length - 1
                ? width - padX
                : item.x;

          return (
            <text
              key={`lbl-${item.point.timeIso}-${idx}`}
              x={xPos}
              y={height - 4}
              textAnchor={anchor}
              fontSize="9.5"
              fill="rgba(148, 163, 184, 0.9)"
              fontFamily="var(--font-mono, monospace)"
            >
              {item.point.hourLabel}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function DailyForecastList({ daily }: { daily: DailyForecastPoint[] }): JSX.Element {
  const minAll = Math.min(...daily.map((d) => d.tempMin));
  const maxAll = Math.max(...daily.map((d) => d.tempMax));
  const span = Math.max(1, maxAll - minAll);

  return (
    <div className="forecast-daily-list">
      {daily.map((d) => {
        const leftPct = Math.max(0, Math.min(92, ((d.tempMin - minAll) / span) * 100));
        const rawWidthPct = ((d.tempMax - d.tempMin) / span) * 100;
        const widthPct = Math.max(8, Math.min(100 - leftPct, rawWidthPct));
        const isSnow =
          (d.snowfallCm !== null && d.snowfallCm > 0) || isSnowCode(d.weatherCode);
        const showPrecipBadge = d.precipProbMax !== null && d.precipProbMax > 0;
        const barGradient = `linear-gradient(90deg, ${tempToBarColor(d.tempMin)}, ${tempToBarColor(d.tempMax)})`;

        return (
          <div key={d.dateIso} className="forecast-day-row">
            <span className="forecast-day-name">{d.dayLabel}</span>

            <span className="forecast-day-icon">
              <WeatherIcon code={d.weatherCode} isDay size={17} />
            </span>

            <span className="forecast-day-precip">
              {showPrecipBadge ? (
                <span
                  className={`forecast-precip-badge ${isSnow ? 'is-snow' : 'is-rain'}`}
                  title={
                    isSnow && d.snowfallCm !== null && d.snowfallCm > 0
                      ? `%${d.precipProbMax} yağış · ${d.snowfallCm} cm kar`
                      : `%${d.precipProbMax} yağış olasılığı`
                  }
                >
                  {isSnow ? <Snowflake size={10} /> : <Droplets size={10} />}
                  <span>%{d.precipProbMax}</span>
                </span>
              ) : null}
            </span>

            <span className="forecast-day-min">{Math.round(d.tempMin)}°</span>

            <div className="forecast-day-bar-track" aria-hidden="true">
              <div
                className="forecast-day-bar-fill"
                style={{
                  left: `${leftPct.toFixed(1)}%`,
                  width: `${widthPct.toFixed(1)}%`,
                  background: barGradient,
                }}
              />
            </div>

            <span className="forecast-day-max">{Math.round(d.tempMax)}°</span>
          </div>
        );
      })}
    </div>
  );
}

export function ForecastSection({
  lat,
  lng,
  elevationMeters,
  refreshToken,
}: ForecastSectionProps): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<ForecastTab>('hourly');
  const [data, setData] = useState<WeatherForecastData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const rawId = useId();
  const gradientId = `fc-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const locationKey = `${lat.toFixed(4)},${lng.toFixed(4)},${
    typeof elevationMeters === 'number' && Number.isFinite(elevationMeters)
      ? Math.round(elevationMeters)
      : ''
  }`;
  const prevLocationKeyRef = useRef<string>(locationKey);
  const prevRefreshTokenRef = useRef<number>(
    typeof refreshToken === 'number' ? refreshToken : 0
  );

  useEffect(() => {
    const controller = new AbortController();
    const locationChanged = prevLocationKeyRef.current !== locationKey;
    const currentToken = typeof refreshToken === 'number' ? refreshToken : 0;
    const shouldForceRefresh =
      !locationChanged &&
      currentToken > 0 &&
      currentToken > prevRefreshTokenRef.current;

    prevLocationKeyRef.current = locationKey;
    prevRefreshTokenRef.current = currentToken;

    if (locationChanged) {
      setData(null);
    }
    setLoading(true);

    fetchWeatherForecast(lat, lng, {
      elevationMeters,
      forceRefresh: shouldForceRefresh,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setData(null);
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [lat, lng, elevationMeters, refreshToken, locationKey]);

  if (loading && !data) {
    return (
      <div className="forecast-section forecast-loading" role="status" aria-live="polite">
        <Loader2 size={13} className="spin" />
        <span>Tahmin yükleniyor...</span>
      </div>
    );
  }

  if (!data || (data.hourly.length === 0 && data.daily.length === 0)) {
    return null;
  }

  const effectiveTab: ForecastTab =
    activeTab === 'hourly' && data.hourly.length === 0
      ? 'daily'
      : activeTab === 'daily' && data.daily.length === 0
        ? 'hourly'
        : activeTab;

  return (
    <div className="forecast-section" role="region" aria-label="Hava Tahmini">
      <div className="forecast-header">
        <div className="forecast-tabs" role="tablist" aria-label="Tahmin görünümü">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'hourly'}
            className={`forecast-tab-btn${effectiveTab === 'hourly' ? ' active' : ''}`}
            disabled={data.hourly.length === 0}
            onClick={() => setActiveTab('hourly')}
          >
            24 Saat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'daily'}
            className={`forecast-tab-btn${effectiveTab === 'daily' ? ' active' : ''}`}
            disabled={data.daily.length === 0}
            onClick={() => setActiveTab('daily')}
          >
            7 Gün
          </button>
        </div>

        <span
          className="forecast-source-indicator"
          title={
            data.source === 'cache'
              ? '15 dk önbellekten yüklendi'
              : 'Canlı Open-Meteo tahmini'
          }
        >
          {loading ? (
            <Loader2 size={11} className="spin" />
          ) : (
            <span
              className={`cache-dot ${data.source === 'cache' ? 'cached' : 'live'}`}
            />
          )}
          <span>{data.source === 'cache' ? 'Önbellek' : 'Canlı'}</span>
        </span>
      </div>

      {effectiveTab === 'hourly' ? (
        <HourlySparkline hourly={data.hourly} gradientId={gradientId} />
      ) : (
        <DailyForecastList daily={data.daily} />
      )}
    </div>
  );
}
