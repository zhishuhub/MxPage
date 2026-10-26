// K图：定时任务下一次运行时间。按本机时区计算，纯函数，方便测试。

export type ScheduleTiming = {
  frequency: "daily" | "weekly" | "interval";
  timeOfDay: string;
  /** 1 = 周一 … 7 = 周日 */
  weekdays: number[];
  intervalHours: number;
};

export function parseTimeOfDay(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return null;
  return { hour, minute };
}

function isoWeekday(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/** 严格晚于 from 的下一次运行时间；配置不完整返回 null（任务不会运行）。 */
export function nextRunAfter(timing: ScheduleTiming, from: Date): Date | null {
  if (timing.frequency === "interval") {
    const hours = Math.round(timing.intervalHours);
    return hours >= 1 && hours <= 168 ? new Date(from.getTime() + hours * 3600_000) : null;
  }
  const time = parseTimeOfDay(timing.timeOfDay);
  if (!time) return null;
  const days = timing.frequency === "weekly" ? [...new Set(timing.weekdays)].filter(day => day >= 1 && day <= 7) : [1, 2, 3, 4, 5, 6, 7];
  if (!days.length) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, time.hour, time.minute, 0, 0);
    if (candidate > from && days.includes(isoWeekday(candidate))) return candidate;
  }
  return null;
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const WEEKDAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function describeTiming(timing: ScheduleTiming) {
  if (timing.frequency === "interval") return `每隔 ${timing.intervalHours} 小时`;
  if (timing.frequency === "weekly") return `每${[...timing.weekdays].sort().map(day => WEEKDAY_NAMES[day]).join("、")} ${timing.timeOfDay}`;
  return `每天 ${timing.timeOfDay}`;
}
