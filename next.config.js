const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

// Znacznik builda — karta przeglądarki ze starszym kodem pokazuje pasek „Odśwież” (`AppVersionWatcher`, `/bridge/app-version`).
const APP_BUILD = process.env.APP_BUILD_ID || Date.now().toString(36);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    return [{ source: '/demo-sprzedawcy/:path*', headers: [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, nosnippet' },
    ] }];
  },
  async redirects() {
    return [
      { source: '/kontakt', destination: '/#kontakt', permanent: true },
      { source: '/oferta/uslugi', destination: '/uslugi', permanent: true },
      { source: '/oferta/konferencje/bytov', destination: '/oferta/konferencje/bytow', permanent: true },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  reactStrictMode: true,
  compiler: {
    emotion: true,
  },
  experimental: {
    workerThreads: false,
    cpus: 1,
    serverComponentsExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  },
  webpack: (config) => {
    config.optimization = {
      ...config.optimization,
      moduleIds: 'deterministic',
    };
    return config;
  },
};

// next dev and next build must never overwrite each other's manifests.
module.exports = (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next' : '.next-build',
  env: {
    NEXT_PUBLIC_APP_BUILD: phase === PHASE_DEVELOPMENT_SERVER ? '' : APP_BUILD,
  },
});
