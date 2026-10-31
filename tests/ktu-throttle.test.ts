import assert from "node:assert/strict";
import test from "node:test";

import { effectiveConcurrency, noteProviderOk, noteProviderStrain, resetThrottle } from "../lib/ktu/throttle";

test("busy site lowers the number of sets run together, two minutes apart at most once", () => {
  resetThrottle();
  assert.equal(effectiveConcurrency(3), 3);
  noteProviderStrain(1_000_000);
  assert.equal(effectiveConcurrency(3), 2);
  noteProviderStrain(1_000_000 + 30_000);
  assert.equal(effectiveConcurrency(3), 2, "a second timeout within the cooldown does not cut again");
  noteProviderStrain(1_000_000 + 130_000);
  assert.equal(effectiveConcurrency(3), 1);
  noteProviderStrain(1_000_000 + 400_000);
  assert.equal(effectiveConcurrency(3), 1, "never below one set");
});

test("eight smooth requests in a row add one set back, up to the configured number", () => {
  resetThrottle();
  noteProviderStrain(2_000_000);
  assert.equal(effectiveConcurrency(4), 3);
  for (let i = 0; i < 7; i++) noteProviderOk();
  assert.equal(effectiveConcurrency(4), 3);
  noteProviderOk();
  assert.equal(effectiveConcurrency(4), 4);
  for (let i = 0; i < 20; i++) noteProviderOk();
  assert.equal(effectiveConcurrency(4), 4);
  resetThrottle();
});

test("a strain resets the smooth streak", () => {
  resetThrottle();
  noteProviderStrain(3_000_000);
  for (let i = 0; i < 7; i++) noteProviderOk();
  noteProviderStrain(3_000_000 + 10_000);
  noteProviderOk();
  assert.equal(effectiveConcurrency(3), 2);
  resetThrottle();
});
