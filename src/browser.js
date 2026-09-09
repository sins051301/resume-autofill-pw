import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function launchBrowser(config) {
  const userDataDir = path.resolve(root, config.userDataDir || "./.userdata");
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: config.chromeChannel || "chrome",
    headless: false,
    viewport: null,
    args: ["--start-maximized"]
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}
