import { MODULE_ID } from "./constants.js";
import { log } from "./utils.js";
import { ImageFolderBrowser } from "./image-browser.js";

export function registerSceneControls(controls) {
  if (!game.user?.isGM) return;

  const controlDefinition = {
    name: MODULE_ID,
    title: game.i18n.localize("SOCIALENCOUNTERS.ControlTitle"),
    icon: "fas fa-images",
    layer: null,
    order: Number.MAX_SAFE_INTEGER,
    visible: true,
    tools: [
      {
        name: "open",
        title: game.i18n.localize("SOCIALENCOUNTERS.OpenBrowser"),
        icon: "fas fa-book-open",
        button: true,
        onClick: () => ImageFolderBrowser.show()
      }
    ]
  };

  const registerControl = (target) => {
    if (!target) return false;

    const exists = (predicate) => {
      try {
        return predicate();
      } catch {
        return false;
      }
    };

    if (Array.isArray(target)) {
      if (target.some((entry) => entry?.name === MODULE_ID)) return true;
      target.push(controlDefinition);
      return true;
    }

    if (typeof target.set === "function") {
      if (exists(() => target.has?.(MODULE_ID)) || exists(() => target.get?.(MODULE_ID))) return true;
      target.set(MODULE_ID, controlDefinition);
      return true;
    }

    if (typeof target === "object") {
      if (target[MODULE_ID]) return true;
      const toolMap = controlDefinition.tools.reduce((acc, tool) => {
        acc[tool.name] = tool;
        return acc;
      }, {});
      target[MODULE_ID] = {
        ...controlDefinition,
        tools: toolMap
      };
      return true;
    }

    return false;
  };

  if (registerControl(controls)) return;
  if (registerControl(controls?.controls)) return;

  log("Unable to register scene control buttons; unexpected data", controls);
}
