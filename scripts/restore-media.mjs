import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, '.media-parts/manifest.json'), 'utf8'));
for (const asset of manifest) {
  const chunks = [];
  for (const part of asset.parts) chunks.push(Buffer.from(await readFile(path.join(root, part), 'utf8'), 'base64'));
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Повреждён медиафайл: ${asset.path}`);
  }
  await mkdir(path.dirname(path.join(root, asset.path)), { recursive: true });
  await writeFile(path.join(root, asset.path), bytes);
}
console.log(`Восстановлены медиафайлы без изменения качества: ${manifest.length}`);
