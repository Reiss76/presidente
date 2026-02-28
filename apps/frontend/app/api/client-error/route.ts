import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    console.error('[CLIENT_ERROR]', data);
  } catch (err) {
    console.error('[CLIENT_ERROR]', 'Invalid payload', err);
  }

  return NextResponse.json({ ok: true });
}
