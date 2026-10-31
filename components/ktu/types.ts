import type { KtuTemplateDef } from "@/lib/ktu/catalog";

export type KtuCityView = { id: string; name: string; tier: string; venues: Array<{ id: string; name: string; district: string }> };

export type KtuTemplateView = KtuTemplateDef & { id: string };

export type KtuPageView = {
  sectionId: string; title: string; copy: string | null; text: string; description: string; imageUrl: string | null;
  redrawing: boolean; redrawError: string; versions: Array<{ assetId: string; imageUrl: string | null; current: boolean }>;
  needsCheck: boolean; unchecked: boolean; discarded: boolean; issues: string[];
};

export type KtuJobState = "running" | "done" | "incomplete" | "failed" | "stopped";

export type KtuJobView = {
  id: string;
  projectId: string;
  templateKey: string;
  templateName: string;
  cityName: string;
  aspect: string;
  createdAt: string;
  finishedAt: string | null;
  exportedPath: string | null;
  scheduled: boolean;
  reviewEnabled: boolean;
  state: KtuJobState;
  runStatus: string | null;
  stage: string;
  error: string | null;
  generated: number;
  total: number;
  /** 没画出来的张数 */
  missing: number;
  /** 检查没通过、建议看一眼的张数 */
  needsCheck: number;
  pages: KtuPageView[];
  post: { title: string; caption: string; hashtags: string[] } | null;
  compliance: Array<{ word: string; category: string; where: string }>;
  /** 详情页才有：生成记录里更新的一套 / 更早的一套 */
  newerId?: string | null;
  olderId?: string | null;
};

export type KtuBatchView = {
  id: string; kind: string; name: string; status: string; planned: number; nextIndex: number; succeeded: number; failed: number; message: string | null; startedAt: string; finishedAt: string | null;
  queued: Array<{ cityName: string; templateName: string }>;
  concurrency: { configured: number; effective: number };
};

export const JOB_STATE_LABEL: Record<KtuJobState, string> = {
  running: "生成中", done: "已完成", incomplete: "没画完", failed: "没完成", stopped: "已停止",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "运行中", completed: "已完成", partial: "部分完成", failed: "未完成", quota: "额度不足", stopped: "已停止", skipped: "本次跳过",
};

/** 卡片和详情页上的一句状态：生成中写到哪一步，完成了写有几张要看。 */
export function jobStatusLine(job: Pick<KtuJobView, "state" | "stage" | "generated" | "total" | "missing" | "needsCheck">) {
  if (job.state === "running") return job.stage ? `生成中 · ${job.stage}` : "生成中";
  if (job.state === "done") return job.needsCheck ? `已完成 · ${job.needsCheck} 张建议看一眼` : "已完成";
  if (job.state === "incomplete") return `没画完 · ${job.missing} 张没画出来`;
  return JOB_STATE_LABEL[job.state];
}

/** 「3 分钟」「1 小时 5 分」这类用时。 */
export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
}
