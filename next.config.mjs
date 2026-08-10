/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pnpm dev` keeps a Next dev server running, and it writes to .next
  // continuously. A production build into the same directory races it and fails
  // with "Cannot find module for page: /instructor" — which reads like a broken
  // route rather than two processes fighting over a directory. Setting
  // NEXT_DIST_DIR lets a build run alongside the dev server:
  //
  //   NEXT_DIST_DIR=.next-build pnpm build
  //
  // Unset, this is the stock `.next` and nothing changes.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Cloud Ops client loads a protobuf descriptor set from disk and pulls in
  // @grpc/grpc-js, neither of which survive bundling. Keep them external.
  serverExternalPackages: [
    '@grpc/grpc-js',
    '@grpc/proto-loader',
    '@temporalio/client',
    '@temporalio/common',
  ],
  outputFileTracingIncludes: {
    '/**': ['./proto/**'],
  },
};

export default nextConfig;
