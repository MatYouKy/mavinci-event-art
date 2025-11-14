import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { token } = await req.json();
  if (!token) {
    return NextResponse.json({ ok: false, message: 'Missing token' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  // Ustaw cookie HttpOnly – middleware/SSR będzie je widzieć
  res.cookies.set('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24, // 1 dzień
  });
  return res;
}