/** @type {import('next').NextConfig} */
const nextConfig = {
  // Handle native modules for server-side DuckDB (if used)
  serverExternalPackages: ['@duckdb/node-api'],
  
  // Turbopack configuration (Next.js 16 default)
  // DuckDB-WASM is loaded from CDN so no special bundler config needed
  turbopack: {},
};

module.exports = nextConfig;
