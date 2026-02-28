import { NextResponse } from 'next/server';

const BACKEND_API = 'https://codes-backend-production.up.railway.app';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, message: 'Usuario y contraseña requeridos.' },
        { status: 400 },
      );
    }

    const res = await fetch(`${BACKEND_API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      return NextResponse.json(
        { ok: false, message: data.message || 'Credenciales inválidas.' },
        { status: 401 },
      );
    }

    const user = data.user;

    const response = NextResponse.json({ ok: true, user });

    // Cookie de sesión (basta con que exista; no necesitamos guardar todo)
    response.cookies.set('cosmosx_session', '1', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });

    // Opcional: guardar info de usuario no sensible
    response.cookies.set('cosmosx_username', user.username, {
      httpOnly: false,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('Error en /auth/login', err);
    return NextResponse.json(
      { ok: false, message: 'Error interno en el login.' },
      { status: 500 },
    );
  }
}
