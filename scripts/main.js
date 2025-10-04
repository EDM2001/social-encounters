const MODULE_ID = "social-encounters";
const FILE_TYPE = "imagevideo";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SETTING_KEYS = {
  IMAGE_FOLDER: "imageFolder"
};

const SOCKET_EVENTS = {
  SHOW: "show",
  UPDATE: "update",
  CLOSE: "close"
};

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".webm", ".mp4"];

function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

function isMediaFile(path) {
  const lower = path?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

class ImageFolderBrowser extends Application {
  constructor(options = {}) {
    super(options);
    this.source = FilePicker.defaultOptions?.source ?? "data";
    this.folder = game.settings.get(MODULE_ID, SETTING_KEYS.IMAGE_FOLDER) || null;
    this.background = null;
    this.images = [];
    this.selected = new Set();
    this._initialLoadComplete = false;
  }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-browser`,
      classes: [MODULE_ID, "image-browser"],
      template: `modules/${MODULE_ID}/templates/image-browser.hbs`,
      title: game.i18n.localize("SOCIALENCOUNTERS.BrowserTitle"),
      width: 640,
      height: 720,
      resizable: true,
      scrollY: [".image-list"],
      popOut: true
    });
  }

  static show() {
    if (!this._instance) this._instance = new this();
    this._instance.render(true);
    void this._instance.#ensureInitialLoad();
    return this._instance;
  }

  getData() {
    return {
      folder: this.folder,
      background: this.background,
      images: this.images,
      hasImages: this.images.length > 0,
      selectedCount: this.selected.size
    };
  }

  async #ensureInitialLoad() {
    if (this._initialLoadComplete) return;
    this._initialLoadComplete = true;
    if (!this.folder) return;
    try {
      await this.#loadFolder(this.folder, { updateSetting: false, quiet: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load initial folder`, error);
    }
  }

  #defaultSource() {
    return FilePicker.defaultOptions?.source ?? "data";
  }

  #setSource(source) {
    if (!source) return;
    this.source = source;
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
    const resolved = source ?? fallback ?? this.source ?? this.#defaultSource();
    this.#setSource(resolved);
  }

  #normalizePath(path) {
    if (!path) return null;
    const { source, target } = this.#splitSource(path);
    const cleaned = (target ?? path ?? "").replace(/\+/g, "/");
    return source ? `${source}:${cleaned}` : cleaned;
  }

  #normalizeFolder(path) {
    const normalized = this.#normalizePath(path);
    if (normalized == null) return null;
    return normalized.replace(/\/+$/, "");
  }

  #prepareBrowse(path) {
    const normalized = this.#normalizeFolder(path);
    if (normalized == null) return null;
    const { source, target } = this.#splitSource(normalized);
    const browseSource = source ?? this.source ?? this.#defaultSource();
    const base = target ?? normalized ?? "";
    const browseTarget = base && !base.endsWith("/") ? `${base}/` : base;
    this.#setSource(browseSource);
    return {
      normalized,
      browseSource,
      browseTarget
    };
  }

  async #promptFile({ type, current }) {
    const normalizedCurrent = this.#normalizePath(current ?? "");
    return new Promise((resolve) => {
      let resolved = false;
      const picker = new FilePicker({
        type,
        current: normalizedCurrent ?? "",
        callback: (path) => {
          resolved = true;
          this.#rememberSource(path, picker.activeSource);
          resolve(this.#normalizePath(path));
          picker.close();
        },
        onClose: () => {
          if (!resolved) resolve(null);
        }
      });
      picker.render(true);
    });
  }
  async #promptFolder() {
    const selected = await this.#promptFile({ type: FILE_TYPE, current: this.folder });
    if (!selected) return null;

    const { source, target } = this.#splitSource(selected);
    const candidate = target ?? selected;
    if (!isMediaFile(candidate)) return this.#normalizeFolder(selected);

    const segments = candidate.split("/");
    segments.pop();
    const folder = segments.join("/");
    const folderPath = source ? `${source}:${folder}` : folder;
    return this.#normalizeFolder(folderPath);
  }
  async #promptBackground() {
    const selected = await this.#promptFile({ type: FILE_TYPE, current: this.background ?? this.folder });
    if (!selected) return null;

    const { target } = this.#splitSource(selected);
    const candidate = target ?? selected;
    if (!isMediaFile(candidate)) {
      ui.notifications?.warn(game.i18n.localize("SOCIALENCOUNTERS.InvalidBackground"));
      return null;
    }

    return this.#normalizePath(selected);
  }

  async #loadFolder(path, { updateSetting = false, quiet = false } = {}) {
    if (!path) return;

    const browse = this.#prepareBrowse(path);
    if (!browse) return;

    const { normalized, browseSource, browseTarget } = browse;
    try {
      const result = await FilePicker.browse(browseSource, browseTarget, {
        extensions: IMAGE_EXTENSIONS
      });
      const previous = new Set(this.selected);
      const images = result.files
        .filter((file) => isMediaFile(file))
        .map((file) => ({
          path: file,
          name: file.split("/").pop(),
          selected: previous.has(file)
        }));

      this.folder = normalized;
      this.images = images;
      this.selected = new Set(images.filter((img) => img.selected).map((img) => img.path));
      await this.render(false);

      if (updateSetting && game.user?.isGM) {
        await game.settings.set(MODULE_ID, SETTING_KEYS.IMAGE_FOLDER, normalized);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to browse folder`, error);
      if (!quiet) ui.notifications?.error(error.message ?? "Failed to browse folder");
    }
  }
  #updateSelection(path, isSelected) {
    if (isSelected) this.selected.add(path);
    else this.selected.delete(path);

    const match = this.images.find((img) => img.path === path);
    if (match) match.selected = isSelected;
  }

  async #selectAll() {
    for (const image of this.images) {
      image.selected = true;
      this.selected.add(image.path);
    }
    await this.render(false);
  }

  async #clearSelection() {
    for (const image of this.images) {
      image.selected = false;
    }
    this.selected.clear();
    await this.render(false);
  }

  async #launchViewer() {
    const ordered = this.images
      .filter((img) => this.selected.has(img.path))
      .map((img) => img.path);

    if (!ordered.length) {
      ui.notifications?.warn(game.i18n.localize("SOCIALENCOUNTERS.NotifyNoImages"));
      return;
    }

    ImageViewer.show({ images: ordered, background: this.background });
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="choose-folder"]').on("click", async () => {
      const folder = await this.#promptFolder();
      if (!folder) return;
      await this.#loadFolder(folder, { updateSetting: true });
    });

    html.find('[data-action="choose-background"]').on("click", async () => {
      const bg = await this.#promptBackground();
      if (!bg) return;
      this.background = bg;
      await this.render(false);
      if (game.user?.isGM) ImageViewer.syncWithPlayers();
    });

    html.find('[data-action="clear-background"]').on("click", async () => {
      this.background = null;
      await this.render(false);
      if (game.user?.isGM) ImageViewer.syncWithPlayers();
    });

    html.find('[data-action="select-all"]').on("click", () => this.#selectAll());
    html.find('[data-action="clear-selection"]').on("click", () => this.#clearSelection());

    html.find('[data-action="launch-viewer"]').on("click", () => this.#launchViewer());

    html.find('input[data-action="toggle-image"]').on("change", (event) => {
      const target = event.currentTarget;
      const path = target.value;
      const isSelected = target.checked;
      this.#updateSelection(path, isSelected);
      target.closest(".image-card")?.classList.toggle("selected", isSelected);
      html.find(".selection-count").text(this.selected.size.toString());
    });
  }
}

class ImageViewer extends Application {
  constructor({ images, background = null } = {}) {
    super();
    this.images = images;
    this.background = background;
    this.index = 0;
    this._keyHandler = null;
  }

  static get defaultOptions() {
    const defaults = super.defaultOptions;
    const { innerWidth, innerHeight } = window;
    return foundry.utils.mergeObject(defaults, {
      id: `${MODULE_ID}-viewer`,
      classes: [MODULE_ID, "image-viewer"],
      template: `modules/${MODULE_ID}/templates/image-viewer.hbs`,
      popOut: false,
      minimizable: false,
      resizable: false,
      draggable: false,
      width: innerWidth ?? defaults.width ?? 800,
      height: innerHeight ?? defaults.height ?? 600
    });
  }

  async _render(force, options) {
    const result = await super._render(force, options);
    if (this.element?.length) {
      const isGM = game.user?.isGM ?? false;
      this.element.toggleClass('viewer-fullscreen', !isGM);

      if (!isGM) {
        const width = window.innerWidth ?? this.element.width() ?? 800;
        const height = window.innerHeight ?? this.element.height() ?? 600;
        this.element.css({ left: 0, top: 0, width, height });
      } else {
        const viewportWidth = window.innerWidth ?? 1600;
        const viewportHeight = window.innerHeight ?? 900;
        const marginLeft = 320;
        const marginTop = 60;
        const sidebarWidth = 360;
        const gutter = 24;
        const maxWidth = Math.max(viewportWidth - sidebarWidth - gutter, 320);
        const width = Math.min(maxWidth, 1400);
        const maxLeft = Math.max(viewportWidth - sidebarWidth - width, 0);
        const left = Math.min(marginLeft, maxLeft);
        const availableHeight = Math.max(viewportHeight - marginTop - gutter, 320);
        const height = Math.min(availableHeight, 820);
        const maxTop = Math.max(viewportHeight - height - gutter, 0);
        const top = Math.min(Math.max((viewportHeight - height) / 2, marginTop), maxTop);
        this.setPosition({ left, top, width, height });
        this.bringToTop();
      }
    }
    return result;
  }

  static show({ images, background, startIndex = 0, broadcast = true } = {}) {
    this.registerSocket();
    const prepared = Array.isArray(images) ? Array.from(images) : [];
    if (!prepared.length) return null;
    if (this._instance) this.closeActive({ animate: false, broadcast: false });
    const instance = new this({ images: prepared, background });
    instance.index = Math.min(Math.max(startIndex, 0), prepared.length - 1);
    this._instance = instance;
    instance.render(true);

    if (broadcast && game.user?.isGM) {
      this.broadcastShow({ images: prepared, background, index: instance.index });
    }

    return instance;
  }

  static closeActive({ animate = false, broadcast = true } = {}) {
    if (!this._instance) return null;
    return this._instance.close({ animate, broadcast });
  }

  static broadcastShow({ images, background, index = 0 }) {
    if (!game?.socket || !game.user?.isGM) return;
    if (!Array.isArray(images) || !images.length) return;

    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENTS.SHOW,
      userId: game.user.id,
      images,
      background,
      index
    });
  }

  static broadcastUpdate({ index, background, images } = {}) {
    if (!game?.socket || !game.user?.isGM) return;
    const payload = {
      type: SOCKET_EVENTS.UPDATE,
      userId: game.user.id
    };
    if (typeof index === 'number' && Number.isFinite(index)) payload.index = index;
    if (typeof background !== 'undefined') payload.background = background;
    if (Array.isArray(images) && images.length) payload.images = images;
    game.socket.emit(SOCKET_CHANNEL, payload);
  }

  static broadcastClose() {
    if (!game?.socket || !game.user?.isGM) return;
    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENTS.CLOSE,
      userId: game.user.id
    });
  }

  static syncWithPlayers({ includeImages = false } = {}) {
    if (!game.user?.isGM) return;
    if (!this._instance) return;
    const payload = {
      index: this._instance.index,
      background: this._instance.background
    };
    if (includeImages) payload.images = Array.isArray(this._instance.images) ? Array.from(this._instance.images) : [];
    this.broadcastUpdate(payload);
  }

  static registerSocket() {
    if (this._socketRegistered || !game?.socket) return;

    game.socket.on(SOCKET_CHANNEL, (payload = {}) => {
      const { type, userId } = payload;
      if (!type) return;
      if (userId === game.user.id) return;

      switch (type) {
        case SOCKET_EVENTS.SHOW: {
          const { images, background, index = 0 } = payload;
          if (!Array.isArray(images) || !images.length) return;
          this.show({ images, background, startIndex: index, broadcast: false });
          break;
        }
        case SOCKET_EVENTS.UPDATE: {
          const { images, background, index } = payload;
          if (Array.isArray(images) && images.length) {
            this.show({ images, background, startIndex: index ?? 0, broadcast: false });
            break;
          }
          const instance = this._instance;
          if (!instance) return;
          if (typeof background !== 'undefined') instance.background = background;
          if (typeof index === 'number' && Number.isFinite(index)) {
            instance.index = Math.min(Math.max(index, 0), Math.max(instance.images.length - 1, 0));
          }
          instance.render(false);
          break;
        }
        case SOCKET_EVENTS.CLOSE:
          this.closeActive({ animate: false, broadcast: false });
          break;
        default:
          break;
      }
    });

    this._socketRegistered = true;
  }

  getData() {
    const total = this.images.length;
    const current = this.images[this.index] ?? null;
    const labelFor = (idx) => {
      const label = game?.i18n?.format?.("SOCIALENCOUNTERS.ViewerThumbnailLabel", { index: idx + 1 });
      return label ?? `Image ${idx + 1}`;
    };
    const thumbnails = this.images.map((path, idx) => ({
      path,
      index: idx,
      label: labelFor(idx),
      active: idx === this.index
    }));
    return {
      background: this.background,
      current,
      thumbnails,
      index: this.index + 1,
      total
    };
  }

  #advance(step) {
    if (!this.images.length) return;
    const nextIndex = (this.index + step + this.images.length) % this.images.length;
    this.#showAt(nextIndex);
  }

  #showAt(index) {
    if (!this.images.length) return;
    const bounded = Math.min(Math.max(index, 0), this.images.length - 1);
    if (bounded === this.index) return;
    this.index = bounded;
    this.render(false);

    if (game.user?.isGM) this.constructor.syncWithPlayers();
  }

  #attachKeyHandler() {
    if (this._keyHandler) return;
    this._keyHandler = (event) => {
      switch (event.key) {
        case "ArrowRight":
        case "Space":
        case "Enter":
          event.preventDefault();
          this.#advance(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          this.#advance(-1);
          break;
        case "Escape":
          event.preventDefault();
          this.close();
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", this._keyHandler);
  }

  async close(options = {}) {
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
      this._keyHandler = null;
    }

    const { broadcast = true, ...rest } = options;
    const shouldBroadcast = broadcast && typeof this.constructor.broadcastClose === "function" && game.user?.isGM;
    if (shouldBroadcast) this.constructor.broadcastClose();

    const result = await super.close(rest);
    this.constructor._instance = null;
    return result;
  }

  activateListeners(html) {
    super.activateListeners(html);
    this.#attachKeyHandler();

    html.find('[data-action="close"]').on("click", () => this.close());
    html.find('[data-action="select-image"]').on("click", (event) => {
      const button = event.currentTarget;
      const index = Number.parseInt(button?.dataset?.index ?? "", 10);
      if (Number.isNaN(index)) return;
      this.#showAt(index);
    });
    html.find('.viewer-image').on("click", () => this.#advance(1));

    const activeThumb = html.find('.viewer__thumb.is-active').get(0);
    activeThumb?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }
}

ImageViewer._instance = null;
ImageViewer._socketRegistered = false;

globalThis.SocialEncounters = {
  openBrowser: () => ImageFolderBrowser.show()
};

Hooks.once("init", () => {
  log("Initializing module");

  game.settings.register(MODULE_ID, SETTING_KEYS.IMAGE_FOLDER, {
    name: game.i18n.localize("SOCIALENCOUNTERS.Settings.ImageFolder.Name"),
    hint: game.i18n.localize("SOCIALENCOUNTERS.Settings.ImageFolder.Hint"),
    scope: "world",
    config: true,
    type: String,
    default: "",
    filePicker: "folder"
  });
});

Hooks.once("ready", () => {
  ImageViewer.registerSocket();
});

Hooks.on("getSceneControlButtons", (controls) => {
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
        icon: "fas fa-folder-open",
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
});
