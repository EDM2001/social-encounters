import { IMAGE_EXTENSIONS, MODULE_ID, SETTING_KEYS } from "./constants.js";
import { getFilePickerClass, isMediaFile } from "./utils.js";
import { ImageViewer } from "./image-viewer.js";

const BROWSE_EXTENSIONS = Array.from(
  new Set(IMAGE_EXTENSIONS.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)))
);

export class ImageFolderBrowser extends Application {
  constructor(options = {}) {
    super(options);
    const FilePickerClass = getFilePickerClass();
    this.source = FilePickerClass?.defaultOptions?.source ?? "data";
    this.npcFolder = this.#normalizeFolder(game.settings.get(MODULE_ID, SETTING_KEYS.NPC_FOLDER) || "") ?? "";
    this.backgroundFolder = this.#normalizeFolder(game.settings.get(MODULE_ID, SETTING_KEYS.BACKGROUND_FOLDER) || "") ?? "";
    this.npcImages = [];
    this.backgrounds = [];
    this.background = null;
    this.selected = new Set();
    this._initialLoadComplete = false;
    this._initialLoadPromise = null;
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
    const instance = this._instance;

    const openBrowser = async () => {
      await instance.#ensureInitialLoad();
      instance.render(true);
    };
    void openBrowser();

    return instance;
  }

  static handleSettingChange(settingKey, value) {
    if (!this._instance) return;
    const instance = this._instance;

    if (settingKey === SETTING_KEYS.NPC_FOLDER) {
      instance.npcFolder = instance.#normalizeFolder(value ?? "") ?? "";
      void instance.#loadNpcImages()
        .then(() => instance.render(false))
        .catch((error) => console.error(`${MODULE_ID} | Failed to refresh NPC images`, error));
      return;
    }

    if (settingKey === SETTING_KEYS.BACKGROUND_FOLDER) {
      instance.backgroundFolder = instance.#normalizeFolder(value ?? "") ?? "";
      void instance.#loadBackgrounds()
        .then(() => instance.render(false))
        .catch((error) => console.error(`${MODULE_ID} | Failed to refresh background images`, error));
    }
  }

  getData() {
    const backgroundImages = this.backgrounds.map((entry) => ({
      path: entry.path,
      name: this.#extractName(entry.path),
      preview: entry.preview,
      selected: entry.path === this.background
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
    if (this._initialLoadPromise) return this._initialLoadPromise;

    const initialLoad = (async () => {
      await this.#refreshAll({ quiet: true, render: false });
      this._initialLoadComplete = true;
      if (this.rendered) await this.render(false);
    })();

    this._initialLoadPromise = initialLoad;
    try {
      await initialLoad;
    } finally {
      this._initialLoadPromise = null;
    }
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

  #normalizePath(path) {
    if (!path) return null;
    const raw = String(path ?? "").trim();
    if (!raw) return null;
    if (/^(?:data|blob):/i.test(raw)) return raw;
    const { source, target } = this.#splitSource(raw);
    const cleaned = (target ?? raw).replace(/\\+/g, "/");
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

  async #browseFolderEntries(folder) {
    const browse = this.#prepareBrowse(folder);
    if (!browse) return [];
    const FilePickerClass = getFilePickerClass();
    const result = await FilePickerClass.browse(browse.browseSource, browse.browseTarget, {
      extensions: BROWSE_EXTENSIONS
    });

    const rawEntries = [];
    const visited = new Set();
    const flatten = (value) => {
      if (value == null) return;

      if (typeof value === "object" || typeof value === "function") {
        if (visited.has(value)) return;
        visited.add(value);
      }

      if (Array.isArray(value)) {
        for (const entry of value) flatten(entry);
        return;
      }

      if (value instanceof Map || value instanceof Set) {
        for (const entry of value.values()) flatten(entry);
        return;
      }

      if (typeof value === "object") {
        const maybeEntry =
          typeof value.path === "string" ||
          typeof value.url === "string" ||
          typeof value.src === "string" ||
          typeof value.id === "string" ||
          typeof value.name === "string" ||
          typeof value.type === "string";

        if (maybeEntry) rawEntries.push(value);

        for (const entry of Object.values(value)) flatten(entry);
        return;
      }

      rawEntries.push(value);
    };

    flatten(result?.entries);
    flatten(result?.files);
    flatten(result?.results);
    flatten(result?.children);
    flatten(result?.fileEntries);
    flatten(result?.documents);

    const thumbs = result?.thumbs ?? result?.thumbnails ?? {};
    const ensurePreview = (path, candidate) => {
      if (!candidate) return path;
      const normalized = this.#normalizePath(candidate);
      return normalized ?? candidate ?? path;
    };

    const unique = new Map();

    for (const file of rawEntries) {
      if (!file) continue;

      if (typeof file === "string") {
        const path = this.#normalizePath(file);
        if (!path || !isMediaFile(path)) continue;
        const preview = ensurePreview(path, thumbs?.[file] ?? thumbs?.[path]);
        unique.set(path, { path, preview });
        continue;
      }

      const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
      if (type === "directory" || type === "dir" || type === "folder") continue;

      const rawPath = file.path ?? file.url ?? file.src ?? file.id ?? file.name ?? null;
      const normalizedPath = this.#normalizePath(rawPath);
      if (!normalizedPath || !isMediaFile(normalizedPath)) continue;

      const rawPreview =
        file.thumb ??
        file.thumbnail ??
        file.preview ??
        thumbs?.[rawPath] ??
        thumbs?.[normalizedPath] ??
        file.src ??
        file.url ??
        null;
      const preview = ensurePreview(normalizedPath, rawPreview);

      unique.set(normalizedPath, {
        path: normalizedPath,
        preview
      });
    }

    return Array.from(unique.values());
  }

  async #loadNpcImages({ quiet = false } = {}) {
    this.selected = new Set();

    this.npcFolder = this.#normalizeFolder(game.settings.get(MODULE_ID, SETTING_KEYS.NPC_FOLDER) || "") ?? "";

    if (!this.npcFolder) {
      this.npcImages = [];
      return;
    }

    try {
      const entries = await this.#browseFolderEntries(this.npcFolder);
      const previousSelection = new Set(
        this.npcImages.filter((img) => img.selected).map((img) => img.path)
      );
      const hasPreviousSelection = previousSelection.size > 0;

      this.npcImages = entries.map((entry) => {
        const selected = hasPreviousSelection && previousSelection.has(entry.path);
        if (selected) this.selected.add(entry.path);
        return {
          path: entry.path,
          name: this.#extractName(entry.path),
          preview: entry.preview,
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

    this.backgroundFolder = this.#normalizeFolder(game.settings.get(MODULE_ID, SETTING_KEYS.BACKGROUND_FOLDER) || "") ?? "";

    if (!this.backgroundFolder) {
      this.backgrounds = [];
      this.background = null;
      if (previous && game.user?.isGM) ImageViewer.syncWithPlayers();
      return;
    }

    try {
      const entries = await this.#browseFolderEntries(this.backgroundFolder);
      this.backgrounds = entries;
      const hasBackground = entries.some((entry) => entry.path === this.background);
      if (!hasBackground) {
        this.background = entries[0]?.path ?? null;
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

  async #selectBackground(path) {
    if (path === this.background) return;
    this.background = path;
    await this.render(false);
    if (game.user?.isGM) {
      const viewer = ImageViewer.active;
      if (viewer) {
        viewer.background = typeof path === "string" ? path.trim() || null : null;
        viewer.render().catch((error) => console.error(`${MODULE_ID} | Failed to refresh viewer background`, error));
      }
      ImageViewer.syncWithPlayers();
    }
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
    try {
      const viewer = await ImageViewer.show({
        images: ordered,
        background: this.background,
        startIndex: 0,
        broadcast: true
      });
      if (viewer) {
        setTimeout(() => {
          if (!this.rendered) return;
          void this.close({ animate: false }).catch((error) =>
            console.error(`${MODULE_ID} | Failed to close browser`, error)
          );
        }, 0);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to launch viewer`, error);
      ui.notifications?.error(game.i18n.localize("SOCIALENCOUNTERS.ViewerLaunchError"));
    }
  }

  activateListeners(html) {
    super.activateListeners(html);

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
      if (game.user?.isGM) {
        const viewer = ImageViewer.active;
        if (viewer) {
          viewer.background = null;
          viewer.render().catch((error) => console.error(`${MODULE_ID} | Failed to clear viewer background`, error));
        }
        ImageViewer.syncWithPlayers();
      }
    });

    html.find('[data-action="launch-viewer"]').on('click', () => {
      void this.#launchViewer();
    });
  }
}

