/** @type {import('next').NextConfig} */
const nextConfig = {
  // Handle native modules for DuckDB
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/node-api'],
  },
};

module.exports = nextConfig;
