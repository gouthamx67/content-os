import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // `self` for the capture features, not `()`. The capture workspace
          // calls getUserMedia and getDisplayMedia from this origin, and an
          // empty allowlist blocks the device before the user is ever asked.
          // `self` keeps them out of any third-party embed; geolocation stays
          // denied because nothing here uses it.
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
