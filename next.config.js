/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // ✅ REMOVED ignoreBuildErrors — enforce clean TypeScript builds
  // typescript: { ignoreBuildErrors: true }, // DO NOT re-enable

  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },

  // Security headers (CORS handled by middleware, these add extra protection)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Prevent server-only modules from being bundled for the browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, dns: false,
        child_process: false, crypto: false,
      };
    }
    return config;
  },

  // Reduce noise in Render logs
  poweredByHeader: false,
};

module.exports = nextConfig;
