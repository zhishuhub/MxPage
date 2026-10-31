import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const walState = globalThis as unknown as { sqliteWal?: Promise<void> };

/**
 * 切到 WAL 写入模式：几套图同时保存进度时读写不再互相卡住。设置写在数据库文件里，每个进程执行一次即可；
 * 失败不影响使用（只是退回原来的写入方式）。运行时调用，不在模块加载时连库。
 */
export function ensureSqliteWal() {
  walState.sqliteWal ??= prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL").then(() => undefined, () => undefined);
  return walState.sqliteWal;
}
