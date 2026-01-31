/** @type {import("next").NextConfig} */
const isDocker = process.env.CLOUDGATE_DOCKER === "1";

const API_ORIGIN = isDocker
  ? "http://api:3001"
  : (process.env.NEXT_PUBLIC_API_ORIGIN || "http://127.0.0.1:3001");

const nextConfig = {
  output: "standalone",

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
