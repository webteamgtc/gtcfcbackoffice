/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Node-only SDKs, loaded with require at runtime instead of being bundled
  serverExternalPackages: ['ali-oss', 'mysql2'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'gtcfx-bucket.s3.ap-southeast-1.amazonaws.com', pathname: '/**' }]
  },
  experimental: {
    // document uploads go through a Server Action (default limit is 1MB); files are capped at 10MB in actions/documents.js
    // (the application form uploads nothing: Sumsub collects the documents)
    serverActions: { bodySizeLimit: '11mb' }
  }
};

export default nextConfig;
