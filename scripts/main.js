import { ImageFolderBrowser } from './app/image-browser.js';
import { ImageViewer } from './app/image-viewer.js';
import { registerModuleSettings } from './app/settings.js';
import { registerSceneControls } from './app/controls.js';

globalThis.SocialEncounters = {
  openBrowser: () => ImageFolderBrowser.show()
};

Hooks.once('init', () => {
  registerModuleSettings();
});

Hooks.once('ready', () => {
  ImageViewer.registerSocket();
});

Hooks.on('getSceneControlButtons', registerSceneControls);
