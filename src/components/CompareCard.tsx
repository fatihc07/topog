import type { JSX } from 'react';
import { ArrowLeftRight, RefreshCw, X } from 'lucide-react';
import { getWeatherMeta } from '../services/weatherService';
import type { CompareTarget } from '../types/compare';
import { WeatherIcon } from './WeatherIcon';

export interface CompareCardProps {
  first: CompareTarget;
  second: CompareTarget | null;
  onSwap: () => void;
  onClearSecond: () => void;
  onClose: () => void;
}

type DeltaTone = 'pos' | 'neg' | 'equal';

interface MetricRowData {
  key: string;
  label: string;
  firstText: string;
  secondText: string;
  deltaText: string | null;
  deltaTone: DeltaTone | null;
  isSnow?: boolean;
}

const BACK_VOWELS = new Set(['a', 'ı', 'o', 'u']);
const FRONT_VOWELS = new Set(['e', 'i', 'ö', 'ü']);
const VOICELESS_CONSONANTS = new Set(['f', 's', 't', 'k', 'ç', 'ş', 'h', 'p']);

function withTurkishAblative(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;

  const lower = trimmed.toLocaleLowerCase('tr-TR');
  let isFront = false;
  for (let i = lower.length - 1; i >= 0; i--) {
    const ch = lower[i];
    if (FRONT_VOWELS.has(ch)) {
      isFront = true;
      break;
    }
    if (BACK_VOWELS.has(ch)) {
      isFront = false;
      break;
    }
  }

  let lastAlpha = '';
  for (let i = lower.length - 1; i >= 0; i--) {
    const ch = lower[i];
    if (/[a-zçğıöşü]/i.test(ch)) {
      lastAlpha = ch;
      break;
    }
  }

  const consonant = VOICELESS_CONSONANTS.has(lastAlpha) ? 't' : 'd';
  const vowel = isFront ? 'e' : 'a';
  return `${trimmed}'${consonant}${vowel}n`;
}

function buildDelta(
  diff: number,
  formatMagnitude: (val: number) => string
): { text: string; tone: DeltaTone } {
  if (diff === 0) {
    return { text: 'Eşit', tone: 'equal' };
  }
  const sign = diff > 0 ? '+' : '-';
  return {
    text: `${sign}${formatMagnitude(Math.abs(diff))}`,
    tone: diff > 0 ? 'pos' : 'neg',
  };
}

function buildTempVerdict(first: CompareTarget, second: CompareTarget): string {
  const firstTemp = Math.round(first.weather.temperature);
  const secondTemp = Math.round(second.weather.temperature);
  const diff = firstTemp - secondTemp;

  if (diff === 0) {
    return 'İki noktanın sıcaklığı eşit';
  }

  const comparisonTarget = withTurkishAblative(second.weather.cityName);
  const absDiff = Math.abs(diff);
  const relation = diff > 0 ? 'daha sıcak' : 'daha soğuk';
  return `${first.weather.cityName}, ${comparisonTarget} ${absDiff}°C ${relation}`;
}

function formatSnowCell(snowDepthCm: number | null | undefined): string {
  if (typeof snowDepthCm !== 'number') return '—';
  if (snowDepthCm > 0) {
    return `❄ ${snowDepthCm.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} cm`;
  }
  return '0 cm';
}

function renderSummaryColumn(target: CompareTarget, slot: 'first' | 'second'): JSX.Element {
  const { weather, elevationMeters, kind } = target;
  const meta = getWeatherMeta(weather.weatherCode, weather.isDay);

  return (
    <div
      className={`compare-summary-col is-${slot}${kind === 'peak' ? ' is-peak' : ''}`}
    >
      <div className="compare-col-head">
        <div className="compare-col-name" title={weather.cityName}>
          {weather.cityName}
        </div>
        <div className="compare-col-tags">
          {weather.country ? (
            <span className="weather-country-tag">{weather.country}</span>
          ) : null}
          {typeof elevationMeters === 'number' && (
            <span className="peak-country-tag">
              ▲ {Math.round(elevationMeters).toLocaleString('tr-TR')} m
            </span>
          )}
        </div>
      </div>

      <div className="compare-col-weather">
        <div className="compare-col-condition">
          <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} size={24} />
          <span className="compare-col-cond-label">{meta.label}</span>
        </div>
        <span className="compare-col-temp">
          {Math.round(weather.temperature)}°C
        </span>
      </div>
    </div>
  );
}

export function CompareCard({
  first,
  second,
  onSwap,
  onClearSecond,
  onClose,
}: CompareCardProps): JSX.Element {
  if (second === null) {
    const firstTemp = Math.round(first.weather.temperature);
    return (
      <div
        className="glass-panel compare-picker-banner"
        role="region"
        aria-label="Karşılaştırma İçin 2. Konum Seçimi"
      >
        <div className="compare-picker-body">
          <div className="compare-picker-pinned">
            <span className="compare-picker-badge">1. Konum</span>
            <span className="compare-picker-name">{first.weather.cityName}</span>
            {typeof first.elevationMeters === 'number' && (
              <span className="peak-country-tag">
                ▲ {Math.round(first.elevationMeters).toLocaleString('tr-TR')} m
              </span>
            )}
            <span className="compare-picker-temp">{firstTemp}°C</span>
          </div>
          <div className="compare-picker-prompt">
            Karşılaştırmak için haritadan 2. şehir veya dağ seçin
          </div>
        </div>
        <button
          type="button"
          className="icon-btn-inline"
          onClick={onClose}
          aria-label="Karşılaştırmayı İptal Et"
          title="İptal"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  const firstTemp = Math.round(first.weather.temperature);
  const secondTemp = Math.round(second.weather.temperature);
  const tempDelta = buildDelta(firstTemp - secondTemp, (v) => `${v}°`);

  const firstFeels = Math.round(first.weather.apparentTemperature);
  const secondFeels = Math.round(second.weather.apparentTemperature);
  const feelsDelta = buildDelta(firstFeels - secondFeels, (v) => `${v}°`);

  const firstHum = Math.round(first.weather.humidity);
  const secondHum = Math.round(second.weather.humidity);
  const humDelta = buildDelta(firstHum - secondHum, (v) => `${v}%`);

  const firstWind = Math.round(first.weather.windSpeed);
  const secondWind = Math.round(second.weather.windSpeed);
  const windDelta = buildDelta(firstWind - secondWind, (v) => `${v} km/sa`);

  const firstPressure =
    first.weather.pressure !== null ? Math.round(first.weather.pressure) : null;
  const secondPressure =
    second.weather.pressure !== null ? Math.round(second.weather.pressure) : null;
  const pressureDelta =
    firstPressure !== null && secondPressure !== null
      ? buildDelta(firstPressure - secondPressure, (v) => `${v} hPa`)
      : null;

  const rows: MetricRowData[] = [
    {
      key: 'temperature',
      label: 'Sıcaklık',
      firstText: `${firstTemp}°C`,
      secondText: `${secondTemp}°C`,
      deltaText: tempDelta.text,
      deltaTone: tempDelta.tone,
    },
    {
      key: 'apparent',
      label: 'Hissedilen',
      firstText: `${firstFeels}°C`,
      secondText: `${secondFeels}°C`,
      deltaText: feelsDelta.text,
      deltaTone: feelsDelta.tone,
    },
    {
      key: 'humidity',
      label: 'Nem',
      firstText: `%${firstHum}`,
      secondText: `%${secondHum}`,
      deltaText: humDelta.text,
      deltaTone: humDelta.tone,
    },
    {
      key: 'wind',
      label: 'Rüzgar',
      firstText: `${firstWind} km/sa`,
      secondText: `${secondWind} km/sa`,
      deltaText: windDelta.text,
      deltaTone: windDelta.tone,
    },
    {
      key: 'pressure',
      label: 'Basınç',
      firstText: firstPressure !== null ? `${firstPressure} hPa` : '—',
      secondText: secondPressure !== null ? `${secondPressure} hPa` : '—',
      deltaText: pressureDelta ? pressureDelta.text : null,
      deltaTone: pressureDelta ? pressureDelta.tone : null,
    },
  ];

  const hasFirstElev = typeof first.elevationMeters === 'number';
  const hasSecondElev = typeof second.elevationMeters === 'number';
  if (hasFirstElev || hasSecondElev) {
    const firstElev = hasFirstElev ? Math.round(first.elevationMeters as number) : null;
    const secondElev = hasSecondElev ? Math.round(second.elevationMeters as number) : null;
    const elevDelta =
      firstElev !== null && secondElev !== null
        ? buildDelta(firstElev - secondElev, (v) => `${v.toLocaleString('tr-TR')} m`)
        : null;

    rows.push({
      key: 'elevation',
      label: 'Rakım',
      firstText:
        firstElev !== null ? `${firstElev.toLocaleString('tr-TR')} m` : '—',
      secondText:
        secondElev !== null ? `${secondElev.toLocaleString('tr-TR')} m` : '—',
      deltaText: elevDelta ? elevDelta.text : null,
      deltaTone: elevDelta ? elevDelta.tone : null,
    });
  }

  const firstSnow = first.weather.snowDepthCm;
  const secondSnow = second.weather.snowDepthCm;
  const showSnowRow =
    (typeof firstSnow === 'number' && firstSnow > 0) ||
    (typeof secondSnow === 'number' && secondSnow > 0);

  if (showSnowRow) {
    const bothNumericSnow =
      typeof firstSnow === 'number' && typeof secondSnow === 'number';
    const snowDelta = bothNumericSnow
      ? buildDelta(
          Math.round((firstSnow - secondSnow) * 10) / 10,
          (v) => `${v.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} cm`
        )
      : null;

    rows.push({
      key: 'snow',
      label: 'Kar Kalınlığı',
      firstText: formatSnowCell(firstSnow),
      secondText: formatSnowCell(secondSnow),
      deltaText: snowDelta ? snowDelta.text : null,
      deltaTone: snowDelta ? snowDelta.tone : null,
      isSnow: true,
    });
  }

  const verdict = buildTempVerdict(first, second);

  return (
    <div
      className="glass-panel compare-card"
      role="region"
      aria-label="Hava Durumu Karşılaştırma"
    >
      <div className="compare-card-topbar">
        <div className="compare-card-title">
          <ArrowLeftRight size={14} />
          <span>Yan Yana Karşılaştırma</span>
        </div>
        <div className="compare-card-actions">
          <button
            type="button"
            className="compare-action-btn"
            onClick={onSwap}
            title="Yer Değiştir"
            aria-label="Yer Değiştir"
          >
            <ArrowLeftRight size={13} />
          </button>
          <button
            type="button"
            className="compare-action-btn compare-change-btn"
            onClick={onClearSecond}
            title="2. Konumu Değiştir"
            aria-label="2. Konumu Değiştir"
          >
            <RefreshCw size={12} />
            <span>2. Değiştir</span>
          </button>
          <button
            type="button"
            className="icon-btn-inline"
            onClick={onClose}
            aria-label="Kapat"
            title="Kapat"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="compare-summary-grid">
        {renderSummaryColumn(first, 'first')}
        {renderSummaryColumn(second, 'second')}
      </div>

      <div className="compare-metrics-list">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`compare-metric-row${row.isSnow ? ' is-snow' : ''}`}
          >
            <span
              className={`compare-metric-val is-first${row.isSnow ? ' snow' : ''}`}
            >
              {row.firstText}
            </span>

            <div className="compare-metric-center">
              <span className="compare-metric-label">{row.label}</span>
              {row.deltaText !== null && row.deltaTone !== null && (
                <span
                  className={`compare-delta-pill is-${row.deltaTone}`}
                  title={`${first.weather.cityName} − ${second.weather.cityName}`}
                >
                  {row.deltaTone === 'equal' ? row.deltaText : `Δ ${row.deltaText}`}
                </span>
              )}
            </div>

            <span
              className={`compare-metric-val is-second${row.isSnow ? ' snow' : ''}`}
            >
              {row.secondText}
            </span>
          </div>
        ))}
      </div>

      <div className="compare-verdict">{verdict}</div>
    </div>
  );
}
