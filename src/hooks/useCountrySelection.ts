import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCountryDetail,
  type CountryDetailData,
} from '../services/countryDetailService';
import type { CountryHoverInfo } from '../services/countryService';

export interface UseCountrySelectionOptions {
  countryMode: boolean;
  onCacheUpdated: () => void;
}

export interface UseCountrySelectionResult {
  selectedCountry: CountryHoverInfo | null;
  selectedCountryBbox: [number, number, number, number] | null;
  countryDetail: CountryDetailData | null;
  countryDetailLoading: boolean;
  selectCountry: (
    info: CountryHoverInfo,
    bbox: [number, number, number, number] | null
  ) => void;
  clearCountrySelection: () => void;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError')
  );
}

export function useCountrySelection(
  options: UseCountrySelectionOptions
): UseCountrySelectionResult {
  const { countryMode, onCacheUpdated } = options;

  const countryAbortRef = useRef<AbortController | null>(null);
  const onCacheUpdatedRef = useRef(onCacheUpdated);
  onCacheUpdatedRef.current = onCacheUpdated;

  const [selectedCountry, setSelectedCountry] =
    useState<CountryHoverInfo | null>(null);
  const [selectedCountryBbox, setSelectedCountryBbox] = useState<
    [number, number, number, number] | null
  >(null);
  const [countryDetail, setCountryDetail] =
    useState<CountryDetailData | null>(null);
  const [countryDetailLoading, setCountryDetailLoading] = useState(false);

  const clearCountrySelection = useCallback(() => {
    countryAbortRef.current?.abort();
    countryAbortRef.current = null;
    setSelectedCountry(null);
    setSelectedCountryBbox(null);
    setCountryDetail(null);
    setCountryDetailLoading(false);
  }, []);

  const selectCountry = useCallback(
    (
      info: CountryHoverInfo,
      bbox: [number, number, number, number] | null
    ) => {
      countryAbortRef.current?.abort();
      const controller = new AbortController();
      countryAbortRef.current = controller;

      setSelectedCountry(info);
      setSelectedCountryBbox(bbox);
      setCountryDetail(null);
      setCountryDetailLoading(true);

      void (async () => {
        try {
          const detail = await fetchCountryDetail(info, controller.signal);
          if (controller.signal.aborted) return;
          setCountryDetail(detail);
          onCacheUpdatedRef.current();
        } catch (err) {
          if (isAbortError(err)) return;
          if (!controller.signal.aborted) {
            setCountryDetail(null);
          }
        } finally {
          if (!controller.signal.aborted) {
            setCountryDetailLoading(false);
          }
        }
      })();
    },
    []
  );

  useEffect(() => {
    if (!countryMode) {
      clearCountrySelection();
    }
  }, [countryMode, clearCountrySelection]);

  useEffect(() => {
    return () => {
      countryAbortRef.current?.abort();
      countryAbortRef.current = null;
    };
  }, []);

  return {
    selectedCountry,
    selectedCountryBbox,
    countryDetail,
    countryDetailLoading,
    selectCountry,
    clearCountrySelection,
  };
}
