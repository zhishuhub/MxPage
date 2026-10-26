/** @type {import('next').NextConfig} */
const distDir = process.env.NEXT_DIST_DIR || ".next";

const nextConfig = {
  output: "standalone",
  distDir,
  ...(process.env.MXPAGE_TEST_TSCONFIG ? { typescript: { tsconfigPath: process.env.MXPAGE_TEST_TSCONFIG } } : {}),
  experimental: {
    ...(distDir === ".next-desktop" ? { cpus: 2 } : {}),
    serverComponentsExternalPackages: ["sharp", "deepagents", "langchain", "langsmith", "@langchain/core", "@langchain/openai", "@langchain/langgraph", "@langchain/langgraph-checkpoint", "@modelcontextprotocol/sdk", "pdfjs-dist", "mammoth", "exceljs", "docx", "pdf-lib", "@pdf-lib/fontkit"],
    // exceljs 的依赖 async-function / generator-function 在新版 Node 下按 module-sync 条件解析到 require.mjs，
    // 文件追踪漏掉它们，打包后读写 Excel 会报 Cannot find module，这里显式带上。
    outputFileTracingIncludes: {
      "/api/ktu/import": ["./node_modules/{async-function,generator-function}/*.mjs"],
      "/api/ktu/import/template": ["./node_modules/{async-function,generator-function}/*.mjs"],
    },
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
