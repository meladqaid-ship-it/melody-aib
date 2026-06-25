/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },

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
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, dns: false,
        child_process: false, crypto: false,
      };
    }
    return config;
  },

  // Next.js 14 syntax for external packages
  experimental: {
    serverComponentsExternalPackages: [
      'ioredis',
      'bullmq',
      'sharp',
      'nodemailer',
      '@aws-sdk/client-s3',
      '@aws-sdk/lib-storage',
      '@aws-sdk/s3-request-presigner',
      'bcryptjs',
      'ffmpeg-static',
    ],
  },

  poweredByHeader: false,
};

module.exports = nextConfig;
