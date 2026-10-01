import test from "node:test";
import assert from "node:assert/strict";
import { apiTime, checkInPayload, requireModuleResponse } from "./moduleContracts.mjs";

test("volunteer times use the backend TimeSpan wire format", () => {
  assert.equal(apiTime("07:18"), "07:18:00");
  assert.equal(apiTime("07:18:30"), "07:18:30");
  assert.equal(apiTime(""), null);
});
test("an omitted date of birth is JSON null, not an invalid empty DateTime", () => {
  assert.deepEqual(checkInPayload({ childName: " Child ", guardianName: " Parent ", childDob: "" }),
    { childName: "Child", guardianName: "Parent", childDob: null });
  assert.equal(checkInPayload({ childName: "Child", guardianName: "Parent", childDob: "2020-01-02" }).childDob, "2020-01-02");
});
test("API failures retain useful validation details and do not expose a bare status", () => {
  assert.throws(() => requireModuleResponse({ ok: false, status: 404, error: "404" }, "Could not load."), /unavailable/);
  assert.throws(() => requireModuleResponse({ ok: false, status: 400, error: '{"errors":{"startTime":["Invalid time"]}}' }, "Failed"), /Invalid time/);
  assert.deepEqual(requireModuleResponse({ ok: true, data: [] }, "Failed"), []);
});
