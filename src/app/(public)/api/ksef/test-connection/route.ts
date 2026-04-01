import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

type TestConnectionResponse =
  | {
      success: true;
      message: string;
      data: {
        companyId: string;
        hasToken: boolean;
        hasCertificate: boolean;
        hasCertificatePassword: boolean;
        environment: 'test' | 'production';
        isActive: boolean;
      };
    }
  | {
      success: false;
      error: string;
      details?: string;
    };

const LOG_PREFIX = '[KSEF_TEST_CONNECTION]';

const maskId = (value: string | null | undefined) => {
  if (!value) return 'unknown';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const getSafeErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
};

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    console.log(`${LOG_PREFIX} Incoming request`, {
      requestId,
      method: request.method,
      pathname: request.nextUrl.pathname,
    });

    let body: unknown;

    try {
      body = await request.json();
    } catch (parseError) {
      console.error(`${LOG_PREFIX} Failed to parse request body`, {
        requestId,
        error: getSafeErrorMessage(parseError),
      });

      return NextResponse.json<TestConnectionResponse>(
        {
          success: false,
          error: 'Invalid request body',
          details: 'Request body must be valid JSON.',
        },
        { status: 400 }
      );
    }

    const companyId =
      typeof body === 'object' &&
      body !== null &&
      'companyId' in body &&
      typeof (body as { companyId?: unknown }).companyId === 'string'
        ? (body as { companyId: string }).companyId.trim()
        : '';

    if (!companyId) {
      console.warn(`${LOG_PREFIX} Missing companyId`, {
        requestId,
      });

      return NextResponse.json<TestConnectionResponse>(
        {
          success: false,
          error: 'Company ID is required',
        },
        { status: 400 }
      );
    }

    console.log(`${LOG_PREFIX} Validated input`, {
      requestId,
      companyId: maskId(companyId),
    });

    const cookieStore = await cookies();
    const supabase = createSupabaseServerClient(cookieStore);

    const { data: credentials, error } = await supabase
      .from('ksef_credentials')
      .select(
        `
          id,
          my_company_id,
          token,
          certificate_key,
          certificate_password,
          is_test_environment,
          is_active,
          created_at,
          updated_at
        `
      )
      .eq('my_company_id', companyId)
      .maybeSingle();

    if (error) {
      console.error(`${LOG_PREFIX} Supabase error while fetching credentials`, {
        requestId,
        companyId: maskId(companyId),
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      return NextResponse.json<TestConnectionResponse>(
        {
          success: false,
          error: 'Failed to fetch credentials',
          details: error.message,
        },
        { status: 500 }
      );
    }

    if (!credentials) {
      console.warn(`${LOG_PREFIX} No credentials found`, {
        requestId,
        companyId: maskId(companyId),
      });

      return NextResponse.json<TestConnectionResponse>(
        {
          success: false,
          error: 'No credentials found for this company',
        },
        { status: 404 }
      );
    }

    const hasToken = !!credentials.token?.trim();
    const hasCertificate = !!credentials.certificate_key?.trim();
    const hasCertificatePassword = !!credentials.certificate_password?.trim();
    const isTestEnvironment = !!credentials.is_test_environment;
    const isActive =
      typeof credentials.is_active === 'boolean' ? credentials.is_active : true;

    console.log(`${LOG_PREFIX} Credentials fetched`, {
      requestId,
      companyId: maskId(companyId),
      credentialsId: maskId(String(credentials.id ?? 'unknown')),
      hasToken,
      hasCertificate,
      hasCertificatePassword,
      isTestEnvironment,
      isActive,
      createdAt: credentials.created_at ?? null,
      updatedAt: credentials.updated_at ?? null,
    });

    if (!isActive) {
      console.warn(`${LOG_PREFIX} Credentials are inactive`, {
        requestId,
        companyId: maskId(companyId),
      });

      return NextResponse.json<TestConnectionResponse>(
        {
          success: false,
          error: 'KSeF credentials are inactive',
        },
        { status: 400 }
      );
    }

    if (!hasToken) {
      console.warn(`${LOG_PREFIX} Missing token in credentials`, {
        requestId,
        companyId: maskId(companyId),
        hasCertificate,
        hasCertificatePassword,
      });

      return NextResponse.json<TestConnectionResponse>(
        {
          success: false,
          error: 'Missing authorization token',
          details: 'Save a valid KSeF token before testing the connection.',
        },
        { status: 400 }
      );
    }

    if (hasCertificate && !hasCertificatePassword) {
      console.warn(`${LOG_PREFIX} Certificate key exists but password is missing`, {
        requestId,
        companyId: maskId(companyId),
      });
    }

    if (!hasCertificate && hasCertificatePassword) {
      console.warn(`${LOG_PREFIX} Certificate password exists but key is missing`, {
        requestId,
        companyId: maskId(companyId),
      });
    }

    console.log(`${LOG_PREFIX} Test precheck passed`, {
      requestId,
      companyId: maskId(companyId),
      environment: isTestEnvironment ? 'test' : 'production',
    });

    return NextResponse.json<TestConnectionResponse>(
      {
        success: true,
        message: 'Credentials found and ready for KSeF connection test',
        data: {
          companyId,
          hasToken,
          hasCertificate,
          hasCertificatePassword,
          environment: isTestEnvironment ? 'test' : 'production',
          isActive,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} Unhandled route error`, {
      requestId,
      error: getSafeErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json<TestConnectionResponse>(
      {
        success: false,
        error: 'Internal server error',
        details: getSafeErrorMessage(error),
      },
      { status: 500 }
    );
  }
}