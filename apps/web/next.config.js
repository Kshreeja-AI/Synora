/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    appDir: true,
    optimizePackageImports: ['@synora/design-system', '@synora/shared'],
  },
  images: {
    domains: ['via.placeholder.com', 'localhost'],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  },
};

module.exports = nextConfig;
