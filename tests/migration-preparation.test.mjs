import test from "node:test";
import assert from "node:assert/strict";
import { migrationManifest, compareMigrationManifests } from "../scripts/lib/migration-manifest.mjs";
import { exportClinicalHistory, importClinicalHistory } from "../src/clinical-archive.mjs";
import { restoreClinicalDemo } from "../shared/clinical-demo.mjs";

const fixture = () => ({
  content: [
    { id: "main", body: JSON.stringify({ profile: { name: "Синтетика" }, bookingSchedule: { timezone: "Europe/Moscow" }, bookingOccupancy: { retained: "synthetic interval" }, diplomas: [{ id: "synthetic", image: "/api/media/media-1" }] }), version: 9 },
    { id: "marketing", body: '{"draft":"synthetic unpublished material"}', version: 3 },
  ],
  media: [{ id: "media-1", mime: "image/png", body: Buffer.from("synthetic bytes").toString("base64"), name: "synthetic.png" }],
  sessions: [{ id: "synthetic-hashed-session", expires: "1794096000000" }],
  attempts: [{ id: "synthetic-address-hash", count: 2, expires: "1794096000000" }],
});

test("synthetic snapshot manifest preserves all content rows, private settings, versions and media bytes", () => {
  const source = fixture();
  const restored = JSON.parse(JSON.stringify(source));
  restored.content.reverse();
  restored.sessions[0].expires = 1794096000000;
  assert.deepEqual(compareMigrationManifests(migrationManifest(source), migrationManifest(restored)), []);
  assert.equal(migrationManifest(source).content.rows, 2);
  assert.ok(!JSON.stringify(migrationManifest(source)).includes("unpublished material"));
});

test("count/checksum verification catches dropped marketing, changed photos, stale versions and unknown schema", () => {
  const source = fixture(); const expected = migrationManifest(source);
  const variants = [
    (copy) => copy.content.pop(),
    (copy) => { copy.media[0].body = Buffer.from("changed bytes").toString("base64"); },
    (copy) => { copy.content[0].version = 1; },
    (copy) => { const body = JSON.parse(copy.content[0].body); delete body.bookingOccupancy; copy.content[0].body = JSON.stringify(body); },
    (copy) => { delete copy.media; },
  ];
  for (const change of variants) { const copy = structuredClone(source); change(copy); assert.ok(compareMigrationManifests(expected, migrationManifest(copy)).length > 0); }
  assert.throws(() => migrationManifest({ ...source, unknown_new_table: [] }), /MIGRATION_UNEXPECTED_TABLE/);
  assert.throws(() => migrationManifest({ content: [{ ...source.content[0], newColumn: "do not silently drop" }] }), /MIGRATION_SCHEMA_MISMATCH/);
  assert.throws(() => migrationManifest({ content: [source.content[0], source.content[0]] }), /MIGRATION_INVALID_KEY/);
});

test("all browser-local synthetic histories survive full JSON roundtrip; selected ZIP is not an all-history migration", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUuUAAAAASUVORK5CYII=";
  const state = {
    schema: "anna-open-synthetic-clinical-v2",
    clients: [{ id: "00000000-0000-4000-8000-000000000001", label: "Демо-клиент 001" }, { id: "00000000-0000-4000-8000-000000000002", label: "Демо-клиент 002" }],
    visits: [{ id: "00000000-0000-4000-8000-000000000003", clientId: "00000000-0000-4000-8000-000000000001", date: "2026-11-07", procedure: "Демонстрационная процедура", note: "Вымышленная заметка" }],
    photos: [{ id: "00000000-0000-4000-8000-000000000004", visitId: "00000000-0000-4000-8000-000000000003", angle: "Спереди", data: png }],
  };
  const full = restoreClinicalDemo(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(full, state);
  const selected = importClinicalHistory(exportClinicalHistory(state, state.clients[0].id));
  assert.equal(selected.clients.length, 1);
  assert.deepEqual(selected.visits, state.visits); assert.deepEqual(selected.photos, state.photos);
  assert.notDeepEqual(selected, state, "Sequential ZIP replacement cannot restore all clients together");
});
