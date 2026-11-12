import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The parsers are bundled, not traced as externals: a Workers deploy has no
  // node_modules at runtime, and tracing them made OpenNext try to symlink the
  // packages on Windows, which fails without developer mode. The extract route
  // already falls back to the in-browser parser if a runtime cannot run them.
  serverExternalPackages: [],
};

export default nextConfig;
