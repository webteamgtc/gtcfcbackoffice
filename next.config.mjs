/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Node-only SDKs, loaded with require at runtime instead of being bundled
  serverExternalPackages: ['ali-oss', 'mysql2'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'gtcfx-bucket.s3.ap-southeast-1.amazonaws.com', pathname: '/**' }]
  },
  experimental: {
    // document uploads go through Server Actions (default limit is 1MB): 10MB in actions/documents.js,
    // 4MB per file in the application form (actions/application.js, under Vercel's 4.5MB request limit)
    serverActions: { bodySizeLimit: '11mb' }
  }
};

export default nextConfig;
