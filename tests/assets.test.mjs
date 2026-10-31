import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

test("all literal public media references resolve to shipped files", async () => {
  for (const file of ["src/App.jsx", "shared/content.mjs"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const paths = [...new Set([...source.matchAll(/["'](\/media\/[^"']+)["']/g)].map(match => match[1]))];
    for (const asset of paths) {
      await assert.doesNotReject(
        access(new URL(`../public${asset}`, import.meta.url)),
        `${file} references missing media ${asset}`,
      );
    }
  }
});
