export type WeatherAnimKind =
  | 'sun'
  | 'moon'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

export function getWeatherAnimKind(
  code: number,
  isDay: boolean
): WeatherAnimKind {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code === 1 || code === 2) {
    return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
  }
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
}

const CLOUD_PATH =
  'M22.5 21H10.5a4.5 4.5 0 0 1-.4-8.98A5.8 5.8 0 0 1 21.3 10.6a4.2 4.2 0 0 1 1.2 10.4Z';

const BACK_CLOUD_PATH =
  'M24.2 17.5H15a3.4 3.4 0 0 1-.2-6.8 4.4 4.4 0 0 1 8.5-.9 3.2 3.2 0 0 1 .9 7.7Z';

export function getAnimatedWeatherSvg(
  code: number,
  isDay: boolean,
  size = 20
): string {
  const kind = getWeatherAnimKind(code, isDay);

  switch (kind) {
    case 'sun':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-sun" aria-hidden="true">
        <g class="wx-sun-rays" stroke="#fbbf24" stroke-width="2" stroke-linecap="round">
          <line x1="16" y1="3" x2="16" y2="6.5" />
          <line x1="16" y1="25.5" x2="16" y2="29" />
          <line x1="3" y1="16" x2="6.5" y2="16" />
          <line x1="25.5" y1="16" x2="29" y2="16" />
          <line x1="6.8" y1="6.8" x2="9.3" y2="9.3" />
          <line x1="22.7" y1="22.7" x2="25.2" y2="25.2" />
          <line x1="25.2" y1="6.8" x2="22.7" y2="9.3" />
          <line x1="9.3" y1="22.7" x2="6.8" y2="25.2" />
        </g>
        <circle cx="16" cy="16" r="5.6" fill="#fbbf24" />
      </svg>`;

    case 'moon':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-moon" aria-hidden="true">
        <path d="M21.5 19.6A8.2 8.2 0 0 1 12.4 10.5a8.2 8.2 0 0 1 1.3-4.4A8.5 8.5 0 1 0 25.9 18.3a8.2 8.2 0 0 1-4.4 1.3Z" fill="#fde68a" />
        <circle class="wx-star wx-star-1" cx="23.5" cy="8.5" r="1.3" fill="#fef08a" />
        <circle class="wx-star wx-star-2" cx="26.5" cy="13" r="1" fill="#fef08a" />
      </svg>`;

    case 'partly-cloudy-day':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-partly" aria-hidden="true">
        <g class="wx-sun-rays" style="transform-origin: 11px 12px" stroke="#fbbf24" stroke-width="1.7" stroke-linecap="round">
          <line x1="11" y1="3.5" x2="11" y2="5.6" />
          <line x1="4.5" y1="12" x2="6.5" y2="12" />
          <line x1="6.4" y1="6.8" x2="7.9" y2="8.3" />
          <line x1="15.6" y1="6.8" x2="14.1" y2="8.3" />
        </g>
        <circle cx="11" cy="12" r="4.2" fill="#fbbf24" />
        <path class="wx-cloud-front" d="${CLOUD_PATH}" fill="#e2e8f0" />
      </svg>`;

    case 'partly-cloudy-night':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-partly" aria-hidden="true">
        <path d="M13.5 13.8A5.2 5.2 0 0 1 8.8 7a5.3 5.3 0 1 0 7.2 7.2 5.2 5.2 0 0 1-2.5-.4Z" fill="#fde68a" />
        <path class="wx-cloud-front" d="${CLOUD_PATH}" fill="#cbd5e1" />
      </svg>`;

    case 'cloudy':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-cloudy" aria-hidden="true">
        <path class="wx-cloud-back" d="${BACK_CLOUD_PATH}" fill="#94a3b8" />
        <path class="wx-cloud-front" d="${CLOUD_PATH}" fill="#e2e8f0" />
      </svg>`;

    case 'fog':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-fog" aria-hidden="true">
        <path class="wx-cloud-front" d="M22.5 18H10.5a4.2 4.2 0 0 1-.4-8.4A5.5 5.5 0 0 1 20.9 8.2a3.9 3.9 0 0 1 1.6 9.8Z" fill="#cbd5e1" />
        <line class="wx-mist-line wx-mist-1" x1="7" y1="22" x2="25" y2="22" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />
        <line class="wx-mist-line wx-mist-2" x1="9" y1="25.5" x2="23" y2="25.5" stroke="#64748b" stroke-width="2" stroke-linecap="round" />
      </svg>`;

    case 'rain':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-rain" aria-hidden="true">
        <path class="wx-cloud-front" d="M22.5 18.5H10.5a4.3 4.3 0 0 1-.4-8.6A5.6 5.6 0 0 1 21 8.5a4 4 0 0 1 1.5 10Z" fill="#cbd5e1" />
        <line class="wx-drop wx-drop-1" x1="11" y1="20.5" x2="9.6" y2="25.5" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
        <line class="wx-drop wx-drop-2" x1="16" y1="20.5" x2="14.6" y2="25.5" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
        <line class="wx-drop wx-drop-3" x1="21" y1="20.5" x2="19.6" y2="25.5" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
      </svg>`;

    case 'snow':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-snow" aria-hidden="true">
        <path class="wx-cloud-front" d="M22.5 18.5H10.5a4.3 4.3 0 0 1-.4-8.6A5.6 5.6 0 0 1 21 8.5a4 4 0 0 1 1.5 10Z" fill="#e2e8f0" />
        <circle class="wx-flake wx-flake-1" cx="11" cy="22" r="1.5" fill="#bae6fd" />
        <circle class="wx-flake wx-flake-2" cx="16" cy="21.5" r="1.6" fill="#ffffff" />
        <circle class="wx-flake wx-flake-3" cx="21" cy="22" r="1.5" fill="#bae6fd" />
      </svg>`;

    case 'storm':
      return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="wx-icon wx-storm" aria-hidden="true">
        <path class="wx-cloud-front" d="M22.5 18H10.5a4.3 4.3 0 0 1-.4-8.6A5.6 5.6 0 0 1 21 8a4 4 0 0 1 1.5 10Z" fill="#94a3b8" />
        <polygon class="wx-bolt" points="16.8,17.5 13.5,23 16.3,23 14.8,28.5 19.6,21.5 16.6,21.5" fill="#fbbf24" />
        <line class="wx-drop wx-drop-1" x1="10.2" y1="20" x2="9" y2="24.5" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" />
        <line class="wx-drop wx-drop-3" x1="22" y1="20" x2="20.8" y2="24.5" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" />
      </svg>`;
  }
}

interface WeatherIconProps {
  code: number;
  isDay: boolean;
  size?: number;
}

export function WeatherIcon({ code, isDay, size = 28 }: WeatherIconProps) {
  return (
    <span
      className="wx-icon-wrap"
      // SVG string is generated exclusively from trusted internal templates
      dangerouslySetInnerHTML={{
        __html: getAnimatedWeatherSvg(code, isDay, size),
      }}
    />
  );
}
