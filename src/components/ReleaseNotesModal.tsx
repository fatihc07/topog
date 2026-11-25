import { useEffect } from 'react';
import { History, MinusCircle, PlusCircle, Sparkles, X } from 'lucide-react';
import { APP_VERSION, RELEASE_NOTES } from '../config/version';

interface ReleaseNotesModalProps {
  onClose: () => void;
}

export function ReleaseNotesModal({ onClose }: ReleaseNotesModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Sürüm Notları"
      onClick={onClose}
    >
      <div
        className="glass-panel release-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="release-modal-header">
          <div className="release-modal-title-wrap">
            <History size={18} color="#38bdf8" />
            <div>
              <h2 className="release-modal-title">Sürüm Notları & Raporlar</h2>
              <p className="release-modal-sub">
                Aktif Sürüm: <strong>{APP_VERSION}</strong> · Küçük ve büyük güncellemeler burada kayıt altına alınır
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn-inline"
            onClick={onClose}
            aria-label="Kapat"
          >
            <X size={17} />
          </button>
        </div>

        <div className="release-modal-body">
          {RELEASE_NOTES.map((entry) => (
            <section key={entry.version} className="release-entry">
              <div className="release-entry-head">
                <span className="release-version-pill">{entry.version}</span>
                <span className="release-date">{entry.date}</span>
              </div>
              <h3 className="release-entry-title">{entry.title}</h3>

              {entry.added.length > 0 && (
                <div className="release-group">
                  <div className="release-group-label is-added">
                    <PlusCircle size={13} />
                    <span>Eklenenler</span>
                  </div>
                  <ul className="release-list">
                    {entry.added.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {entry.changed.length > 0 && (
                <div className="release-group">
                  <div className="release-group-label is-changed">
                    <Sparkles size={13} />
                    <span>Yapılanlar / İyileştirmeler</span>
                  </div>
                  <ul className="release-list">
                    {entry.changed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {entry.removed.length > 0 && (
                <div className="release-group">
                  <div className="release-group-label is-removed">
                    <MinusCircle size={13} />
                    <span>Çıkarılanlar</span>
                  </div>
                  <ul className="release-list">
                    {entry.removed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
