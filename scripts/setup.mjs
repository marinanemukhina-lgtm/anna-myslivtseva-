import { scryptSync, randomBytes } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import readline from "node:readline";
if (!process.stdin.isTTY) {
  console.error("Запустите npm run setup в интерактивном терминале.");
  process.exit(1);
}
const ask = (prompt) =>
  new Promise((resolve) => {
    process.stdout.write(prompt);
    let s = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const fn = (b) => {
      for (const c of b.toString()) {
        if (c === "\u0003") process.exit(1);
        if (c === "\r" || c === "\n") {
          process.stdin.off("data", fn);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(s);
          return;
        }
        if (c === "\u007f") s = s.slice(0, -1);
        else s += c;
      }
    };
    process.stdin.on("data", fn);
  });
const p = await ask("Новый пароль администратора (не менее 12 символов): ");
if (p.length < 12 || p.length > 256) {
  console.error("Нужно от 12 до 256 символов.");
  process.exit(1);
}
if (p !== (await ask("Повторите пароль: "))) {
  console.error("Пароли не совпали.");
  process.exit(1);
}
const salt = randomBytes(16).toString("hex"),
  value = salt + ":" + scryptSync(p, salt, 64).toString("hex");
let old = "";
try {
  old = await readFile(".env", "utf8");
} catch {}
await writeFile(
  ".env",
  old.replace(/^ADMIN_PASSWORD_HASH=.*\n?/m, "") +
    "\nADMIN_PASSWORD_HASH=" +
    value +
    "\n",
  { mode: 0o600 },
);
console.log(
  "Пароль настроен. Перезапустите сервер. Для Vercel перенесите ADMIN_PASSWORD_HASH из .env в настройки проекта.",
);
