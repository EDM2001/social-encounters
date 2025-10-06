import { MODULE_ID, SETTING_KEYS } from "./constants.js";
import { getFilePickerClass, isMediaFile } from "./utils.js";
import { ImageViewer } from "./image-viewer.js";

const BROWSE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
  "webm",
  "mp4"
];

export class ImageFolderBrowser extends Application {
  constructor(options = {}) {
    super(options);
    const FilePickerClass = getFilePickerClass();
    this.source = FilePickerClass?.defaultOptions?.source ?? "data";
    this.npcFolder = game.settings.get(MODULE_ID, SETTING_KEYS.NPC_FOLDER) || "";
    this.backgroundFolder = game.settings.get(MODULE_ID, SETTING_KEYS.BACKGROUND_FOLDER) || "";
    this.npcImages = [];
    this.backgrounds = [];
    this.background = null;
    this.selected = new Set();
    this._initialLoadComplete = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-browser`,
      classes: [MODULE_ID, "image-browser"],
      template: `modules/${MODULE_ID}/templates/image-browser.hbs`,
      title: game.i18n.localize("SOCIALENCOUNTERS.BrowserTitle"),
      width: 760,
      height: 760,
      resizable: true,
      scrollY: [".browser__scroll"],
      popOut: true
    });
  }

  static show() {
    if (!game.user?.isGM) {
      ui.notifications?.warn(game.i18n.localize("SOCIALENCOUNTERS.RequiresGM"));
      return null;
    }
    if (!this._instance) this._instance = new this();
    this._instance.render(true);
    void this._instance.#ensureInitialLoad();
    return this._instance;
  }

  getData() {
    const backgroundImages = this.backgrounds.map((path) => ({
      path,
      name: this.#extractName(path),
      selected: path === this.background
    }));

    return {
      folders: {
        npc: this.npcFolder,
        background: this.backgroundFolder
      },
      npcImages: this.npcImages,
      hasNpcImages: this.npcImages.length > 0,
      backgroundImages,
      hasBackgrounds: backgroundImages.length > 0,
      background: this.background,
      selectedCount: this.selected.size
    };
  }

  async #ensureInitialLoad() {
    if (this._initialLoadComplete) return;
    this._initialLoadComplete = true;
    await this.#refreshAll({ quiet: true, render: false });
    await this.render(false);
  }

  async #refreshAll({ quiet = false, render = true } = {}) {
    await Promise.all([
      this.#loadNpcImages({ quiet }),
      this.#loadBackgrounds({ quiet })
    ]);
    if (render) await this.render(false);
  }

  #splitSource(path) {
    if (!path) return { source: null, target: null };
    const match = path.match(/^([^:]+):(.*)$/);
    if (match && match[2] && !match[2].startsWith("//")) {
      return { source: match[1], target: match[2] };
    }
    return { source: null, target: path };
  }

  #rememberSource(path, fallback) {
    const { source } = this.#splitSource(path);
    const resolved = source ?? fallback ?? this.source;
    this.source = resolved ?? "data";
  }

  #normalizePath(path) {
    if (!path) return null;
    const { source, target } = this.#splitSource(path);
    const cleaned = (target ?? path ?? "").replace(/\\+/g, "/");
    return source ? `${source}:${cleaned}` : cleaned;
  }

  #normalizeFolder(path) {
    const normalized = this.#normalizePath(path);
    if (normalized == null) return null;
    return normalized.replace(/\\+$/, "");
  }

  #prepareBrowse(path) {
    const normalized = this.#normalizeFolder(path);
    if (normalized == null) return null;
    const { source, target } = this.#splitSource(normalized);
    const browseSource = source ?? this.source ?? "data";
    const base = target ?? normalized ?? "";
    const browseTarget = base && !base.endsWith("/") ? `${base}/` : base;
    this.source = browseSource;
    return { browseSource, browseTarget };
  }

  #extractName(path) {
    const normalized = this.#normalizePath(path) ?? "";
    const segments = normalized.split("/");
    return segments.pop() || normalized;
  }

  async #browseFolderPaths(folder) {
    const browse = this.#prepareBrowse(folder);
    if (!browse) return [];
    const FilePickerClass = getFilePickerClass();
    const result = await FilePickerClass.browse(browse.browseSource, browse.browseTarget, {
      extensions: BROWSE_EXTENSIONS
    });
    const files = Array.isArray(result.files) ? result.files : [];
    return files.map((file) => this.#normalizePath(file)).filter(isMediaFile);
  }

  async #loadNpcImages({ quiet = false } = {}) {
    this.selected = new Set();

    if (!this.npcFolder) {
      this.npcImages = [];
      return;
    }

    try {
      const paths = await this.#browseFolderPaths(this.npcFolder);
      const previousSelection = new Set(
        this.npcImages.filter((img) => img.selected).map((img) => img.path)
      );
      const selectByDefault = previousSelection.size === 0 && paths.length > 0;

      this.npcImages = paths.map((path) => {
        const selected = previousSelection.has(path) || selectByDefault;
        if (selected) this.selected.add(path);
        return {
          path,
          name: this.#extractName(path),
          selected
        };
      });

      if (!this.npcImages.length) this.selected.clear();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load NPC images`, error);
      this.npcImages = [];
      this.selected.clear();
      if (!quiet) {
        ui.notifications?.error(game.i18n.localize("SOCIALENCOUNTERS.ImageFolderErrorNPC"));
      }
    }
  }

  async #loadBackgrounds({ quiet = false } = {}) {
    const previous = this.background;

    if (!this.backgroundFolder) {
      this.backgrounds = [];
      this.background = null;
      if (previous && game.user?.isGM) ImageViewer.syncWithPlayers();
      return;
    }

    try {
      const paths = await this.#browseFolderPaths(this.backgroundFolder);
      this.backgrounds = paths;
      if (!paths.includes(this.background)) {
        this.background = paths[0] ?? null;
      }
      if (previous !== this.background && game.user?.isGM) {
        ImageViewer.syncWithPlayers();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load background images`, error);
      this.backgrounds = [];
      this.background = null;
      if (!quiet) {
        ui.notifications?.error(game.i18n.localize("SOCIALENCOUNTERS.BackgroundFolderError"));
      }
    }
  }

  #selectAll() {
    this.selected = new Set();
    for (const image of this.npcImages) {
      image.selected = true;
      this.selected.add(image.path);
    }
  }

  #clearSelection() {
    for (const image of this.npcImages) {
      image.selected = false;
    }
    this.selected.clear();
  }

  #updateSelection(path, isSelected) {
    if (isSelected) this.selected.add(path);
    else this.selected.delete(path);

    const match = this.npcImages.find((img) => img.path === path);
    if (match) match.selected = isSelected;
  }

  async #promptFolderSelection(current) {
    const normalized = this.#normalizeFolder(current ?? "");
    return new Promise((resolve) => {
      let resolved = false;
      const FilePickerClass = getFilePickerClass();
      const picker = new FilePickerClass({
        type: "folder",
        current: normalized ?? "",
        callback: (path) => {
          resolved = true;
          this.#rememberSource(path, picker.activeSource);
          resolve(this.#normalizeFolder(path));
          picker.close();
        },
        onClose: () => {
          if (!resolved) resolve(null);
        }
      });
      picker.render(true);
    });
  }

  async #updateFolder(settingKey, value) {
    const normalized = this.#normalizeFolder(value ?? "") ?? "";
    await game.settings.set(MODULE_ID, settingKey, normalized);

    if (settingKey === SETTING_KEYS.NPC_FOLDER) {
      this.npcFolder = normalized;
      await this.#loadNpcImages();
    }

    if (settingKey === SETTING_KEYS.BACKGROUND_FOLDER) {
      this.backgroundFolder = normalized;
      await this.#loadBackgrounds();
    }

    await this.render(false);
  }

  async #selectBackground(path) {
    if (path === this.background) return;
    this.background = path;
    await this.render(false);
    if (game.user?.isGM) ImageViewer.syncWithPlayers();
  }

  #selectedImagePaths() {
    return this.npcImages.filter((img) => img.selected).map((img) => img.path);
  }

  async #launchViewer() {
    const ordered = this.#selectedImagePaths();
    if (!ordered.length) {
      ui.notifications?.warn(game.i18n.localize("SOCIALENCOUNTERS.NotifyNoImages"));
      return;
    }
    ImageViewer.show({ images: ordered, background: this.background, startIndex: 0, broadcast: true });
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="choose-folder"]').on('click', async (event) => {
      const target = event.currentTarget.dataset.target;
      const current = target === 'background' ? this.backgroundFolder : this.npcFolder;
      const selection = await this.#promptFolderSelection(current);
      if (selection === null) return;
      const settingKey = target === 'background' ? SETTING_KEYS.BACKGROUND_FOLDER : SETTING_KEYS.NPC_FOLDER;
      await this.#updateFolder(settingKey, selection);
    });

    html.find('[data-action="clear-folder"]').on('click', async (event) => {
      const target = event.currentTarget.dataset.target;
      const settingKey = target === 'background' ? SETTING_KEYS.BACKGROUND_FOLDER : SETTING_KEYS.NPC_FOLDER;
      await this.#updateFolder(settingKey, '');
    });

    html.find('[data-action="refresh-folder"]').on('click', (event) => {
      const target = event.currentTarget.dataset.target;
      if (target === 'background') {
        void this.#loadBackgrounds().then(() => this.render(false));
      } else {
        void this.#loadNpcImages().then(() => this.render(false));
      }
    });

    html.find('[data-action="select-all"]').on('click', async () => {
      this.#selectAll();
      await this.render(false);
    });

    html.find('[data-action="clear-selection"]').on('click', async () => {
      this.#clearSelection();
      await this.render(false);
    });

    html.find('input[data-action="toggle-image"]').on('change', (event) => {
      const target = event.currentTarget;
      const path = target.value;
      const isSelected = target.checked;
      this.#updateSelection(path, isSelected);
      target.closest('.image-card')?.classList.toggle('selected', isSelected);
      html.find('.selection-count').text(this.selected.size.toString());
    });

    html.find('[data-action="select-background"]').on('click', (event) => {
      const path = event.currentTarget.dataset.path;
      void this.#selectBackground(path);
    });

    html.find('[data-action="clear-background"]').on('click', async () => {
      this.background = null;
      await this.render(false);
      if (game.user?.isGM) ImageViewer.syncWithPlayers();
    });

    html.find('[data-action="launch-viewer"]').on('click', () => {
      void this.#launchViewer();
    });
  }
}

