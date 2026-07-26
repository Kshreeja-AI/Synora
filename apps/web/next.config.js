/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['@synora/design-system', '@synora/shared'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'via.placeholder.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  },
};

module.exports = nextConfig;
