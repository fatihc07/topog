import { useState, useEffect } from 'react';
import {
  Compass,
  LocateFixed,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
} from 'lucide-react';

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  onGeolocate: () => void;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onResetNorth,
  onGeolocate,
}: MapControlsProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen unavailable
    }
  };

  return (
    <div className="glass-panel map-controls-dock" aria-label="Harita kontrolleri">
      <button
        type="button"
        className="control-btn"
        onClick={onZoomIn}
        title="Yakınlaş"
        aria-label="Yakınlaş"
      >
        <Plus size={17} />
      </button>
      <button
        type="button"
        className="control-btn"
        onClick={onZoomOut}
        title="Uzaklaş"
        aria-label="Uzaklaş"
      >
        <Minus size={17} />
      </button>
      <div className="control-divider" />
      <button
        type="button"
        className="control-btn"
        onClick={onResetNorth}
        title="Kuzeye Hizala"
        aria-label="Kuzeye Hizala"
      >
        <Compass size={17} />
      </button>
      <button
        type="button"
        className="control-btn"
        onClick={onGeolocate}
        title="Konumuma Git"
        aria-label="Konumuma Git"
      >
        <LocateFixed size={17} />
      </button>
      <div className="control-divider" />
      <button
        type="button"
        className="control-btn"
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
        aria-label="Tam Ekran"
      >
        {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
      </button>
    </div>
  );
}
