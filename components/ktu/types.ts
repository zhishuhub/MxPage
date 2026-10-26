export type KtuCityView = { id: string; name: string; tier: string; venues: Array<{ id: string; name: string; district: string }> };

export type KtuJobView = {
  id: string;
  projectId: string;
  templateKey: string;
  templateName: string;
  cityName: string;
  aspect: string;
  createdAt: string;
  exportedPath: string | null;
  scheduled: boolean;
  state: "running" | "waiting" | "done" | "partial" | "failed" | "stopped";
  runStatus: string | null;
  stage: string;
  error: string | null;
  generated: number;
  total: number;
  pages: Array<{ sectionId: string; title: string; copy: string | null; imageUrl: string | null; needsCheck: boolean; discarded: boolean; issues: string[] }>;
  post: { title: string; caption: string; hashtags: string[] } | null;
  compliance: Array<{ word: string; category: string; where: string }>;
};

export type KtuBatchView = { id: string; kind: string; name: string; status: string; planned: number; nextIndex: number; succeeded: number; failed: number; message: string | null; startedAt: string; finishedAt: string | null };

export const JOB_STATE_LABEL: Record<KtuJobView["state"], string> = {
  running: "生成中", waiting: "生成中", done: "已完成", partial: "部分需检查", failed: "未完成", stopped: "已停止",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "运行中", completed: "已完成", partial: "部分完成", failed: "未完成", quota: "额度不足", stopped: "已停止", skipped: "本次跳过",
};
