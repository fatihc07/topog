import { useId } from 'react';
import { Activity, Snowflake } from 'lucide-react';
import type { SimHistoryPoint } from '../types/simulator';

export interface SimHistoryChartProps {
  history: SimHistoryPoint[];
  isPeak?: boolean;
}

const CHART_WIDTH = 280;
const TEMP_HEIGHT = 64;
const SNOW_HEIGHT = 42;
const PAD_X = 6;
const PLOT_WIDTH = CHART_WIDTH - PAD_X * 2;

function toZeroSafe(val: number): number {
  return Math.abs(val) < 0.05 ? 0 : val;
}

export function SimHistoryChart({ history, isPeak = false }: SimHistoryChartProps) {
  const uid = useId().replace(/:/g, '');
  const tempGradId = `sim-temp-grad-${uid}`;
  const snowGradId = `sim-snow-grad-${uid}`;

  if (history.length < 2) {
    return (
      <div
        className="sim-chart-card"
        style={{
          padding: '8px 10px',
          borderRadius: 9,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-glass)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <Activity size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span
          className="sim-chart-empty"
          style={{
            fontSize: 11.5,
            color: 'var(--text-muted)',
          }}
        >
          Simülasyon grafiği veri topluyor...
        </span>
      </div>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];
  const currentTemp = toZeroSafe(last.tempC);
  const deltaT = toZeroSafe(last.tempC - first.tempC);
  const isPositiveDelta = deltaT >= 0;
  const deltaLabel = `${isPositiveDelta ? '+' : ''}${deltaT.toFixed(1)}°`;
  const deltaColor = isPositiveDelta ? '#fbbf24' : '#38bdf8';
  const deltaBg = isPositiveDelta
    ? 'rgba(251, 191, 36, 0.16)'
    : 'rgba(56, 189, 248, 0.16)';

  const temps = history.map((p) => p.tempC);
  const rawMinT = Math.min(...temps);
  const rawMaxT = Math.max(...temps);
  const rawSpanT = rawMaxT - rawMinT;
  const padT = rawSpanT < 1 ? (2.4 - rawSpanT) / 2 : rawSpanT * 0.16;
  const minT = rawMinT - padT;
  const maxT = rawMaxT + padT;
  const rangeT = Math.max(0.1, maxT - minT);

  const tempPadTop = 7;
  const tempPadBottom = 7;
  const tempPlotH = TEMP_HEIGHT - tempPadTop - tempPadBottom;

  const toX = (idx: number) =>
    PAD_X + (idx / Math.max(1, history.length - 1)) * PLOT_WIDTH;
  const toTempY = (tempC: number) =>
    tempPadTop + (1 - (tempC - minT) / rangeT) * tempPlotH;

  const tempCoords = history.map((p, idx) => ({
    x: toX(idx),
    y: toTempY(p.tempC),
  }));
  const tempLinePoints = tempCoords
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');
  const tempBaselineY = TEMP_HEIGHT - 2;
  const tempAreaPoints = `${tempCoords[0].x.toFixed(1)},${tempBaselineY} ${tempLinePoints} ${tempCoords[tempCoords.length - 1].x.toFixed(1)},${tempBaselineY}`;
  const lastTempCoord = tempCoords[tempCoords.length - 1];
  const tempColor = last.tempC <= 0 ? '#38bdf8' : '#fbbf24';

  const hasZeroLine = minT <= 0 && maxT >= 0;
  const zeroY = toTempY(0);

  const snowSamples = isPeak
    ? history
        .map((p, idx) =>
          typeof p.snowDepthCm === 'number' && Number.isFinite(p.snowDepthCm)
            ? { idx, value: Math.max(0, p.snowDepthCm) }
            : null
        )
        .filter((item): item is { idx: number; value: number } => item !== null)
    : [];

  const showSnowChart = isPeak && snowSamples.length > 0;

  let snowLinePoints = '';
  let snowAreaPoints = '';
  let lastSnowCoord = { x: PAD_X, y: SNOW_HEIGHT / 2 };
  let latestSnowCm = 0;

  if (showSnowChart) {
    latestSnowCm = snowSamples[snowSamples.length - 1].value;
    const snowValues = snowSamples.map((s) => s.value);
    const rawMinS = Math.min(...snowValues);
    const rawMaxS = Math.max(...snowValues);
    const rawSpanS = rawMaxS - rawMinS;
    const padS = Math.max(1, rawSpanS * 0.2);
    const minS = Math.max(0, rawMinS - padS);
    const maxS = rawMaxS + padS;
    const rangeS = Math.max(0.5, maxS - minS);

    const snowPadTop = 5;
    const snowPadBottom = 5;
    const snowPlotH = SNOW_HEIGHT - snowPadTop - snowPadBottom;
    const toSnowY = (val: number) =>
      snowPadTop + (1 - (val - minS) / rangeS) * snowPlotH;

    const snowCoords =
      snowSamples.length === 1
        ? [
            { x: PAD_X, y: toSnowY(snowSamples[0].value) },
            { x: CHART_WIDTH - PAD_X, y: toSnowY(snowSamples[0].value) },
          ]
        : snowSamples.map((s) => ({
            x: toX(s.idx),
            y: toSnowY(s.value),
          }));

    snowLinePoints = snowCoords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');
    const snowBaselineY = SNOW_HEIGHT - 2;
    snowAreaPoints = `${snowCoords[0].x.toFixed(1)},${snowBaselineY} ${snowLinePoints} ${snowCoords[snowCoords.length - 1].x.toFixed(1)},${snowBaselineY}`;
    lastSnowCoord = snowCoords[snowCoords.length - 1];
  }

  return (
    <div
      className="sim-chart-card"
      style={{
        padding: '9px 10px',
        borderRadius: 9,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-glass)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        className="sim-chart-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
          }}
        >
          <Activity size={12} color={tempColor} style={{ flexShrink: 0 }} />
          <span>Simülasyon Eğrisi</span>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>
            {currentTemp.toFixed(1)}°C
          </span>
          <span
            className="sim-chart-delta"
            style={{
              padding: '1px 6px',
              borderRadius: 999,
              background: deltaBg,
              color: deltaColor,
              fontSize: 10.5,
            }}
          >
            {deltaLabel}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${TEMP_HEIGHT}`}
        width="100%"
        height={TEMP_HEIGHT}
        role="img"
        aria-label="Simülasyon sıcaklık eğrisi"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={tempGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tempColor} stopOpacity={0.32} />
            <stop offset="100%" stopColor={tempColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {hasZeroLine && (
          <g>
            <line
              x1={PAD_X}
              y1={zeroY}
              x2={CHART_WIDTH - PAD_X}
              y2={zeroY}
              stroke="rgba(186, 230, 253, 0.38)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={PAD_X + 2}
              y={zeroY > 14 ? zeroY - 3 : zeroY + 9}
              fill="rgba(186, 230, 253, 0.78)"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
              fontWeight="600"
            >
              0°C
            </text>
          </g>
        )}

        <polygon points={tempAreaPoints} fill={`url(#${tempGradId})`} />
        <polyline
          points={tempLinePoints}
          fill="none"
          stroke={tempColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle
          cx={lastTempCoord.x}
          cy={lastTempCoord.y}
          r={6}
          fill={tempColor}
          fillOpacity={0.28}
        />
        <circle
          cx={lastTempCoord.x}
          cy={lastTempCoord.y}
          r={3.2}
          fill={tempColor}
          stroke="#0b121e"
          strokeWidth={1.2}
        />
      </svg>

      {showSnowChart && (
        <div
          className="sim-chart-snow"
          style={{
            paddingTop: 6,
            borderTop: '1px solid var(--border-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: '#bae6fd',
              }}
            >
              <Snowflake size={12} color="#bae6fd" style={{ flexShrink: 0 }} />
              <span>Kar Kalınlığı</span>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                color: '#bae6fd',
              }}
            >
              {latestSnowCm.toFixed(1)} cm
            </span>
          </div>

          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${SNOW_HEIGHT}`}
            width="100%"
            height={SNOW_HEIGHT}
            role="img"
            aria-label="Kar kalınlığı eğrisi"
            style={{ display: 'block', overflow: 'visible' }}
          >
            <defs>
              <linearGradient id={snowGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#bae6fd" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#bae6fd" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <polygon points={snowAreaPoints} fill={`url(#${snowGradId})`} />
            <polyline
              points={snowLinePoints}
              fill="none"
              stroke="#bae6fd"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={lastSnowCoord.x}
              cy={lastSnowCoord.y}
              r={5}
              fill="#bae6fd"
              fillOpacity={0.28}
            />
            <circle
              cx={lastSnowCoord.x}
              cy={lastSnowCoord.y}
              r={2.8}
              fill="#bae6fd"
              stroke="#0b121e"
              strokeWidth={1.1}
            />
          </svg>
        </div>
      )}
    </div>
  );
}
