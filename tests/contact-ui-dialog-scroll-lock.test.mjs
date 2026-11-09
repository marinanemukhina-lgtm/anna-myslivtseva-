import test from "node:test";
import assert from "node:assert/strict";
import { lockDocumentScroll } from "../src/dialog-scroll-lock.mjs";
function style(initial = "") {
  const values = { overflow: initial }; const priorities = {};
  return {
    getPropertyValue: key => values[key] || "",
    getPropertyPriority: key => priorities[key] || "",
    setProperty: (key, value, priority = "") => { values[key] = value; priorities[key] = priority; },
    removeProperty: key => { delete values[key]; delete priorities[key]; },
  };
}
const documentStub = () => ({ documentElement: { style: style("auto") }, body: { style: style("") } });
test("scroll lock restores exact initial values", () => {
  const doc = documentStub(); const release = lockDocumentScroll(doc);
  assert.equal(doc.documentElement.style.getPropertyValue("overflow"), "hidden");
  assert.equal(doc.body.style.getPropertyValue("overflow"), "hidden");
  release();
  assert.equal(doc.documentElement.style.getPropertyValue("overflow"), "auto");
  assert.equal(doc.body.style.getPropertyValue("overflow"), "");
});
test("multiple instances and duplicate cleanup do not unlock prematurely", () => {
  const doc = documentStub(); const releaseA = lockDocumentScroll(doc); const releaseB = lockDocumentScroll(doc);
  releaseA(); releaseA();
  assert.equal(doc.body.style.getPropertyValue("overflow"), "hidden");
  releaseB(); assert.equal(doc.body.style.getPropertyValue("overflow"), "");
});
test("cleanup does not overwrite another explicit later change", () => {
  const doc = documentStub(); const release = lockDocumentScroll(doc);
  doc.body.style.setProperty("overflow", "clip");
  release(); assert.equal(doc.body.style.getPropertyValue("overflow"), "clip");
});
test("server/no-document guard is inert", () => { lockDocumentScroll(null)(); });
test("lock change notifications let the app suspend smooth scrolling without changing motion preference", async () => {
 const { isDocumentScrollLocked } = await import("../src/dialog-scroll-lock.mjs");
 const doc = documentStub(), events = [];
 doc.defaultView = { Event };
 doc.dispatchEvent = event => events.push([event.type, isDocumentScrollLocked(doc)]);
 const a = lockDocumentScroll(doc), b = lockDocumentScroll(doc);
 assert.equal(isDocumentScrollLocked(doc), true);
 a(); assert.equal(isDocumentScrollLocked(doc), true);
 b(); assert.equal(isDocumentScrollLocked(doc), false);
 assert.deepEqual(events.map(e => e[1]), [true, true, false]);
});
