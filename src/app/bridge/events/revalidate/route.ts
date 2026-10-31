import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireSessionEmployee } from '@/lib/auth/requireEmployee.server';

export async function POST(request: NextRequest) {
  const access = await requireSessionEmployee(request);
  if (!access.ok) return access.response;

  try {
    const body = await request.json();
    const { path } = body;

    if (!path) {
      return NextResponse.json(
        { message: 'Path is required' },
        { status: 400 }
      );
    }

    revalidatePath(path);

    return NextResponse.json(
      { revalidated: true, path, now: Date.now() },
      { status: 200 }
    );
  } catch (error) {
    console.error('Revalidation error:', error);
    return NextResponse.json(
      { message: 'Error revalidating', error: String(error) },
      { status: 500 }
    );
  }
}
