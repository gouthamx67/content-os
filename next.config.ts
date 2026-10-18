import type { NextConfig } from "next";

// Scripts: Next.js streams its RSC payload and bootstrap through inline
// <script> tags, and React injects style attributes; with headers()-only CSP
// there is no nonce for them, so 'unsafe-inline' stays in both script-src and
// style-src. The directives that do the real work here are default-src,
// object-src, base-uri, form-action and frame-ancestors. A nonce-based policy
// (see the Next CSP guide) is the documented follow-up once the inline style
// attributes are gone; until then this blocks external script/plugin loads and
// tag-injection vectors without breaking hydration, capture or the editor.
function contentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // blob: carries capture recordings and generated images; data: carries
    // inlined icons. Both are same-origin objects created by the page.
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    const isDev = process.env.NODE_ENV === "development";

    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Content-Security-Policy",
        value: contentSecurityPolicy(isDev),
      },
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
    ];

    // Opt-in only: a self-hosted deployment behind TLS turns this on with
    // CONTENT_OS_ENABLE_HSTS=1, while local HTTP development never sends it.
    if (process.env.CONTENT_OS_ENABLE_HSTS === "1") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
};

export default nextConfig;
