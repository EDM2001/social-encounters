const MODULE_ID = "social-encounters";
const FILE_TYPE = "imagevideo";

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
    this.folder = null;
    this.background = null;
    this.images = [];
    this.selected = new Set();
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

  async #loadFolder(path) {
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
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to browse folder`, error);
      ui.notifications?.error(error.message ?? "Failed to browse folder");
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
      await this.#loadFolder(folder);
    });

    html.find('[data-action="choose-background"]').on("click", async () => {
      const bg = await this.#promptBackground();
      if (!bg) return;
      this.background = bg;
      await this.render(false);
    });

    html.find('[data-action="clear-background"]').on("click", async () => {
      this.background = null;
      await this.render(false);
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
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-viewer`,
      classes: [MODULE_ID, "image-viewer"],
      template: `modules/${MODULE_ID}/templates/image-viewer.hbs`,
      popOut: false,
      resizable: false
    });
  }

  static show({ images, background }) {
    if (!images?.length) return null;
    if (this._instance) this._instance.close({ animate: false });
    this._instance = new this({ images, background });
    this._instance.render(true);
    return this._instance;
  }

  getData() {
    const current = this.images[this.index] ?? null;
    const hasMultiple = this.images.length > 1;
    return {
      background: this.background,
      current,
      hasPrev: hasMultiple,
      hasNext: hasMultiple,
      index: this.index + 1,
      total: this.images.length
    };
  }

  #advance(step) {
    if (!this.images.length) return;
    this.index = (this.index + step + this.images.length) % this.images.length;
    this.render(false);
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

  async close(options) {
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
      this._keyHandler = null;
    }
    return super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    this.#attachKeyHandler();

    html.find('[data-action="close"]').on("click", () => this.close());
    html.find('[data-action="prev"]').on("click", () => this.#advance(-1));
    html.find('[data-action="next"]').on("click", () => this.#advance(1));
    html.find('.viewer-image').on("click", () => this.#advance(1));
  }
}

globalThis.SocialEncounters = {
  openBrowser: () => ImageFolderBrowser.show()
};

Hooks.once("init", () => {
  log("Initializing module");
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
