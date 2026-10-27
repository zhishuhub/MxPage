import test from "node:test";
import assert from "node:assert/strict";
import { describeTiming, nextRunAfter } from "../lib/ktu/schedule-time";
import { BUILTIN_TEMPLATES } from "../lib/ktu/catalog";
import { planRotation } from "../lib/ktu/scheduler";

const templates = (...keys: string[]) => keys.map(key => BUILTIN_TEMPLATES.find(template => template.key === key)!);

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

test("daily schedules run later today or tomorrow", () => {
  const daily = { frequency: "daily" as const, timeOfDay: "09:30", weekdays: [], intervalHours: 24 };
  assert.deepEqual(nextRunAfter(daily, at(26, 8)), at(26, 9, 30));
  assert.deepEqual(nextRunAfter(daily, at(26, 9, 30)), at(27, 9, 30));
  assert.equal(nextRunAfter({ ...daily, timeOfDay: "25:00" }, at(26, 8)), null);
});

test("weekly schedules pick the next selected weekday", () => {
  // 2026-10-26 是周一
  const weekly = { frequency: "weekly" as const, timeOfDay: "20:00", weekdays: [3, 5], intervalHours: 24 };
  assert.deepEqual(nextRunAfter(weekly, at(26, 21)), at(28, 20));
  assert.deepEqual(nextRunAfter(weekly, at(30, 21)), at(35, 20)); // 周五晚上之后是下周三（11-04）
  assert.equal(describeTiming(weekly), "每周三、周五 20:00");
  assert.equal(nextRunAfter({ ...weekly, weekdays: [] }, at(26, 8)), null);
});

test("interval schedules add whole hours", () => {
  const interval = { frequency: "interval" as const, timeOfDay: "", weekdays: [], intervalHours: 6 };
  assert.deepEqual(nextRunAfter(interval, at(26, 8)), at(26, 14));
  assert.equal(nextRunAfter({ ...interval, intervalHours: 0 }, at(26, 8)), null);
});

test("rotation changes city every set, then moves to the next template, skipping cities that lack venues", () => {
  const venues = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${n}-${i}`, name: `店${i}`, district: "", sortOrder: i, lastUsedAt: null }));
  const cities = [{ id: "a", name: "A", venues: venues(5) }, { id: "b", name: "B", venues: venues(2) }, { id: "c", name: "C", venues: venues(4) }];
  const first = planRotation(cities, templates("ranking", "recommend"), 4, { city: 0, template: 0 }, "3:4");
  // B 只有 2 家，不够排行榜（至少 3 家），被跳过；推荐 2 家就够
  assert.deepEqual(first.specs.map(spec => `${spec.cityName}:${spec.templateKey}`), ["A:ranking", "C:ranking", "A:recommend", "B:recommend"]);
  const second = planRotation(cities, templates("ranking", "recommend"), 2, first.cursor, "3:4");
  assert.deepEqual(second.specs.map(spec => `${spec.cityName}:${spec.templateKey}`), ["C:recommend", "A:ranking"]);
  assert.deepEqual(planRotation([{ id: "b", name: "B", venues: venues(2) }], templates("ranking"), 3, { city: 0, template: 0 }, "3:4").specs, []);
});
