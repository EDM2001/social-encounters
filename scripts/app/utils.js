import { MODULE_ID, IMAGE_EXTENSIONS } from "./constants.js";

export function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

export function isMediaFile(path) {
  const lower = String(path ?? "").trim().toLowerCase();
  const clean = lower.split(/[?#]/)[0];
  return IMAGE_EXTENSIONS.some((ext) => clean.endsWith(ext));
}

export function getFilePickerClass() {
  const implementation = foundry?.applications?.apps?.FilePicker?.implementation;
  return implementation ?? globalThis.FilePicker;
}
