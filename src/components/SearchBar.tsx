import { useEffect, useRef, useState } from 'react';
import { Compass, Loader2, MapPin, Mountain, Search, X } from 'lucide-react';
import { FEATURED_LANDMARKS } from '../config/layers';
import { APP_VERSION } from '../config/version';
import { searchPlaces } from '../services/geocoding';
import type { LandmarkPreset, SearchResult } from '../types/map';

interface SearchBarProps {
  onSelectLandmark: (landmark: LandmarkPreset) => void;
  onSelectSearchResult: (result: SearchResult) => void;
  onOpenReleaseNotes: () => void;
}

export function SearchBar({
  onSelectLandmark,
  onSelectSearchResult,
  onOpenReleaseNotes,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const data = await searchPlaces(trimmed, controller.signal);
        setResults(data);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="top-left-dock" ref={containerRef}>
      <div className="brand-row">
        <div className="brand-pill">
          <Mountain size={15} color="#38bdf8" />
          <span>TOPOG</span>
          <button
            type="button"
            className="version-badge-btn"
            onClick={onOpenReleaseNotes}
            title="Sürüm notlarını görüntüle"
            aria-label={`Sürüm ${APP_VERSION} notlarını aç`}
          >
            {APP_VERSION}
          </button>
        </div>
      </div>

      <div className="glass-panel search-box">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder="Şehir, dağ, nehir veya bölge ara..."
          aria-label="Yer ara"
        />
        {loading && <Loader2 size={15} className="search-icon spin" />}
        {query && !loading && (
          <button
            type="button"
            className="icon-btn-inline"
            onClick={handleClear}
            aria-label="Aramayı temizle"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="glass-panel search-dropdown">
          {results.length === 0 && !loading ? (
            <div className="search-empty">Sonuç bulunamadı</div>
          ) : (
            results.map((item) => (
              <button
                key={item.place_id}
                type="button"
                className="search-result-item"
                onClick={() => {
                  onSelectSearchResult(item);
                  setOpen(false);
                }}
              >
                <MapPin
                  size={15}
                  color="#38bdf8"
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <div className="search-result-title">{item.display_name}</div>
                  <div className="search-result-meta">
                    {Number(item.lat).toFixed(4)}°, {Number(item.lon).toFixed(4)}° ·{' '}
                    {item.type}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <div className="landmark-strip" role="list" aria-label="Öne çıkan yer şekilleri">
        {FEATURED_LANDMARKS.map((lm) => (
          <button
            key={lm.id}
            type="button"
            className="landmark-pill"
            onClick={() => onSelectLandmark(lm)}
            title={lm.region}
          >
            <Compass size={12} color="#38bdf8" />
            <span>{lm.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
