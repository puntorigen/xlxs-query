/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack configuration (Next.js 16 default)
  // DuckDB-WASM is loaded from CDN in the browser, no bundler config needed
  turbopack: {},
};

module.exports = nextConfig;
