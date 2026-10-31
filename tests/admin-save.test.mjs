import test from "node:test";
import assert from "node:assert/strict";

test("a save response preserves edits made while saving and advances the server version", async () => {
  const { mergeSavedPayload } = await import("../shared/admin-save.mjs");
  const submitted = { version: 1, data: { title: "submitted" } };
  const current = { version: 1, data: { title: "newer unsaved edit" } };
  const result = { version: 2, data: { title: "submitted" } };
  assert.deepEqual(mergeSavedPayload(current, submitted, result), {
    version: 2, data: { title: "newer unsaved edit" },
  });
  assert.equal(mergeSavedPayload(submitted, submitted, result), result);
});
