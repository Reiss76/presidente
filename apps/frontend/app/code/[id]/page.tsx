// app/code/[id]/page.tsx

import { Metadata } from 'next';

interface Code {
  id: number;
  code: string;
  // Añade aquí otros campos según el modelo de tu backend,
  // por ejemplo: estado, municipio, direccion, grupo_id, etc.
}

import { getApiBase } from '../../../lib/api';

/**
 * Función para obtener los detalles de un código desde tu API.
 * Usa getApiBase() para construir la URL.
 */
async function getCode(id: string): Promise<Code> {
  const baseUrl = getApiBase();
  const res = await fetch(`${baseUrl}/codes/${id}`);

  if (!res.ok) {
    throw new Error(`No se pudo obtener el código ${id}`);
  }

  return res.json();
}

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Componente de página que renderiza los detalles de un código.
 * Los parámetros de la ruta ([id]) se reciben como una promesa.
 */
export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const code = await getCode(id);

  return (
    <main>
      <h1>Código {code.code}</h1>
      <p>ID: {code.id}</p>
      {/* Muestra aquí otros campos del código si los necesitas */}
    </main>
  );
}

/**
 * Metadata para la ruta /code/[id].
 * Se ejecuta en el servidor y también usa params como promesa.
 */
export async function generateMetadata(
  { params }: PageProps
): Promise<Metadata> {
  const { id } = await params;
  const code = await getCode(id);

  return {
    title: `Código ${code.code}`,
    description: `Detalles del código ${code.code} en el buscador`,
  };
}
