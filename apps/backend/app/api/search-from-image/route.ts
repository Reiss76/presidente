import { NextRequest, NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';
import { prisma } from '@/lib/prisma'; // ajusta esta ruta si tu prisma está en otro lugar

// Expresión regular para encontrar códigos tipo: PL/12345, PL/26089/ABC, etc.
const CODE_REGEX = /PL\/\d{1,10}(?:\/[A-Z0-9]+)*/g;

// Función que hace OCR a la imagen y regresa todo el texto que detecta
async function ocrImage(buffer: Buffer): Promise<string> {
  const result = await Tesseract.recognize(buffer, 'eng', {
    logger: () => {
      // puedes dejar esto vacío para no llenar la consola
    },
  });

  return result.data.text || '';
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No se recibió archivo de imagen' },
        { status: 400 }
      );
    }

    // Convertimos el File del request a Buffer de Node
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Hacemos OCR a la imagen
    const text = await ocrImage(buffer);

    // 2. Buscamos códigos en el texto con la regex
    const matches = text.match(CODE_REGEX) ?? [];
    const codes = Array.from(new Set(matches)); // limpiamos duplicados

    // Si no se detectó ningún código, regresamos solo el texto
    if (codes.length === 0) {
      return NextResponse.json({
        text,
        codes: [],
        results: [],
      });
    }

    // 3. Buscamos esos códigos en tu tabla de códigos (ajusta el nombre del modelo si es distinto)
    const results = await prisma.codes.findMany({
      where: {
        code: {
          in: codes,
        },
      },
    });

    // 4. Regresamos todo al front
    return NextResponse.json({
      text,
      codes,
      results,
    });
  } catch (error) {
    console.error('Error en /api/search-from-image:', error);
    return NextResponse.json(
      { error: 'Error procesando la imagen' },
      { status: 500 }
    );
  }
}
