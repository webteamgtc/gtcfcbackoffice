/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'gtcfx-bucket.s3.ap-southeast-1.amazonaws.com', pathname: '/**' }]
  },
  experimental: {
    // document uploads go through Server Actions (default limit is 1MB); files are capped at 10MB each,
    // and the application form (actions/application.js) sends up to three at once
    serverActions: { bodySizeLimit: '32mb' }
  }
};

export default nextConfig;
