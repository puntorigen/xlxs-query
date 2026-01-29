/** @type {import('next').NextConfig} */
const nextConfig = {
  // Handle native modules for DuckDB
  serverExternalPackages: ['@duckdb/node-api'],
};

module.exports = nextConfig;
