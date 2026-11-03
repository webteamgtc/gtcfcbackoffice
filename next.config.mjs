/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'gtcfx-bucket.s3.ap-southeast-1.amazonaws.com', pathname: '/**' }]
  },
  experimental: {
    // document uploads go through a Server Action (default limit is 1MB); files are capped at 10MB in actions/documents.js
    serverActions: { bodySizeLimit: '11mb' }
  }
};

export default nextConfig;
