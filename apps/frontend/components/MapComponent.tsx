'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow, MarkerClusterer } from '@react-google-maps/api';
import type { PLItem, NearbyPLItem, MunicipioBajaItem, EstadoBajaItem } from './MapasContent';

type MapComponentProps = {
  selectedPL: PLItem;
  nearbyPLs: NearbyPLItem[];
  plColors: Map<number, string>;
  focusedPL: NearbyPLItem | null;
  radiusKm: number;
  groupNameById: Map<number, string>;
  visitYearSet: Set<number>;
};

type GeocodedCoords = { lat: number; lng: number } | null;

type GasStation = {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  vicinity?: string;
  rating?: number;
};

type GasStationCacheEntry = {
  stations: GasStation[];
  status: string | null;
};

type DisplayCoords = {
  coords: { lat: number; lng: number };
  isApprox: boolean;
} | null;

type GeocodeCacheEntry = { lat: number; lng: number } | null;

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

const containerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '12px',
};

const libraries: ('places')[] = ['places'];

// Map styles to hide all POIs except gas stations (which we'll add manually)
const mapStyles: google.maps.MapTypeStyle[] = [
  // Hide all points of interest
  {
    featureType: 'poi',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  // Hide business POIs
  {
    featureType: 'poi.business',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  // Hide medical POIs
  {
    featureType: 'poi.medical',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  // Hide school POIs
  {
    featureType: 'poi.school',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  // Hide attraction POIs
  {
    featureType: 'poi.attraction',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  // Hide transit stations
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  // Simplify administrative labels
  {
    featureType: 'administrative',
    elementType: 'labels',
    stylers: [{ visibility: 'simplified' }],
  },
  // Keep roads visible
  {
    featureType: 'road',
    elementType: 'all',
    stylers: [{ visibility: 'on' }],
  },
  // Keep water visible
  {
    featureType: 'water',
    elementType: 'all',
    stylers: [{ visibility: 'on' }],
  },
  // Keep parks visible but subtle
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ visibility: 'on' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
];

// Configurable constants for gas stations
const GAS_STATION_MARKER_Z_INDEX = 50; // Below PL markers (100+) but above base map
const MIN_GAS_RADIUS_METERS = 2000; // Minimum 2km radius for gas station search
const MAX_GAS_RADIUS_METERS = 200000; // Maximum 200km radius for gas station search

// Constants for approximate location markers
const APPROX_MARKER_Z_INDEX = 75; // Below precise markers but above gas stations
const MAX_NEARBY_TO_GEOCODE_APPROX = 50; // Max nearby PLs to geocode for approximate location

// Z-index constants for marker layering
const FOCUSED_PL_Z_INDEX = 2000; // Focused PL always on top
const MAIN_MARKER_Z_INDEX = 1000; // Main marker (selected PL)
const NEARBY_MARKER_Z_INDEX = 100; // Other nearby markers

// Visit year halo color
export const VISIT_HALO_COLOR = '#8b5cf6'; // Purple

// Offset for separating overlapping markers (in degrees, ~13 meters)
const COORDINATE_OFFSET = 0.00012;
const OVERLAP_THRESHOLD = 0.0001; // Distance threshold to consider markers overlapping

function createMainMarkerIcon(
  color: string,
  centerDotColor: string = '#ffffff',
  isBaja: boolean = false
): string {
  // Main marker: classic pin (Google Maps style) without star
  // For BAJA: use solid black with red center (no opacity)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 32" width="44" height="64">
      <path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21s11-12.75 11-21c0-6.1-4.9-11-11-11z" 
            fill="${color}" 
            stroke="white" 
            stroke-width="2"/>
      <circle cx="11" cy="11" r="5" fill="${centerDotColor}"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createNearbyMarkerIcon(
  color: string,
  centerDotColor: string = '#ffffff',
  shouldShrink: boolean = true,
  isBaja: boolean = false,
  hasVisitHalo: boolean = false
): string {
  // Nearby markers: smaller circle markers (different shape from main marker)
  // For BAJA: use solid black with red center (no opacity)
  const size = shouldShrink ? 24 : 32;
  
  // Purple halo ring around the circle when PL has visits this year
  const haloRing = hasVisitHalo
    ? `<circle cx="12" cy="12" r="11.5" fill="none" stroke="${VISIT_HALO_COLOR}" stroke-width="2.5" opacity="0.85"/>`
    : '';
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
      ${haloRing}
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="12" cy="12" r="4" fill="${centerDotColor}"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createGasStationMarkerIcon(): string {
  // Gas station markers: gray diamond/square markers with pump icon
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28">
      <circle cx="12" cy="12" r="10" fill="#6b7280" stroke="white" stroke-width="2"/>
      <path d="M8 6h5v6h-5V6zm0 7h5v3H8v-3zm5.5 1.5v-4l3 1.5v4.5h-1v-3h-1v3h-1z" 
            fill="white" 
            stroke="none"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createApproxMarkerIcon(color: string, isMain: boolean = false): string {
  // Approximate location markers: translucent circle with dotted border
  const size = isMain ? 48 : 32;
  const innerRadius = isMain ? 8 : 6;
  const outerRadius = isMain ? 18 : 14;
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
      <circle cx="12" cy="12" r="${outerRadius}" 
              fill="${color}" 
              opacity="0.3" 
              stroke="${color}" 
              stroke-width="2" 
              stroke-dasharray="2,2"/>
      <circle cx="12" cy="12" r="${innerRadius}" fill="${color}"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Helper function to calculate if two coordinates are overlapping
function areCoordinatesOverlapping(
  coord1: { lat: number; lng: number } | null,
  coord2: { lat: number; lng: number } | null
): boolean {
  if (!coord1 || !coord2) return false;
  const latDiff = Math.abs(coord1.lat - coord2.lat);
  const lngDiff = Math.abs(coord1.lng - coord2.lng);
  return latDiff < OVERLAP_THRESHOLD && lngDiff < OVERLAP_THRESHOLD;
}

// Apply offset to coordinates to avoid visual overlap
// Offset is applied diagonally (northeast) to ensure clear visual separation
function applyCoordinateOffset(coords: { lat: number; lng: number }): { lat: number; lng: number } {
  return {
    lat: coords.lat + COORDINATE_OFFSET,
    lng: coords.lng + COORDINATE_OFFSET,
  };
}

function InfoWindowContent({
  pl,
  color,
  isMainPL = false,
  distance,
  isApprox = false,
  groupNameById,
  visualStyle,
}: {
  pl: PLItem | NearbyPLItem;
  color: string;
  isMainPL?: boolean;
  distance?: number | null;
  isApprox?: boolean;
  groupNameById: Map<number, string>;
  visualStyle?: PLVisualStyle;
}) {
  const isBaja = pl.baja === true;
  
  return (
    <div style={{ minWidth: '200px', padding: '4px' }}>
      {isApprox && (
        <div 
          style={{ 
            fontSize: '12px', 
            color: '#f59e0b', 
            marginBottom: '8px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          role="alert"
          aria-label="Ubicación aproximada del centro de municipio o estado"
        >
          📍 Ubicación aproximada (centro de municipio/estado)
        </div>
      )}
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{pl.code}</div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: '700',
            padding: '3px 6px',
            borderRadius: '3px',
            backgroundColor: isBaja ? '#000000' : '#10b981',
            color: isBaja ? '#ef4444' : 'white',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
          }}>
            {isBaja ? 'BAJA' : 'ACTIVA'}
          </span>
          {visualStyle?.badgeText && (
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

      <div style={{ fontSize: '13px', marginBottom: '6px' }}>
        <strong>{pl.razon_social || 'Sin nombre'}</strong>
      </div>

      {pl.direccion && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>{pl.direccion}</div>
      )}

      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
        {pl.municipio}, {pl.estado}
      </div>

      {pl.grupo_id && (
        <div style={{ fontSize: '12px', marginTop: '8px' }}>
          <strong>Grupo:</strong> {groupNameById.get(pl.grupo_id) ?? pl.grupo_id}
        </div>
      )}

      {pl.encargado_actual && (
        <div style={{ fontSize: '12px' }}>
          <strong>Encargado:</strong> {pl.encargado_actual}
        </div>
      )}

      {distance !== null && distance !== undefined && (
        <div style={{ fontSize: '12px', marginTop: '8px' }}>
          <strong>Distancia:</strong> {distance.toFixed(2)} km
        </div>
      )}
    </div>
  );
}

/**
 * Normaliza texto para ayudar a geocoding en MX:
 * - quita acentos
 * - deja letras/números/espacios/comas
 * - colapsa espacios
 */
function normalizeAddress(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^\w\s,]/g, ' ') // keep commas
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Geocoding CORRECTO en frontend:
 * usar google.maps.Geocoder (NO fetch), para evitar CORS y restricciones de endpoints REST.
 */
function geocodeWithJsApi(address: string): Promise<GeocodedCoords> {
  return new Promise((resolve) => {
    try {
      const geocoder = new google.maps.Geocoder();

      geocoder.geocode(
        {
          address,
          region: 'mx',
          componentRestrictions: { country: 'MX' },
        },
        (results, status) => {
          if (status === 'OK' && results && results.length > 0) {
            const loc = results[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
            return;
          }
          resolve(null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Helper function to get display coordinates for a PL.
 * Returns precise coordinates if available, otherwise attempts to geocode
 * the municipality+state or state center as an approximation.
 * 
 * @param pl - The PL item to get coordinates for
 * @param geocodeCache - In-memory cache for geocoding results
 * @returns DisplayCoords object with coords and isApprox flag, or null if unable to locate
 */
async function getDisplayCoords(
  pl: PLItem | NearbyPLItem,
  geocodeCache: React.MutableRefObject<Map<string, GeocodeCacheEntry>>
): Promise<DisplayCoords> {
  // Check if PL has valid coordinates
  const hasCoords =
    pl.latitud != null &&
    pl.longitud != null &&
    !(pl.latitud === 0 && pl.longitud === 0);

  if (hasCoords) {
    return {
      coords: { lat: pl.latitud!, lng: pl.longitud! },
      isApprox: false,
    };
  }

  // No valid coordinates, try geocoding
  const { estado, municipio } = pl;
  
  if (!estado && !municipio) {
    return null;
  }

  // Try municipio + estado first
  if (municipio && estado) {
    const key = `${normalizeAddress(municipio)}|${normalizeAddress(estado)}`;
    
    // Check cache
    if (geocodeCache.current.has(key)) {
      const cached = geocodeCache.current.get(key);
      if (cached) {
        return { coords: cached, isApprox: true };
      }
    } else {
      // Geocode municipio + estado
      const address = normalizeAddress(`${municipio}, ${estado}, Mexico`);
      const coords = await geocodeWithJsApi(address);
      
      geocodeCache.current.set(key, coords);
      
      if (coords) {
        return { coords, isApprox: true };
      }
    }
  }

  // Fallback: try estado only
  if (estado) {
    const key = normalizeAddress(estado);
    
    // Check cache
    if (geocodeCache.current.has(key)) {
      const cached = geocodeCache.current.get(key);
      if (cached) {
        return { coords: cached, isApprox: true };
      }
    } else {
      // Geocode estado
      const address = normalizeAddress(`${estado}, Mexico`);
      const coords = await geocodeWithJsApi(address);
      
      geocodeCache.current.set(key, coords);
      
      if (coords) {
        return { coords, isApprox: true };
      }
    }
  }

  return null;
}

/**
 * Convierte status de Places API a mensaje en español amigable para el usuario.
 * Muestra el status exacto y un mensaje amigable cuando hay error.
 */
function getStatusMessage(status: string | null, count: number): string {
  if (!status && count > 0) {
    return `Gasolinerías encontradas: ${count}`;
  }
  
  // Mensajes amigables en español
  const statusMessages: Record<string, string> = {
    'ZERO_RESULTS': 'No se encontraron gasolinerías en este radio',
    'REQUEST_DENIED': 'Acceso denegado a la API',
    'OVER_QUERY_LIMIT': 'Límite de consultas excedido',
    'INVALID_REQUEST': 'Solicitud inválida',
    'UNKNOWN_ERROR': 'Error desconocido al buscar gasolinerías',
  };
  
  if (status && statusMessages[status]) {
    // ZERO_RESULTS no es un error, solo indica que no hay resultados
    const prefix = status === 'ZERO_RESULTS' ? 'Status' : 'Error';
    return `${prefix}: ${status} - ${statusMessages[status]}`;
  }
  
  // Fallback genérico para status desconocido
  if (status) {
    return `Error: ${status} - Error al buscar gasolinerías`;
  }
  
  return 'Buscando gasolinerías...';
}

export default function MapComponent({ 
  selectedPL, 
  nearbyPLs, 
  plColors, 
  focusedPL, 
  radiusKm,
  groupNameById,
  visitYearSet
}: MapComponentProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [openInfoWindowId, setOpenInfoWindowId] = useState<number | null>(null);
  const [geocodedCenter, setGeocodedCenter] = useState<GeocodedCoords>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  
  // Gas station states - always show by default
  const [gasStations, setGasStations] = useState<GasStation[]>([]);
  const [openGasStationId, setOpenGasStationId] = useState<string | null>(null);
  const [gasStationsStatus, setGasStationsStatus] = useState<string | null>(null);
  
  // Cache for gas station results: key = "lat,lng,radius", value = { stations, status }
  const gasStationCacheRef = useRef<Map<string, GasStationCacheEntry>>(new Map());
  
  // Cache for approximate geocoding: key = "municipio|estado" or "estado"
  const approxGeocodeCacheRef = useRef<Map<string, GeocodeCacheEntry>>(new Map());
  
  // State to track display coordinates for nearby PLs (includes approximations)
  const [nearbyDisplayCoords, setNearbyDisplayCoords] = useState<Map<number, DisplayCoords>>(new Map());
  const [selectedIsApprox, setSelectedIsApprox] = useState(false);

  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    (globalThis as any)?.__NEXT_DATA__?.env?.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: apiKey || '',
    libraries,
  });

  // request id para evitar race conditions
  const geoReqIdRef = useRef(0);

  // Effect to geocode nearby PLs (for approximate locations)
  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    const geocodeNearby = async () => {
      const coordsMap = new Map<number, DisplayCoords>();
      const needGeocode: NearbyPLItem[] = [];

      // Pass 1: add ALL PLs that already have valid lat/lng (no limit)
      for (const pl of nearbyPLs) {
        const hasCoords =
          pl.latitud != null &&
          pl.longitud != null &&
          !(pl.latitud === 0 && pl.longitud === 0);

        if (hasCoords) {
          coordsMap.set(pl.id, {
            coords: { lat: pl.latitud!, lng: pl.longitud! },
            isApprox: false,
          });
        } else {
          needGeocode.push(pl);
        }
      }

      // Pass 2: approximate-geocode only the first N that lack coordinates
      const plsToGeocode = needGeocode.slice(0, MAX_NEARBY_TO_GEOCODE_APPROX);

      const results = await Promise.all(
        plsToGeocode.map(async (pl) => {
          const displayCoords = await getDisplayCoords(pl, approxGeocodeCacheRef);
          return { id: pl.id, displayCoords };
        })
      );

      if (cancelled) return;

      results.forEach(({ id, displayCoords }) => {
        if (displayCoords) {
          coordsMap.set(id, displayCoords);
        }
      });

      setNearbyDisplayCoords(coordsMap);
    };

    geocodeNearby();

    return () => { cancelled = true; };
  }, [nearbyPLs, isLoaded]);

  useEffect(() => {
    // No intentes geocodificar hasta que el SDK esté cargado (necesitamos google.maps.Geocoder)
    if (!isLoaded) return;

    const run = async () => {
      const displayCoords = await getDisplayCoords(selectedPL, approxGeocodeCacheRef);
      
      if (displayCoords) {
        setGeocodedCenter(displayCoords.coords);
        setSelectedIsApprox(displayCoords.isApprox);
        setGeocodeError(null);
      } else {
        setGeocodedCenter(null);
        setSelectedIsApprox(false);
        setGeocodeError('No se pudo ubicar con la información disponible (Estado/Municipio/Dirección)');
      }
    };

    const myReqId = ++geoReqIdRef.current;
    
    setIsGeocoding(true);
    setGeocodeError(null);
    
    run().finally(() => {
      if (myReqId === geoReqIdRef.current) {
        setIsGeocoding(false);
      }
    });
  }, [
    isLoaded,
    selectedPL.id,
    selectedPL.latitud,
    selectedPL.longitud,
    selectedPL.estado,
    selectedPL.municipio,
    selectedPL.direccion,
  ]);

  // Main marker center: always use selectedPL coordinates (not focusedPL)
  const center = useMemo(() => {
    if (geocodedCenter) return geocodedCenter;
    if (selectedPL.latitud != null && selectedPL.longitud != null) {
      return { lat: selectedPL.latitud, lng: selectedPL.longitud };
    }
    return null;
  }, [
    geocodedCenter,
    selectedPL.latitud,
    selectedPL.longitud,
  ]);

  const zoom = focusedPL ? 15 : 14;

  // Calculate focusedPL marker position with offset if overlapping with main marker
  const focusedPLPosition = useMemo(() => {
    if (!focusedPL || focusedPL.id === selectedPL.id) {
      return null; // Don't show separate focused marker if it's the same as selectedPL
    }

    // Get focusedPL coordinates from geocoded results or direct coords
    const focusedCoords = nearbyDisplayCoords.get(focusedPL.id);
    if (!focusedCoords) return null;

    const focusedPos = focusedCoords.coords;

    // Check if focusedPL overlaps with main marker
    if (areCoordinatesOverlapping(center, focusedPos)) {
      // Apply offset to separate them visually
      return {
        coords: applyCoordinateOffset(focusedPos),
        isApprox: focusedCoords.isApprox,
      };
    }

    // No overlap, use original position
    return focusedCoords;
  }, [focusedPL?.id, selectedPL.id, center, nearbyDisplayCoords]);

  const onLoad = useCallback((m: google.maps.Map) => {
    mapRef.current = m;
  }, []);
  
  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Pan to focusedPL if it exists and is different from selectedPL, otherwise pan to center
    if (focusedPLPosition && focusedPL && focusedPL.id !== selectedPL.id) {
      map.panTo(focusedPLPosition.coords);
      map.setZoom(zoom);
    } else if (center) {
      map.panTo(center);
      map.setZoom(zoom);
    }
  }, [center, zoom, focusedPLPosition, focusedPL, selectedPL.id]);

  // Effect to adjust map bounds when nearbyPLs or radiusKm changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded || !center) return;

    // Don't fit bounds if there are no nearby PLs
    if (nearbyPLs.length === 0) return;

    // Create bounds that include the main pin and all nearby PLs with valid coordinates
    const bounds = new google.maps.LatLngBounds();
    
    // Add main pin
    bounds.extend(center);
    
    // Add nearby PLs (limit to first 100 for performance)
    let addedCount = 0;
    const maxToInclude = 100;
    
    for (const pl of nearbyPLs) {
      if (addedCount >= maxToInclude) break;
      
      const displayCoords = nearbyDisplayCoords.get(pl.id);
      if (displayCoords) {
        bounds.extend(displayCoords.coords);
        addedCount++;
      }
    }
    
    // Only fit bounds if we actually added some nearby PLs
    if (addedCount > 0) {
      map.fitBounds(bounds);
      
      // Ensure we don't zoom out too far
      // Wait for fitBounds to complete, then check zoom level
      google.maps.event.addListenerOnce(map, 'idle', () => {
        const currentZoom = map.getZoom();
        const minZoom = 8;
        if (currentZoom !== undefined && currentZoom < minZoom) {
          map.setZoom(minZoom);
        }
      });
    }
  }, [nearbyPLs, radiusKm, nearbyDisplayCoords, center, isLoaded]);

  // Effect to search for nearby gas stations
  useEffect(() => {
    const map = mapRef.current;
    // Always search if map is loaded and we have a center
    if (!map || !center || !isLoaded) {
      setGasStations([]);
      setGasStationsStatus(null);
      return;
    }

    // Convert radiusKm to meters with min/max constraints (unified radius for gas stations)
    const radiusMeters = Math.max(MIN_GAS_RADIUS_METERS, Math.min(MAX_GAS_RADIUS_METERS, radiusKm * 1000));

    // Create cache key with 3 decimal places (~111m precision)
    const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)},${radiusMeters}`;
    
    // Check cache first
    const cached = gasStationCacheRef.current.get(cacheKey);
    if (cached) {
      setGasStations(cached.stations);
      setGasStationsStatus(cached.status);
      return;
    }

    // Track this request to handle race conditions
    let isCancelled = false;

    // Search for nearby gas stations using Places API
    const service = new google.maps.places.PlacesService(map);
    
    // Helper function to process results
    const processResults = (results: google.maps.places.PlaceResult[] | null): GasStation[] => {
      if (!results) return [];
      
      return results
        .filter((place) => {
          // Only include places with valid required fields
          return (
            place.place_id &&
            place.geometry?.location &&
            typeof place.geometry.location.lat === 'function' &&
            typeof place.geometry.location.lng === 'function'
          );
        })
        .map((place) => ({
          place_id: place.place_id!,
          name: place.name || 'Gas Station',
          lat: place.geometry!.location!.lat(),
          lng: place.geometry!.location!.lng(),
          vicinity: place.vicinity,
          rating: place.rating,
        }));
    };
    
    // Helper function to perform search with a specific request
    const performSearch = (
      searchRequest: google.maps.places.PlaceSearchRequest,
      onComplete: (stations: GasStation[], status: string) => void
    ) => {
      service.nearbySearch(searchRequest, (results, status) => {
        if (isCancelled) return;
        
        const statusStr = status.toString();
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
          const stations = processResults(results);
          onComplete(stations, statusStr);
        } else {
          onComplete([], statusStr);
        }
      });
    };
    
    // First attempt: search by type 'gas_station'
    const request: google.maps.places.PlaceSearchRequest = {
      location: center,
      radius: radiusMeters,
      type: 'gas_station',
    };

    performSearch(request, (stations, status) => {
      if (stations.length > 0) {
        // Cache and display results
        gasStationCacheRef.current.set(cacheKey, { stations, status: null });
        setGasStations(stations);
        setGasStationsStatus(null);
        return;
      }
      
      // Fallback 1: Try with keyword 'gasolinera'
      const fallbackRequest1: google.maps.places.PlaceSearchRequest = {
        location: center,
        radius: radiusMeters,
        keyword: 'gasolinera',
      };
      
      performSearch(fallbackRequest1, (stations1, status1) => {
        if (stations1.length > 0) {
          gasStationCacheRef.current.set(cacheKey, { stations: stations1, status: null });
          setGasStations(stations1);
          setGasStationsStatus(null);
          return;
        }
        
        // Fallback 2: Try with keyword 'pemex'
        const fallbackRequest2: google.maps.places.PlaceSearchRequest = {
          location: center,
          radius: radiusMeters,
          keyword: 'pemex',
        };
        
        performSearch(fallbackRequest2, (stations2, status2) => {
          if (stations2.length > 0) {
            gasStationCacheRef.current.set(cacheKey, { stations: stations2, status: null });
            setGasStations(stations2);
            setGasStationsStatus(null);
          } else {
            // All attempts failed - use the status from the last attempt
            gasStationCacheRef.current.set(cacheKey, { stations: [], status: status2 });
            setGasStations([]);
            setGasStationsStatus(status2);
          }
        });
      });
    });

    // Cleanup function to cancel request if effect re-runs
    return () => {
      isCancelled = true;
    };
  }, [center, isLoaded, radiusKm]);

  const handleMarkerClick = (plId: number) => setOpenInfoWindowId(plId);
  const handleInfoWindowClose = () => setOpenInfoWindowId(null);

  if (!apiKey) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fef2f2',
          borderRadius: '12px',
          color: '#991b1b',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>API Key no configurada</p>
          <p style={{ fontSize: '14px' }}>
            Configura <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> en Vercel y redeploy.
          </p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
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
        <div style={{ color: '#6b7280' }}>Cargando Google Maps...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fef2f2',
          borderRadius: '12px',
          color: '#991b1b',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>Error al cargar Google Maps</p>
          <p style={{ fontSize: '14px' }}>
            Verifica que la key sea válida y tenga habilitadas Maps JavaScript API + Geocoding API.
          </p>
        </div>
      </div>
    );
  }

  if (isGeocoding) {
    return (
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
        <div style={{ color: '#6b7280' }}>Geocodificando dirección...</div>
      </div>
    );
  }

  if (geocodeError || !center) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fef2f2',
          borderRadius: '12px',
          color: '#991b1b',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 12px' }}>
            <path
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>
            {geocodeError || 'No se pudo ubicar con la información disponible'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          zoomControl: true,
          streetViewControl: true,
          mapTypeControl: true,
          fullscreenControl: true,
          clickableIcons: false,
          styles: mapStyles,
        }}
      >
        {/* Selected PL marker - Main marker with distinct pin and star icon */}
        <Marker
          position={center}
          icon={
            selectedIsApprox
              ? {
                  url: createApproxMarkerIcon(plColors.get(selectedPL.id) || '#ef4444', true),
                  scaledSize: new google.maps.Size(48, 48),
                  anchor: new google.maps.Point(24, 24),
                }
              : (() => {
                  const visualStyle = getPlVisualStyle(
                    selectedPL,
                    groupNameById
                  );
                  return {
                    url: createMainMarkerIcon(visualStyle.color, visualStyle.centerDotColor, selectedPL.baja === true),
                    scaledSize: new google.maps.Size(44, 64),
                    anchor: new google.maps.Point(22, 64),
                  };
                })()
          }
          onClick={() => handleMarkerClick(selectedPL.id)}
          zIndex={selectedIsApprox ? APPROX_MARKER_Z_INDEX + 10 : MAIN_MARKER_Z_INDEX}
        >
          {openInfoWindowId === selectedPL.id && (() => {
            const visualStyle = getPlVisualStyle(
              selectedPL,
              groupNameById
            );
            return (
              <InfoWindow position={center} onCloseClick={handleInfoWindowClose}>
                <InfoWindowContent
                  pl={selectedPL}
                  color={visualStyle.color}
                  isMainPL={true}
                  isApprox={selectedIsApprox}
                  groupNameById={groupNameById}
                  visualStyle={visualStyle}
                />
              </InfoWindow>
            );
          })()}
        </Marker>

        {/* Focused PL marker - Shown separately when different from selectedPL */}
        {focusedPLPosition && focusedPL && focusedPL.id !== selectedPL.id && (
          <Marker
            position={focusedPLPosition.coords}
            icon={
              focusedPLPosition.isApprox
                ? {
                    url: createApproxMarkerIcon(plColors.get(focusedPL.id) || '#94a3b8', false),
                    scaledSize: new google.maps.Size(32, 32),
                    anchor: new google.maps.Point(16, 16),
                  }
                : (() => {
                    const visualStyle = getPlVisualStyle(
                      focusedPL,
                      groupNameById
                    );
                    return {
                      url: createNearbyMarkerIcon(visualStyle.color, visualStyle.centerDotColor, false, focusedPL.baja === true, visitYearSet.has(focusedPL.id)),
                      scaledSize: new google.maps.Size(32, 32),
                      anchor: new google.maps.Point(16, 16),
                    };
                  })()
            }
            onClick={() => handleMarkerClick(focusedPL.id)}
            zIndex={FOCUSED_PL_Z_INDEX}
          >
            {openInfoWindowId === focusedPL.id && (() => {
              const visualStyle = getPlVisualStyle(
                focusedPL,
                groupNameById
              );
              return (
                <InfoWindow position={focusedPLPosition.coords} onCloseClick={handleInfoWindowClose}>
                  <InfoWindowContent 
                    pl={focusedPL} 
                    color={visualStyle.color}
                    distance={focusedPL.distancia_km} 
                    isApprox={focusedPLPosition.isApprox}
                    groupNameById={groupNameById}
                    visualStyle={visualStyle}
                  />
                </InfoWindow>
              );
            })()}
          </Marker>
        )}

        {/* Nearby markers - Circle markers to distinguish from main pin */}
        {(() => {
          const renderNearbyMarker = (pl: NearbyPLItem, clusterer?: any) => {
            // Skip focusedPL as it's rendered separately above
            if (focusedPL && pl.id === focusedPL.id) return null;

            // Get display coordinates (may be approximate)
            const displayCoords = nearbyDisplayCoords.get(pl.id);
            
            // Don't draw markers if we couldn't get any coordinates
            if (!displayCoords) return null;

            const color = plColors.get(pl.id) || '#94a3b8';
            const isApprox = displayCoords.isApprox;
            const isBaja = pl.baja === true;
            const hasHalo = visitYearSet.has(pl.id);

            const visualStyle = getPlVisualStyle(pl, groupNameById);

            return (
              <Marker
                key={pl.id}
                position={displayCoords.coords}
                icon={
                  isApprox
                    ? {
                        url: createApproxMarkerIcon(color, false),
                        scaledSize: new google.maps.Size(24, 24),
                        anchor: new google.maps.Point(12, 12),
                      }
                    : {
                        url: createNearbyMarkerIcon(visualStyle.color, visualStyle.centerDotColor, true, isBaja, hasHalo),
                        scaledSize: new google.maps.Size(24, 24),
                        anchor: new google.maps.Point(12, 12),
                      }
                }
                onClick={() => handleMarkerClick(pl.id)}
                zIndex={isApprox ? APPROX_MARKER_Z_INDEX : NEARBY_MARKER_Z_INDEX}
                clusterer={clusterer}
              >
                {openInfoWindowId === pl.id && (
                  <InfoWindow position={displayCoords.coords} onCloseClick={handleInfoWindowClose}>
                    <InfoWindowContent 
                      pl={pl} 
                      color={visualStyle.color}
                      distance={pl.distancia_km} 
                      isApprox={isApprox}
                      groupNameById={groupNameById}
                      visualStyle={visualStyle}
                    />
                  </InfoWindow>
                )}
              </Marker>
            );
          };

          // Always render without clustering (max 50 pins)
          return nearbyPLs.map((pl) => renderNearbyMarker(pl));
        })()}

        {/* Gas station markers - Always shown */}
        {gasStations.map((station) => (
          <Marker
              key={station.place_id}
              position={{ lat: station.lat, lng: station.lng }}
              icon={{
                url: createGasStationMarkerIcon(),
                scaledSize: new google.maps.Size(28, 28),
                anchor: new google.maps.Point(14, 14),
              }}
              onClick={() => setOpenGasStationId(station.place_id)}
              zIndex={GAS_STATION_MARKER_Z_INDEX}
            >
              {openGasStationId === station.place_id && (
                <InfoWindow
                  position={{ lat: station.lat, lng: station.lng }}
                  onCloseClick={() => setOpenGasStationId(null)}
                >
                  <div style={{ minWidth: '180px', padding: '4px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '6px' }}>
                      {station.name}
                    </div>
                    {station.vicinity && (
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>
                        {station.vicinity}
                      </div>
                    )}
                    {station.rating != null && (
                      <div style={{ fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#f59e0b' }}>★</span>
                        <span>{station.rating.toFixed(1)}</span>
                      </div>
                    )}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}&query_place_id=${station.place_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'block',
                        marginTop: '8px',
                        padding: '6px 10px',
                        background: '#3b82f6',
                        color: 'white',
                        borderRadius: '4px',
                        fontSize: '12px',
                        textAlign: 'center',
                        textDecoration: 'none',
                        fontWeight: '500',
                      }}
                    >
                      Abrir en Google Maps
                    </a>
                  </div>
                </InfoWindow>
              )}
            </Marker>
          ))}
      </GoogleMap>
    </div>
  );
}
