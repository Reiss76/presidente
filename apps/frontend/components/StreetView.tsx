// components/StreetView.tsx
'use client';

import { useEffect, useRef } from 'react';

interface StreetViewProps {
  lat: number | string;
  lon: number | string;
}

export default function StreetView({ lat, lon }: StreetViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Asegurarnos de que el contenedor existe en el DOM
    if (!containerRef.current) return;

    // Hacemos un casting de `window` a `any` para poder acceder a google.maps
    const win = window as any;
    if (!win.google) return;

    const sv = new win.google.maps.StreetViewService();
    const location = { lat: Number(lat), lng: Number(lon) };

    // Tipamos `data` y `status` como any para evitar que TypeScript infiera 'any' implícito
    sv.getPanorama({ location, radius: 100 }, (data: any, status: any) => {
      if (status === 'OK' && data && data.location) {
        // Creamos la vista en el contenedor
        new win.google.maps.StreetViewPanorama(containerRef.current, {
          pano: data.location.pano,
          addressControl: false,
          motionTracking: false,
        });
      }
    });
  }, [lat, lon]);

  // Ajusta el tamaño según tus necesidades
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
