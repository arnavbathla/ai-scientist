/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdfkit"],
  webpack: (config) => {
    // pdfkit ships with prebuilt font files that webpack should treat as assets
    config.module.rules.push({
      test: /\.afm$/,
      type: "asset/source",
    });
    return config;
  },
  async headers() {
    return [
      {
        source: "/api/runs/:path*/stream",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-transform" },
          { key: "Connection", value: "keep-alive" },
        ],
      },
    ];
  },
};

export default nextConfig;
