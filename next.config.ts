import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The server parser reads PDFs through pdf.js's legacy build at runtime; keep
  // both parsers out of the bundle so their worker files resolve normally.
  serverExternalPackages: ["pdfjs-dist", "mammoth"],
};

export default nextConfig;
