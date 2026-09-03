// API base URL is explicitly environment-driven. NEXT_PUBLIC_API_URL is inlined into the
// client bundle at build time. Local development may rely on the localhost fallback (port
// 3001, the actual API dev port). Production/staging builds MUST provide an explicit URL:
// fail the build rather than silently pointing the frontend at the wrong server.
const DEV_API_BASE = 'http://localhost:3001';

if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL must be set for a production/staging build. ' +
      'It cannot default to a localhost URL here; provide the real API origin at build time.',
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required by the deployment Dockerfile, which copies apps/web/.next/standalone to run.
  output: 'standalone',
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || DEV_API_BASE}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
