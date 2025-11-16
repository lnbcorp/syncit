import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Optimize bundle splitting
  experimental: {
    optimizePackageImports: ['react', 'react-dom'],
  },
  // Compress output
  compress: true,
  // Optimize images (if used in future)
  images: {
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
