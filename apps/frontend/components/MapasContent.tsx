'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppShell from './AppShell';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { getApiBase } from '../lib/api';

// In-memory geocoding cache
const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

// Error message constant
const GEOCODING_FAILED_MESSAGE =
  'No se pudo ubicar con la información disponible (Estado/Municipio/Dirección)';

// Types
export type PLItem = {
  id: number;
  code: string;
  razon_social?: string | null;
  estado?: string | null;
  municipio?: string | null;
  direccion?: string | null;
  grupo_id?: number | null;
  encargado_actual?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  baja?: boolean | null;
  calibracion?: string | null;
  has_visit_year?: boolean;
};

export type NearbyPLItem = PLItem & {
  distancia_km?: number | null;
};

// Municipality BAJAS (no distance calculation)
export type MunicipioBajaItem = PLItem;

// State BAJAS (no distance calculation)
export type EstadoBajaItem = PLItem;

type Group = {
  id: number;
  name: string;
};

// Dynamic import for Map component (SSR-safe)
const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
        borderRadius: '12px',
      }}
    >
      <div style={{ color: '#6b7280' }}>Cargando mapa...</div>
    </div>
  ),
});

const API = getApiBase();

// Helper function to check if coordinates are valid
// Returns false for null, undefined, or the invalid (0,0) coordinate
function hasValidCoordinates(lat: number | null | undefined, lon: number | null | undefined): boolean {
  return lat != null && lon != null && !(lat === 0 && lon === 0);
}

function getCalibrationBadge(pl: any): { label: string; bg: string } {
  const raw = String(pl?.calibracion ?? pl?.calibracion_status ?? '')
    .trim()
    .toUpperCase();

  // Compat: S/R, Solicitada/Realizada, y variantes cortas
  if (raw === 'S' || raw.startsWith('SOLIC')) {
    return { label: 'Calibración solicitada', bg: '#0ea5e9' };
  }
  if (raw === 'R' || raw.startsWith('REAL')) {
    return { label: 'Calibración realizada', bg: '#16a34a' };
  }

  return { label: 'Sin calibración', bg: '#dc2626' };
}

// Normalize address for better geocoding in MX (remove accents/symbols, trim, uppercase)
function normalizeAddress(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^\w\s,]/g, ' ')       // remove weird chars but keep commas
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Deterministic color hash
function hashColor(key: string | number | null | undefined): string {
  if (!key) return '#94a3b8'; // gray for no group/user

  const str = String(key);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const palette = [
    '#ef4444', // red
    '#f97316', // orange
    '#f59e0b', // amber
    '#84cc16', // lime
    '#10b981', // emerald
    '#14b8a6', // teal
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#6366f1', // indigo
    '#8b5cf6', // violet
    '#a855f7', // purple
    '#ec4899', // pink
  ];

  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

type PLVisualStyle = {
  color: string;
  centerDotColor: string;
  badgeText: string | null;
  badgeVariant: 'baja' | 'unassigned' | 'internal' | 'external' | 'group' | 'default';
};

/**
 * Returns visual styling for a PL based on STRICT priority rules:
 * 1) baja === true → BLACK pin, RED center, "BAJA" badge
 * 2) Group "2000" or "500" → BLUE pin, white center, "Grupo 2000/500" badge
 * 3) Has encargado_actual (non-empty, not N/A) → GREEN pin, white center
 * 4) No encargado_actual (null/empty/N/A) → RED pin, white center
 */
function getPlVisualStyle(
  pl: PLItem | NearbyPLItem,
  groupNameById: Map<number, string>
): PLVisualStyle {
  // Priority 1: BAJA
  if (pl.baja === true) {
    return {
      color: '#000000', // BLACK
      centerDotColor: '#ef4444', // RED
      badgeText: 'BAJA',
      badgeVariant: 'baja',
    };
  }

  // Get group name for priority 2
  const groupName = pl.grupo_id ? groupNameById.get(pl.grupo_id) : null;

  // Priority 2: Group "2000" or "500"
  if (groupName === '2000' || groupName === '500') {
    return {
      color: '#3b82f6', // BLUE
      centerDotColor: '#ffffff', // WHITE
      badgeText: `Grupo ${groupName}`,
      badgeVariant: 'group',
    };
  }

  // Check if encargado_actual is valid (non-empty and not 'N/A')
  const encargadoTrimmed = pl.encargado_actual?.trim() || '';
  const hasEncargado = encargadoTrimmed !== '' && 
                       encargadoTrimmed.toUpperCase() !== 'N/A';

  // Priority 3: Has valid encargado_actual
  if (hasEncargado) {
    return {
      color: '#10b981', // GREEN
      centerDotColor: '#ffffff', // WHITE
      badgeText: null,
      badgeVariant: 'default',
    };
  }

  // Priority 4: No valid encargado_actual
  return {
    color: '#ef4444', // RED
    centerDotColor: '#ffffff', // WHITE
    badgeText: null,
    badgeVariant: 'unassigned',
  };
}

export default function MapasContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(() => searchParams?.get('code') ?? '');
  const [selectedPL, setSelectedPL] = useState<PLItem | null>(null);
  const [nearbyPLs, setNearbyPLs] = useState<NearbyPLItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [focusedPL, setFocusedPL] = useState<NearbyPLItem | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [groupNameById, setGroupNameById] = useState<Map<number, string>>(new Map());
  const [isListOpen, setIsListOpen] = useState(false);
  const [mobileCompactList, setMobileCompactList] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [mapFilterText, setMapFilterText] = useState('');
  const [metricQuickFilter, setMetricQuickFilter] = useState<'all' | 'bajas' | 'visitas' | 'sinAsignar' | '2000' | '500'>('all');
  const [listCalFilter, setListCalFilter] = useState<'all' | 'sinCal'>('all');
  const [visitYearSet, setVisitYearSet] = useState<Set<number>>(new Set());

  const searchRequestIdRef = useRef(0);
  const nearbyRequestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchedValueRef = useRef<string>('');
  const visitCheckedRef = useRef<Set<number>>(new Set());

  // Fetch group catalog from API
  const fetchGroupCatalog = useCallback(async () => {
    try {
      const response = await fetch(`${API}/codes/groups`, { credentials: 'include' });
      if (response.ok) {
        const groups = await response.json();
        const groupMap = new Map<number, string>();
        if (Array.isArray(groups)) {
          groups.forEach((group: Group) => {
            if (group.id != null && group.name) {
              groupMap.set(group.id, group.name);
            }
          });
        }
        setGroupNameById(groupMap);
      } else {
        console.error(`Error fetching group catalog: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('Error fetching group catalog (network error):', err);
    }
  }, []);

  // Fetch group catalog on mount
  useEffect(() => {
    fetchGroupCatalog();
  }, [fetchGroupCatalog]);

  // Check if PLs have visits in the current calendar year
  const checkVisitsThisYear = useCallback(async (pls: PLItem[]) => {
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const yearEnd = `${now.getFullYear()}-12-31`;

    // Only check PLs not already checked
    const unchecked = pls.filter((pl) => !visitCheckedRef.current.has(pl.id));
    if (unchecked.length === 0) return;

    // Mark as checked to avoid duplicate requests
    unchecked.forEach((pl) => visitCheckedRef.current.add(pl.id));

    // Fetch visits per PL (individual calls, batched with Promise.allSettled)
    const newHits: number[] = [];
    await Promise.allSettled(
      unchecked.map(async (pl) => {
        try {
          const res = await fetch(
            `${API}/codes/${pl.id}/visits?from=${yearStart}&to=${yearEnd}&limit=1`,
            { credentials: 'include' }
          );
          if (!res.ok) return;
          const data = await res.json();
          const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
          if (items.length > 0) {
            newHits.push(pl.id);
          }
        } catch {
          // ignore network errors for visit check
        }
      })
    );

    if (newHits.length > 0) {
      setVisitYearSet((prev) => {
        const next = new Set(prev);
        newHits.forEach((id) => next.add(id));
        return next;
      });
    }
  }, []);

  // Effect: check visits when PLs change
  useEffect(() => {
    const allPLs: PLItem[] = [];
    if (selectedPL) allPLs.push(selectedPL);
    nearbyPLs.forEach((pl) => allPLs.push(pl));
    if (allPLs.length > 0) {
      checkVisitsThisYear(allPLs);
    }
  }, [selectedPL, nearbyPLs, checkVisitsThisYear]);

  // Geocode address using Google Geocoding API (robust for MX)
  const geocodeAddress = useCallback(
    async (
      estado: string | null | undefined,
      municipio: string | null | undefined,
      direccion: string | null | undefined,
      requestId: number
    ): Promise<{ lat: number; lon: number } | null> => {
      if (!estado && !municipio && !direccion) return null;

      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        console.error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured');
        return null;
      }

      const geocodeQuery = async (rawQuery: string): Promise<{ lat: number; lon: number } | null> => {
        const query = normalizeAddress(rawQuery);

        // Cache key includes query + region/language to avoid mismatches
        const cacheKey = `mx|es|${query}`;
        if (geocodeCache.has(cacheKey)) {
          return geocodeCache.get(cacheKey) || null;
        }

        try {
          const url =
            `https://maps.googleapis.com/maps/api/geocode/json` +
            `?address=${encodeURIComponent(query)}` +
            `&region=mx&language=es&key=${apiKey}`;

          const res = await fetch(url);

          if (requestId !== searchRequestIdRef.current) return null;

          if (!res.ok) {
            geocodeCache.set(cacheKey, null);
            return null;
          }

          const data = await res.json();

          if (process.env.NODE_ENV === 'development') {
            console.log('[MapasContent] Geocode query:', query);
            console.log('[MapasContent] Geocode status:', data?.status);
          }

          if (data.status === 'OK' && data.results && data.results.length > 0) {
            const location = data.results[0].geometry.location;
            const result = { lat: location.lat, lon: location.lng };
            geocodeCache.set(cacheKey, result);
            return result;
          }

          // Cache negative result to avoid repeats
          geocodeCache.set(cacheKey, null);
          return null;
        } catch (err) {
          console.error('Geocoding error:', err);
          return null;
        }
      };

      // Strategy 1: direccion + municipio + estado
      const parts1: string[] = [];
      if (direccion) parts1.push(direccion);
      if (municipio) parts1.push(municipio);
      if (estado) parts1.push(estado);
      parts1.push('Mexico');
      const query1 = parts1.join(', ');

      let result = await geocodeQuery(query1);
      if (result) return result;
      if (requestId !== searchRequestIdRef.current) return null;

      // Strategy 2: municipio + estado
      if (municipio && estado) {
        const query2 = `${municipio}, ${estado}, Mexico`;
        result = await geocodeQuery(query2);
        if (result) return result;
        if (requestId !== searchRequestIdRef.current) return null;
      }

      // Strategy 3: estado
      if (estado) {
        const query3 = `${estado}, Mexico`;
        result = await geocodeQuery(query3);
        if (result) return result;
      }

      return null;
    },
    []
  );

  // Fetch PL details - core search function
  const searchPL = useCallback(
    async (plCode: string) => {
      // The database stores full codes like 'PL/5488/EXP/ES/2015'
      // We only trim whitespace, no other normalization
      const trimmedCode = plCode.trim();

      if (!plCode || !trimmedCode) {
        setSelectedPL(null);
        setNearbyPLs([]);
        setError(!plCode ? null : 'Código PL inválido');
        return;
      }

      // Prevent duplicate auto-searches
      if (lastSearchedValueRef.current === trimmedCode) return;
      lastSearchedValueRef.current = trimmedCode;

      const currentRequestId = ++searchRequestIdRef.current;

      setLoading(true);
      setError(null);
      setSelectedPL(null);
      setNearbyPLs([]);
      setFocusedPL(null);

      try {
        // Use the same endpoint as the working search (HomeInner.tsx)
        // This endpoint accepts the full code format: 'PL/5488/EXP/ES/2015'
        const plRes = await fetch(
          `${API}/codes/by-code?code=${encodeURIComponent(trimmedCode)}`,
          { credentials: 'include' }
        );

        if (currentRequestId !== searchRequestIdRef.current) return;

        if (plRes.status === 404) {
          setError('PL no encontrado');
          setLoading(false);
          lastSearchedValueRef.current = '';
          return;
        }

        if (!plRes.ok) {
          setError('Error al buscar el PL');
          setLoading(false);
          lastSearchedValueRef.current = '';
          return;
        }

        const plRaw = await plRes.json();
        if (currentRequestId !== searchRequestIdRef.current) return;

        // Map backend {lat, lon} -> UI {latitud, longitud}
        const plData: PLItem = {
          ...plRaw,
          latitud: plRaw.lat ?? plRaw.latitud ?? null,
          longitud: plRaw.lon ?? plRaw.longitud ?? null,
          baja: plRaw.baja ?? null,
        };

        let plWithCoords = plData;

        // If PL has no coordinates or invalid coordinates (0,0), try to geocode
        if (!hasValidCoordinates(plData.latitud, plData.longitud)) {
          setGeocoding(true);
          const geocoded = await geocodeAddress(
            plData.estado,
            plData.municipio,
            plData.direccion,
            currentRequestId
          );
          setGeocoding(false);

          if (currentRequestId !== searchRequestIdRef.current) return;

          if (geocoded) {
            plWithCoords = {
              ...plData,
              latitud: geocoded.lat,
              longitud: geocoded.lon,
            };
            setSelectedPL(plWithCoords);
          } else {
            // Geocoding failed, but still show PL
            // MapComponent will try geocoding again
            setSelectedPL(plData);
          }
        } else {
          setSelectedPL(plWithCoords);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error searching PL:', err);
        if (searchRequestIdRef.current === currentRequestId) {
          setError('Error de conexión al buscar el PL');
          setLoading(false);
          lastSearchedValueRef.current = '';
        }
      }
    },
    [geocodeAddress]
  );

  // Button/Enter search: always search current input
  const handleSearch = useCallback(() => {
    if (!searchInput) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    lastSearchedValueRef.current = '';
    searchPL(searchInput);
  }, [searchInput, searchPL]);

  // Auto-search on debounce
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (!searchInput) {
      setSelectedPL(null);
      setNearbyPLs([]);
      setError(null);
      lastSearchedValueRef.current = '';
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      searchPL(searchInput);
    }, 500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchInput, searchPL]);

  // Auto-search when arriving from ?code= param (e.g. from Home "Ver en Mapa")
  const autoSearchedRef = useRef(false);
  useEffect(() => {
    const codeParam = searchParams?.get('code');
    if (codeParam && !autoSearchedRef.current) {
      autoSearchedRef.current = true;
      setSearchInput(codeParam);
      searchPL(codeParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset metric quick-filter when changing target PL
  useEffect(() => {
    setMetricQuickFilter('all');
    setListCalFilter('all');
  }, [selectedPL?.id]);

  // Reset cal sub-filter when metric filter changes
  useEffect(() => {
    setListCalFilter('all');
  }, [metricQuickFilter]);

  // Effect 2: Load Nearby PLs whenever selectedPL.code or radiusKm changes
  useEffect(() => {
    if (!selectedPL?.code) {
      setNearbyPLs([]);
      setLoadingNearby(false);
      return;
    }

    const abortController = new AbortController();
    const currentRequestId = ++nearbyRequestIdRef.current;
    setLoadingNearby(true);

    const fetchNearbyPLs = async () => {
      try {
        console.log("Radio enviado:", radiusKm);

        const maxPins = radiusKm <= 50 ? 300 : 200;
        let url = `${API}/codes/pl/nearby?code=${encodeURIComponent(selectedPL.code)}&radiusKm=${radiusKm}&limit=${maxPins}`;
        url += `&includeBajas=true&bajasMunicipio=false&bajasEstado=false`;
        
        const nearbyRes = await fetch(
          url,
          { credentials: 'include', signal: abortController.signal }
        );

        if (currentRequestId !== nearbyRequestIdRef.current) return;
        if (abortController.signal.aborted) return;

        if (nearbyRes.ok) {
          const nearbyRaw = await nearbyRes.json();
          
          if (currentRequestId !== nearbyRequestIdRef.current) return;
          if (abortController.signal.aborted) return;

          const nearbyList: any[] = Array.isArray(nearbyRaw?.nearby)
            ? nearbyRaw.nearby
            : Array.isArray(nearbyRaw)
              ? nearbyRaw
              : [];

          console.log("PLs recibidos:", nearbyList.length);

          // Extract total count from response
          const count = nearbyRaw?.count ?? null;
          setTotalCount(count);

          // Map fields with compatibility for lat/lon vs latitud/longitud
          const nearbyData: NearbyPLItem[] = nearbyList.map((item: any) => ({
            ...item,
            latitud: item.lat ?? item.latitud ?? null,
            longitud: item.lon ?? item.longitud ?? null,
            distancia_km: item.distanceKm ?? item.distancia_km ?? null,
            baja: item.baja ?? false,
          }));

          setNearbyPLs(nearbyData);
        } else {
          setNearbyPLs([]);
          setTotalCount(null);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        console.error('Error loading nearby PLs:', err);
        setNearbyPLs([]);
        setTotalCount(null);
      } finally {
        if (currentRequestId === nearbyRequestIdRef.current) {
          setLoadingNearby(false);
        }
      }
    };

    fetchNearbyPLs();

    return () => {
      abortController.abort();
    };
  }, [selectedPL?.code, radiusKm]);

  // Color mapping for PLs
  const plColors = useMemo(() => {
    const colors = new Map<number, string>();

    if (selectedPL) {
      const key = selectedPL.grupo_id || selectedPL.encargado_actual || selectedPL.id;
      colors.set(selectedPL.id, hashColor(key));
    }

    nearbyPLs.forEach((pl) => {
      const key = pl.grupo_id || pl.encargado_actual || pl.id;
      colors.set(pl.id, hashColor(key));
    });

    return colors;
  }, [selectedPL, nearbyPLs]);

  // Helper: normalize text for filtering (remove accents, lowercase)
  const normalizeFilter = useCallback((text: string) => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }, []);

  // Filter nearby PLs by map filter text
  const nearbyPLsFiltered = useMemo(() => {
    if (!mapFilterText.trim()) return nearbyPLs;
    const q = normalizeFilter(mapFilterText);
    return nearbyPLs.filter((pl) => {
      const fields = [
        pl.code,
        pl.razon_social,
        pl.municipio,
        pl.estado,
        pl.encargado_actual,
        pl.grupo_id != null ? (groupNameById.get(pl.grupo_id) ?? String(pl.grupo_id)) : null,
      ];
      return fields.some((f) => f && normalizeFilter(String(f)).includes(q));
    });
  }, [nearbyPLs, mapFilterText, groupNameById, normalizeFilter]);

  const isGroupMatch = useCallback(
    (pl: NearbyPLItem, group: '2000' | '500') => {
      const gn = pl.grupo_id ? groupNameById.get(pl.grupo_id) : null;
      return gn === group;
    },
    [groupNameById],
  );

  // Visible list can be narrowed by metric click
  const nearbyPLsVisible = useMemo(() => {
    if (metricQuickFilter === 'all') return nearbyPLsFiltered;
    if (metricQuickFilter === '2000' || metricQuickFilter === '500') {
      return nearbyPLsFiltered.filter((pl) => isGroupMatch(pl, metricQuickFilter));
    }
    if (metricQuickFilter === 'bajas') {
      return nearbyPLsFiltered.filter((pl) => pl.baja === true);
    }
    if (metricQuickFilter === 'visitas') {
      return nearbyPLsFiltered.filter((pl) => visitYearSet.has(pl.id));
    }
    if (metricQuickFilter === 'sinAsignar') {
      return nearbyPLsFiltered.filter((pl) => {
        const enc = pl.encargado_actual?.trim() || '';
        return enc === '' || enc.toUpperCase() === 'N/A';
      });
    }
    return nearbyPLsFiltered;
  }, [nearbyPLsFiltered, metricQuickFilter, isGroupMatch, visitYearSet]);

  // Map pins follow same visible subset when metric filter is active
  const mapPins = useMemo(() => {
    return nearbyPLsVisible;
  }, [nearbyPLsVisible]);

  // Quick metrics
  const metrics = useMemo(() => {
    const allVisible = nearbyPLsFiltered;
    const bajasVisible = allVisible.filter((pl) => pl.baja === true).length;
    const conVisitas = allVisible.filter((pl) => visitYearSet.has(pl.id)).length;
    const sinAsignar = allVisible.filter((pl) => {
      const enc = pl.encargado_actual?.trim() || '';
      return enc === '' || enc.toUpperCase() === 'N/A';
    }).length;
    const grupo2000 = allVisible.filter((pl) => isGroupMatch(pl, '2000')).length;
    const grupo500 = allVisible.filter((pl) => isGroupMatch(pl, '500')).length;
    return {
      visibles: allVisible.length,
      bajasVisible,
      conVisitas,
      sinAsignar,
      grupo2000,
      grupo500,
    };
  }, [nearbyPLsFiltered, visitYearSet, isGroupMatch]);

  const handlePLClick = useCallback((pl: NearbyPLItem) => {
    setFocusedPL(pl);
  }, []);

  const drawerPLs = useMemo(() => {
    if (listCalFilter === 'sinCal') {
      return nearbyPLsVisible.filter((pl) => {
        const cal = String((pl as any).calibracion ?? '').trim().toUpperCase();
        return !cal || (cal !== 'S' && cal !== 'R');
      });
    }
    return nearbyPLsVisible;
  }, [nearbyPLsVisible, listCalFilter]);

  const sinCalCount = useMemo(
    () =>
      nearbyPLsVisible.filter((pl) => {
        const cal = String((pl as any).calibracion ?? '').trim().toUpperCase();
        return !cal || (cal !== 'S' && cal !== 'R');
      }).length,
    [nearbyPLsVisible]
  );

  const handleExportPdf = useCallback(() => {
    if (!selectedPL) return;

    const rows = drawerPLs;
    const now = new Date();
    const groupSuffix = metricQuickFilter === '2000' || metricQuickFilter === '500' ? ` · Grupo ${metricQuickFilter}` : '';
    const calSuffix = listCalFilter === 'sinCal' ? ' · Sin calibración' : '';
    const title = `Reporte mapa - ${selectedPL.code}${groupSuffix}${calSuffix}`;
    const uniqueMunicipios = Array.from(
      new Set(rows.map((pl) => [pl.municipio, pl.estado].filter(Boolean).join(', ')).filter(Boolean))
    ).sort();
    const municipiosLine = uniqueMunicipios.length
      ? `Municipios: ${uniqueMunicipios.join(' · ')}`
      : '';
    const sub = `Generado: ${now.toLocaleString()} · Total: ${rows.length}`;

    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const htmlRows = rows
      .map((pl) => {
        const calLabel = getCalibrationBadge(pl).label;
        const enc = pl.encargado_actual?.trim() || 'SIN ASIGNAR';
        const dist = pl.distancia_km != null ? `${pl.distancia_km.toFixed(2)} km` : 'N/D';
        return `<tr>
          <td>${escapeHtml(pl.code || '')}</td>
          <td>${escapeHtml(pl.razon_social || 'Sin razón social')}</td>
          <td>${escapeHtml(enc)}</td>
          <td>${escapeHtml(calLabel)}</td>
          <td>${escapeHtml(dist)}</td>
        </tr>`;
      })
      .join('');

    const w = window.open('', '_blank');
    if (!w) return;

    w.document.write(`<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  body{font-family:Arial,sans-serif;padding:20px;color:#111}
  h1{font-size:18px;margin:0 0 6px}
  p{margin:0 0 14px;color:#555;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #ddd;padding:6px;text-align:left}
  th{background:#f3f4f6}
  #back-btn{
    display:inline-flex;align-items:center;gap:6px;
    margin-bottom:16px;padding:8px 16px;
    background:#111827;color:#fff;border:none;border-radius:8px;
    font-size:13px;font-weight:600;cursor:pointer;
  }
  @media print { #back-btn { display:none; } }
</style></head>
<body>
  <button id="back-btn" onclick="window.close()">← Regresar a la app</button>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(sub)}</p>
  ${municipiosLine ? `<p style="margin:0 0 14px;font-size:12px;color:#374151"><strong>Municipios:</strong> ${escapeHtml(uniqueMunicipios.join(' · '))}</p>` : ''}
  <table>
    <thead><tr><th>PL</th><th>Razón social</th><th>Usuario</th><th>Calibración</th><th>Distancia</th></tr></thead>
    <tbody>${htmlRows}</tbody>
  </table>
  <script>window.onload=()=>window.print();</script>
</body></html>`);
    w.document.close();
  }, [drawerPLs, nearbyPLsVisible, selectedPL, metricQuickFilter, listCalFilter]);

  const getSearchButtonText = () => {
    if (!loading) return 'Buscar';
    return geocoding ? 'Geocodificando...' : 'Buscando...';
  };

  // Check if selectedPL has valid coordinates (not null and not 0,0)
  const hasSelectedCoords =
    selectedPL != null && hasValidCoordinates(selectedPL.latitud, selectedPL.longitud);

  return (
    <AppShell title="Mapas" subtitle="Visualización de códigos postales" darkMode={true}>
      <div className="mapas-container">
        {/* Back button — only shown when arriving via ?code= from Home */}
        {searchParams?.get('code') && (
          <button
            type="button"
            onClick={() => router.push(`/?code=${encodeURIComponent(searchParams!.get('code')!)}`)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: '#94a3b8',
              cursor: 'pointer',
              alignSelf: 'flex-start',
              letterSpacing: '0.02em',
            }}
          >
            ← Regresar a la búsqueda
          </button>
        )}

        {/* Search Bar */}
        <div className="mapas-search-bar">
          <input
            type="text"
            className="mapas-search-input"
            placeholder="Buscar PL (ej: PL/5488/EXP/ES/2015)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="mapas-search-btn" onClick={handleSearch} disabled={loading || geocoding}>
            {getSearchButtonText()}
          </button>
          <div className="mapas-radius-control">
            <label>Radio:</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[5, 10, 25, 50, 100, 200].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusKm(r)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: radiusKm === r ? '1px solid #00ffa3' : '1px solid rgba(255,255,255,0.08)',
                    background: radiusKm === r ? 'rgba(0,255,163,0.12)' : 'rgba(255,255,255,0.04)',
                    color: radiusKm === r ? '#00ffa3' : '#94a3b8',
                    fontWeight: radiusKm === r ? '700' : '500',
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    minWidth: '52px',
                    textAlign: 'center',
                  }}
                >
                  {r} km
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* PL location tag */}
        {selectedPL && (selectedPL.municipio || selectedPL.estado) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: '#94a3b8',
            padding: '6px 12px',
            background: 'rgba(0,255,163,0.06)',
            border: '1px solid rgba(0,255,163,0.25)',
            borderRadius: 8,
            alignSelf: 'flex-start',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
            <span style={{ fontWeight: 700, color: '#00ffa3' }}>
              {[selectedPL.municipio, selectedPL.estado].filter(Boolean).join(', ')}
            </span>
          </div>
        )}

        {/* Quick Metrics Bar */}
        {selectedPL && (
          <div className="mapas-metrics-bar">
            <button type="button" className="mapas-metric-item" onClick={() => setMetricQuickFilter('all')} style={{ cursor: 'pointer', border: metricQuickFilter === 'all' ? '2px solid #111827' : undefined, borderRadius: '10px' }}>
              <span className="mapas-metric-value">{metrics.visibles}</span>
              <span className="mapas-metric-label">Visibles</span>
            </button>
            <button type="button" className="mapas-metric-item" onClick={() => setMetricQuickFilter((v) => (v === 'bajas' ? 'all' : 'bajas'))} style={{ cursor: 'pointer', border: metricQuickFilter === 'bajas' ? '2px solid #111827' : undefined, borderRadius: '10px' }}>
              <span className="mapas-metric-value">{metrics.bajasVisible}</span>
              <span className="mapas-metric-label">Bajas</span>
            </button>
            <button type="button" className="mapas-metric-item" onClick={() => setMetricQuickFilter((v) => (v === 'visitas' ? 'all' : 'visitas'))} style={{ cursor: 'pointer', border: metricQuickFilter === 'visitas' ? '2px solid #8b5cf6' : undefined, borderRadius: '10px', background: metricQuickFilter === 'visitas' ? '#f5f3ff' : undefined }}>
              <span className="mapas-metric-value" style={{ color: '#8b5cf6' }}>{metrics.conVisitas}</span>
              <span className="mapas-metric-label">Con visitas (año)</span>
            </button>
            <button type="button" className="mapas-metric-item" onClick={() => setMetricQuickFilter((v) => (v === 'sinAsignar' ? 'all' : 'sinAsignar'))} style={{ cursor: 'pointer', border: metricQuickFilter === 'sinAsignar' ? '2px solid #ef4444' : undefined, borderRadius: '10px', background: metricQuickFilter === 'sinAsignar' ? '#fff1f2' : undefined }}>
              <span className="mapas-metric-value" style={{ color: '#ef4444' }}>{metrics.sinAsignar}</span>
              <span className="mapas-metric-label">Sin asignar</span>
            </button>
            <button
              type="button"
              className="mapas-metric-item"
              onClick={() => {
                setMetricQuickFilter('2000');
                setIsListOpen(true);
              }}
              style={{
                cursor: 'pointer',
                border: metricQuickFilter === '2000' ? '2px solid #3b82f6' : undefined,
                borderRadius: '10px',
                background: metricQuickFilter === '2000' ? '#eff6ff' : undefined,
              }}
              title="Filtrar lista por Grupo 2000"
            >
              <span className="mapas-metric-value" style={{ color: '#3b82f6' }}>{metrics.grupo2000}</span>
              <span className="mapas-metric-label">Grupo 2000</span>
            </button>
            <button
              type="button"
              className="mapas-metric-item"
              onClick={() => {
                setMetricQuickFilter('500');
                setIsListOpen(true);
              }}
              style={{
                cursor: 'pointer',
                border: metricQuickFilter === '500' ? '2px solid #3b82f6' : undefined,
                borderRadius: '10px',
                background: metricQuickFilter === '500' ? '#eff6ff' : undefined,
              }}
              title="Filtrar lista por Grupo 500"
            >
              <span className="mapas-metric-value" style={{ color: '#3b82f6' }}>{metrics.grupo500}</span>
              <span className="mapas-metric-label">Grupo 500</span>
            </button>
          </div>
        )}

        {/* Map Filter Search */}
        {selectedPL && nearbyPLs.length > 0 && (
          <div className="mapas-filter-bar">
            <input
              type="text"
              className="mapas-filter-input"
              placeholder="Filtrar en mapa: código, razón social, municipio, estado, encargado, grupo…"
              value={mapFilterText}
              onChange={(e) => setMapFilterText(e.target.value)}
            />
            {mapFilterText && (
              <button
                className="mapas-filter-clear"
                onClick={() => setMapFilterText('')}
                aria-label="Limpiar filtro"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="mapas-main-content">
          {/* Map */}
          <div className="mapas-map-container">
            {error && !selectedPL && (
              <div className="mapas-error">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p>{error}</p>
              </div>
            )}

            {!selectedPL && !error && !loading && (
              <div className="mapas-empty">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2" />
                </svg>
                <p>Busca un PL para visualizar en el mapa</p>
              </div>
            )}

            {selectedPL && (
              <MapComponent
                selectedPL={selectedPL}
                nearbyPLs={mapPins}
                plColors={plColors}
                focusedPL={focusedPL}
                radiusKm={radiusKm}
                groupNameById={groupNameById}
                visitYearSet={visitYearSet}
                metricQuickFilter={metricQuickFilter}
              />
            )}

            {selectedPL && !hasSelectedCoords && error && (
              <div
                className="mapas-geocoding-notice"
                style={{
                  position: 'absolute',
                  bottom: '20px',
                  left: '20px',
                  right: '20px',
                  background: 'rgba(254, 242, 242, 0.95)',
                  padding: '12px',
                  borderRadius: '8px',
                  color: '#991b1b',
                  fontSize: '14px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  pointerEvents: 'none',
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Side Panel */}
          <div className="mapas-sidebar">
            {selectedPL && (() => {
              const selectedVisualStyle = getPlVisualStyle(selectedPL, groupNameById);
              
              return (
                <>
                  <div className="mapas-sidebar-header">
                    <h3>PL Seleccionado</h3>
                    <div 
                      className="mapas-pl-card mapas-pl-selected"
                      style={{ 
                        opacity: selectedPL.baja ? 0.85 : 1,
                        borderLeft: `4px solid ${selectedVisualStyle.color}`
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
                        <div className="mapas-pl-code">{selectedPL.code}</div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '10px',
                            fontWeight: '700',
                            padding: '3px 6px',
                            borderRadius: '3px',
                            backgroundColor: selectedPL.baja === true ? '#000000' : '#10b981',
                            color: selectedPL.baja === true ? '#ef4444' : 'white',
                            textTransform: 'uppercase',
                            letterSpacing: '0.3px',
                          }}>
                            {selectedPL.baja === true ? 'BAJA' : 'ACTIVA'}
                          </span>
                          {selectedVisualStyle.badgeText && (
                            <span style={{
                              fontSize: '10px',
                              fontWeight: '700',
                              padding: '3px 6px',
                              borderRadius: '3px',
                              backgroundColor: selectedVisualStyle.color,
                              color: 'white',
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                            }}>
                              {selectedVisualStyle.badgeText}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mapas-pl-name">{selectedPL.razon_social || 'Sin nombre'}</div>
                      {selectedPL.direccion && (
                        <div className="mapas-pl-address">{selectedPL.direccion}</div>
                      )}
                      <div className="mapas-pl-location">
                        {selectedPL.municipio}, {selectedPL.estado}
                      </div>
                      {selectedPL.grupo_id && (
                        <div className="mapas-pl-meta">Grupo: {groupNameById.get(selectedPL.grupo_id) ?? selectedPL.grupo_id}</div>
                      )}
                      {selectedPL.encargado_actual && (
                        <div className="mapas-pl-meta">Encargado: {selectedPL.encargado_actual}</div>
                      )}
                    </div>
                  </div>

                  {loadingNearby && (
                    <>
                      <div className="mapas-sidebar-divider" />
                      <div className="mapas-sidebar-section">
                        <h3 style={{ color: '#6b7280' }}>Buscando cercanos…</h3>
                      </div>
                    </>
                  )}

                  {!loadingNearby && nearbyPLsVisible.length > 0 && (
                  <>
                    <div className="mapas-sidebar-divider" />
                    <div className="mapas-sidebar-section">
                      <h3>
                        PLs Cercanos ({nearbyPLsVisible.length}{totalCount !== null ? ` / ${totalCount}` : ''})
                        {metricQuickFilter === '2000' || metricQuickFilter === '500' ? ` · Grupo ${metricQuickFilter}` : ''}
                      </h3>
                      {radiusKm >= 100 && (
                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                          Radio grande: mostrando los primeros 200 pines
                        </div>
                      )}
                      <div className="mapas-pl-list">
                        {nearbyPLsVisible.map((pl) => {
                          const visualStyle = getPlVisualStyle(pl, groupNameById);
                          
                          return (
                            <div
                              key={pl.id}
                              className={`mapas-pl-item ${
                                focusedPL?.id === pl.id ? 'mapas-pl-focused' : ''
                              }`}
                              onClick={() => handlePLClick(pl)}
                              style={{ opacity: pl.baja ? 0.85 : 1 }}
                            >
                              <div
                                className="mapas-pl-chip"
                                style={{ 
                                  backgroundColor: visualStyle.color,
                                }}
                              />
                              <div className="mapas-pl-item-content">
                                <div className="mapas-pl-item-header">
                                  <span className="mapas-pl-item-code">{pl.code}</span>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    {pl.distancia_km != null && (
                                      <span className="mapas-pl-distance">
                                        {pl.distancia_km.toFixed(2)} km
                                      </span>
                                    )}
                                    <span style={{
                                      fontSize: '10px',
                                      fontWeight: '700',
                                      padding: '3px 6px',
                                      borderRadius: '3px',
                                      backgroundColor: pl.baja === true ? '#000000' : '#10b981',
                                      color: pl.baja === true ? '#ef4444' : 'white',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.3px',
                                    }}>
                                      {pl.baja === true ? 'BAJA' : 'ACTIVA'}
                                    </span>
                                    {(() => {
                                      const cal = getCalibrationBadge(pl);
                                      return (
                                        <span style={{
                                          fontSize: '10px',
                                          fontWeight: '700',
                                          padding: '3px 6px',
                                          borderRadius: '3px',
                                          backgroundColor: cal.bg,
                                          color: 'white',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.3px',
                                        }}>
                                          {cal.label}
                                        </span>
                                      );
                                    })()}
                                    {visualStyle.badgeText && (
                                      <span style={{
                                        fontSize: '10px',
                                        fontWeight: '700',
                                        padding: '3px 6px',
                                        borderRadius: '3px',
                                        backgroundColor: visualStyle.color,
                                        color: 'white',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.3px',
                                      }}>
                                        {visualStyle.badgeText}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="mapas-pl-item-name">{pl.razon_social || 'Sin nombre'}</div>
                                <div className="mapas-pl-item-location">
                                  {pl.municipio}, {pl.estado}
                                </div>
                                {pl.grupo_id && (
                                  <div className="mapas-pl-item-meta"><strong>Grupo:</strong> {groupNameById.get(pl.grupo_id) ?? pl.grupo_id}</div>
                                )}
                                {pl.encargado_actual && (
                                  <div className="mapas-pl-item-meta"><strong>Encargado:</strong> {pl.encargado_actual}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {!selectedPL && (
            <div className="mapas-sidebar-empty">
              <p>Selecciona un PL para ver detalles</p>
            </div>
          )}
        </div>
        </div>

        {/* Mobile: "Ver lista" Button - Only shown on mobile/tablet */}
        {selectedPL && (
          <button 
            className="mapas-mobile-list-btn"
            onClick={() => setIsListOpen(true)}
          >
            Ver lista ({nearbyPLsVisible.length > 0 ? nearbyPLsVisible.length + 1 : 1})
          </button>
        )}

        {/* Mobile: Drawer/Overlay for Cards */}
        {isListOpen && (
          <div className="mapas-drawer-overlay" onClick={() => setIsListOpen(false)}>
            <div className="mapas-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="mapas-drawer-header">
                <h3>PLs en el mapa</h3>
                <button 
                  className="mapas-drawer-close"
                  onClick={() => setIsListOpen(false)}
                  aria-label="Cerrar"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M18 6L6 18M6 6l12 12"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              
              <div className="mapas-drawer-content">
                {selectedPL && (() => {
                  const selectedVisualStyle = getPlVisualStyle(selectedPL, groupNameById);
                  
                  return (
                    <>
                      <div className="mapas-drawer-section">
                        <h4>PL Seleccionado</h4>
                        <div 
                          className="mapas-pl-card mapas-pl-selected"
                          style={{ 
                            opacity: selectedPL.baja ? 0.85 : 1,
                            borderLeft: `4px solid ${selectedVisualStyle.color}`
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
                            <div className="mapas-pl-code">{selectedPL.code}</div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '10px',
                                fontWeight: '700',
                                padding: '3px 6px',
                                borderRadius: '3px',
                                backgroundColor: selectedPL.baja === true ? '#000000' : '#10b981',
                                color: selectedPL.baja === true ? '#ef4444' : 'white',
                                textTransform: 'uppercase',
                                letterSpacing: '0.3px',
                              }}>
                                {selectedPL.baja === true ? 'BAJA' : 'ACTIVA'}
                              </span>
                              {selectedVisualStyle.badgeText && (
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: '700',
                                  padding: '3px 6px',
                                  borderRadius: '3px',
                                  backgroundColor: selectedVisualStyle.color,
                                  color: 'white',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.3px',
                                }}>
                                  {selectedVisualStyle.badgeText}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="mapas-pl-name">{selectedPL.razon_social || 'Sin nombre'}</div>
                          {selectedPL.direccion && (
                            <div className="mapas-pl-address">{selectedPL.direccion}</div>
                          )}
                          <div className="mapas-pl-location">
                            {selectedPL.municipio}, {selectedPL.estado}
                          </div>
                          {selectedPL.grupo_id && (
                            <div className="mapas-pl-meta">Grupo: {groupNameById.get(selectedPL.grupo_id) ?? selectedPL.grupo_id}</div>
                          )}
                          {selectedPL.encargado_actual && (
                            <div className="mapas-pl-meta">Encargado: {selectedPL.encargado_actual}</div>
                          )}
                        </div>
                      </div>

                      {loadingNearby && (
                        <div className="mapas-drawer-section">
                          <h4 style={{ color: '#6b7280' }}>Buscando cercanos…</h4>
                        </div>
                      )}

                      {!loadingNearby && nearbyPLsVisible.length > 0 && (
                        <div className="mapas-drawer-section">
                          <h4>
                            PLs Cercanos ({nearbyPLsVisible.length}{totalCount !== null ? ` / ${totalCount}` : ''})
                            {metricQuickFilter === '2000' || metricQuickFilter === '500' ? ` · Grupo ${metricQuickFilter}` : ''}
                          </h4>
                          {radiusKm >= 100 && (
                            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                              Radio grande: mostrando los primeros 200 pines
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 6, margin: '6px 0 4px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => setMobileCompactList(true)}
                              className="home-config-btn"
                              style={{
                                padding: '6px 10px', fontSize: 11,
                                background: mobileCompactList ? 'rgba(0,255,163,0.12)' : 'rgba(255,255,255,0.05)',
                                color: mobileCompactList ? '#00ffa3' : '#94a3b8',
                                border: mobileCompactList ? '1px solid rgba(0,255,163,0.35)' : '1px solid rgba(255,255,255,0.08)',
                              }}
                            >
                              Lista plana
                            </button>
                            <button
                              type="button"
                              onClick={() => setMobileCompactList(false)}
                              className="home-config-btn"
                              style={{
                                padding: '6px 10px', fontSize: 11,
                                background: !mobileCompactList ? 'rgba(0,255,163,0.12)' : 'rgba(255,255,255,0.05)',
                                color: !mobileCompactList ? '#00ffa3' : '#94a3b8',
                                border: !mobileCompactList ? '1px solid rgba(0,255,163,0.35)' : '1px solid rgba(255,255,255,0.08)',
                              }}
                            >
                              Detalle
                            </button>
                            <button
                              type="button"
                              onClick={handleExportPdf}
                              className="home-config-btn"
                              style={{
                                padding: '6px 10px', fontSize: 11,
                                background: 'rgba(59,130,246,0.15)',
                                color: '#60a5fa',
                                border: '1px solid rgba(59,130,246,0.3)',
                              }}
                            >
                              Descargar PDF
                            </button>
                          </div>

                          {(metricQuickFilter === '2000' || metricQuickFilter === '500') && (
                            <div style={{ display: 'flex', gap: 6, margin: '4px 0 8px', flexWrap: 'wrap', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => setListCalFilter('all')}
                                className="home-config-btn"
                                style={{
                                  padding: '5px 10px', fontSize: 11,
                                  background: listCalFilter === 'all' ? 'rgba(0,255,163,0.12)' : 'rgba(255,255,255,0.05)',
                                  color: listCalFilter === 'all' ? '#00ffa3' : '#94a3b8',
                                  border: listCalFilter === 'all' ? '1px solid rgba(0,255,163,0.35)' : '1px solid rgba(255,255,255,0.08)',
                                }}
                              >
                                Todas ({nearbyPLsVisible.length})
                              </button>
                              <button
                                type="button"
                                onClick={() => setListCalFilter('sinCal')}
                                className="home-config-btn"
                                style={{
                                  padding: '5px 10px', fontSize: 11,
                                  background: listCalFilter === 'sinCal' ? 'rgba(249,115,22,0.2)' : 'rgba(249,115,22,0.07)',
                                  color: listCalFilter === 'sinCal' ? '#fb923c' : '#f97316',
                                  border: listCalFilter === 'sinCal' ? '1px solid rgba(249,115,22,0.5)' : '1px solid rgba(249,115,22,0.2)',
                                }}
                              >
                                Sin calibración ({sinCalCount})
                              </button>
                            </div>
                          )}

                          <div className="mapas-pl-list">
                            {drawerPLs.map((pl) => {
                              const visualStyle = getPlVisualStyle(pl, groupNameById);
                              
                              return (
                                <div
                                  key={pl.id}
                                  className={`mapas-pl-item ${
                                    focusedPL?.id === pl.id ? 'mapas-pl-focused' : ''
                                  }`}
                                  onClick={() => {
                                    handlePLClick(pl);
                                    setIsListOpen(false);
                                  }}
                                  style={{ opacity: pl.baja ? 0.85 : 1 }}
                                >
                                  <div
                                    className="mapas-pl-chip"
                                    style={{
                                      backgroundColor: visualStyle.color,
                                    }}
                                  />
                                  <div className="mapas-pl-item-content">
                                    {mobileCompactList ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                          <span className="mapas-pl-item-code" style={{ fontSize: 14 }}>{pl.code}</span>
                                          {pl.distancia_km != null && (
                                            <span className="mapas-pl-distance">{pl.distancia_km.toFixed(2)} km</span>
                                          )}
                                        </div>
                                        <div className="mapas-pl-item-name" style={{ marginTop: 2, fontSize: 12 }}>
                                          {pl.razon_social || 'Sin razón social'}
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                          {(() => {
                                            const cal = getCalibrationBadge(pl);
                                            return (
                                              <span style={{
                                                fontSize: '10px',
                                                fontWeight: '700',
                                                padding: '3px 6px',
                                                borderRadius: '3px',
                                                backgroundColor: cal.bg,
                                                color: 'white',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.3px',
                                              }}>
                                                {cal.label}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                        <div className="mapas-pl-item-meta" style={{ marginTop: 2 }}>
                                          Usuario: <strong>{pl.encargado_actual?.trim() || 'SIN ASIGNAR'}</strong>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="mapas-pl-item-header">
                                          <span className="mapas-pl-item-code">{pl.code}</span>
                                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            {pl.distancia_km != null && (
                                              <span className="mapas-pl-distance">
                                                {pl.distancia_km.toFixed(2)} km
                                              </span>
                                            )}
                                            <span style={{
                                              fontSize: '10px',
                                              fontWeight: '700',
                                              padding: '3px 6px',
                                              borderRadius: '3px',
                                              backgroundColor: pl.baja === true ? '#000000' : '#10b981',
                                              color: pl.baja === true ? '#ef4444' : 'white',
                                              textTransform: 'uppercase',
                                              letterSpacing: '0.3px',
                                            }}>
                                              {pl.baja === true ? 'BAJA' : 'ACTIVA'}
                                            </span>
                                            {visualStyle.badgeText && (
                                              <span style={{
                                                fontSize: '10px',
                                                fontWeight: '700',
                                                padding: '3px 6px',
                                                borderRadius: '3px',
                                                backgroundColor: visualStyle.color,
                                                color: 'white',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.3px',
                                              }}>
                                                {visualStyle.badgeText}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="mapas-pl-item-name">{pl.razon_social || 'Sin nombre'}</div>
                                        <div className="mapas-pl-item-location">
                                          {pl.municipio}, {pl.estado}
                                        </div>
                                        {pl.grupo_id && (
                                          <div className="mapas-pl-item-meta"><strong>Grupo:</strong> {groupNameById.get(pl.grupo_id) ?? pl.grupo_id}</div>
                                        )}
                                        {pl.encargado_actual && (
                                          <div className="mapas-pl-item-meta"><strong>Encargado:</strong> {pl.encargado_actual}</div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
