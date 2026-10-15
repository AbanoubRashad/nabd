import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@nabd/shared'],
  images: { formats: ['image/avif', 'image/webp'] },
};

export default nextConfig;
