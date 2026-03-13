import { Suspense } from 'react';
import MapasContent from '../../components/MapasContent';

export const metadata = {
  title: 'Mapas | COSMOSX',
  description: 'Visualización de PLs en el mapa',
};

export default function MapasPage() {
  return (
    <Suspense>
      <MapasContent />
    </Suspense>
  );
}
