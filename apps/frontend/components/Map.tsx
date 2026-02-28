'use client';

type Props = {
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
};

// Componente de mapa desactivado por ahora.
// Más adelante podremos implementar el mapa con Google Maps de nuevo.
export default function Map(_props: Props) {
  return null;
}
