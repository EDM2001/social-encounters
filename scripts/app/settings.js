import { MODULE_ID, SETTING_KEYS } from "./constants.js";
import { log } from "./utils.js";

export function registerModuleSettings() {
  log("Initializing module");

  game.settings.register(MODULE_ID, SETTING_KEYS.NPC_FOLDER, {
    name: game.i18n.localize("SOCIALENCOUNTERS.Settings.NPCFolder.Name"),
    hint: game.i18n.localize("SOCIALENCOUNTERS.Settings.NPCFolder.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "",
    filePicker: "folder"
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.BACKGROUND_FOLDER, {
    name: game.i18n.localize("SOCIALENCOUNTERS.Settings.BackgroundFolder.Name"),
    hint: game.i18n.localize("SOCIALENCOUNTERS.Settings.BackgroundFolder.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "",
    filePicker: "folder"
  });
}
