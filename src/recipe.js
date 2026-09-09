import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "recipes");

export function fieldSig(f) {
  return [(f.label || "").slice(0, 40), f.placeholder || "", f.control].join("|");
}

export function loadRecipe(host) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, host + ".json"), "utf8"));
  } catch {
    return {};
  }
}

export function saveRecipe(host, recipe) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, host + ".json"), JSON.stringify(recipe, null, 2));
}
