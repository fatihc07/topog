import { useEffect, useRef, useState } from 'react';
import {
  Clock,
  Compass,
  Loader2,
  MapPin,
  Mountain,
  Search,
  Star,
  X,
} from 'lucide-react';
import { FEATURED_LANDMARKS } from '../config/layers';
import { APP_VERSION } from '../config/version';
import type { FavoritePlace } from '../services/favoritesService';
import { searchPlaces } from '../services/geocoding';
import {
  addSearchHistory,
  clearSearchHistory,
  loadSearchHistory,
  removeSearchHistoryItem,
  type SearchHistoryItem,
} from '../services/searchHistoryService';
import type { LandmarkPreset, SearchResult } from '../types/map';

interface SearchBarProps {
  onSelectLandmark: (landmark: LandmarkPreset) => void;
  onSelectSearchResult: (result: SearchResult) => void;
  onOpenReleaseNotes: () => void;
  favorites?: FavoritePlace[];
  onSelectFavorite?: (fav: FavoritePlace) => void;
  onRemoveFavorite?: (id: string) => void;
}

export function SearchBar({
  onSelectLandmark,
  onSelectSearchResult,
  onOpenReleaseNotes,
  favorites,
  onSelectFavorite,
  onRemoveFavorite,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<SearchHistoryItem[]>(() =>
    loadSearchHistory(),
  );
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

  const handleSelectResult = (item: SearchResult) => {
    setHistory(addSearchHistory(item));
    onSelectSearchResult(item);
    setOpen(false);
  };

  const handleClearHistory = () => {
    clearSearchHistory();
    setHistory([]);
    setOpen(false);
  };

  const handleRemoveHistoryItem = (
    e: React.MouseEvent,
    placeId: number,
  ) => {
    e.stopPropagation();
    const next = removeSearchHistoryItem(placeId);
    setHistory(next);
    if (next.length === 0) {
      setOpen(false);
    }
  };

  const trimmedQuery = query.trim();
  const showResultsDropdown = open && trimmedQuery.length >= 2;
  const showHistoryDropdown =
    open && trimmedQuery.length < 2 && history.length > 0;

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
            if (trimmedQuery.length >= 2 && results.length > 0) {
              setOpen(true);
            } else if (trimmedQuery.length < 2 && history.length > 0) {
              setOpen(true);
            }
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

      {showResultsDropdown && (
        <div className="glass-panel search-dropdown">
          {results.length === 0 && !loading ? (
            <div className="search-empty">Sonuç bulunamadı</div>
          ) : (
            results.map((item) => (
              <button
                key={item.place_id}
                type="button"
                className="search-result-item"
                onClick={() => handleSelectResult(item)}
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

      {showHistoryDropdown && (
        <div className="glass-panel search-dropdown">
          <div className="search-history-header">
            <span>Son Aramalar</span>
            <button
              type="button"
              className="search-history-clear"
              onClick={handleClearHistory}
            >
              Temizle
            </button>
          </div>
          {history.map((item) => (
            <div
              key={item.place_id}
              role="button"
              tabIndex={0}
              className="search-result-item search-history-item"
              onClick={() => handleSelectResult(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectResult(item);
                }
              }}
            >
              <Clock
                size={14}
                color="#94a3b8"
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="search-result-title">{item.display_name}</div>
                <div className="search-result-meta">
                  {Number(item.lat).toFixed(4)}°, {Number(item.lon).toFixed(4)}° ·{' '}
                  {item.type}
                </div>
              </div>
              <button
                type="button"
                className="search-history-del"
                onClick={(e) => handleRemoveHistoryItem(e, item.place_id)}
                aria-label="Geçmişten kaldır"
                title="Geçmişten kaldır"
              >
                <X size={13} />
              </button>
            </div>
          ))}
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

      {favorites && favorites.length > 0 && (
        <div
          className="favorites-strip"
          role="list"
          aria-label="Favori yerler"
        >
          {favorites.map((fav) => (
            <div key={fav.id} className="favorite-pill" role="listitem">
              <button
                type="button"
                className="favorite-pill-btn"
                onClick={() => onSelectFavorite?.(fav)}
                title={
                  fav.subtitle ? `${fav.name} — ${fav.subtitle}` : fav.name
                }
              >
                <Star size={11} color="#fbbf24" fill="#fbbf24" />
                <span>{fav.name}</span>
              </button>
              {onRemoveFavorite && (
                <button
                  type="button"
                  className="favorite-pill-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFavorite(fav.id);
                  }}
                  aria-label={`${fav.name} favorilerden kaldır`}
                  title="Favorilerden kaldır"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
