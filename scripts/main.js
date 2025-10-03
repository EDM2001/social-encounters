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

  async #promptFile({ type, current }) {
    return new Promise((resolve) => {
      let resolved = false;
      const picker = new FilePicker({
        type,
        current: current ?? "",
        callback: (path) => {
          resolved = true;
          resolve(path);
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
    const path = await this.#promptFile({ type: FILE_TYPE, current: this.folder });
    if (!path) return null;
    if (!isMediaFile(path)) return this.#normalizeFolder(path);
    const parts = path.split("/");
    parts.pop();
    return this.#normalizeFolder(parts.join("/"));
  }

  async #promptBackground() {
    const path = await this.#promptFile({ type: FILE_TYPE, current: this.background ?? this.folder });
    if (!path) return null;
    if (!isMediaFile(path)) {
      ui.notifications?.warn(game.i18n.localize("SOCIALENCOUNTERS.InvalidBackground"));
      return null;
    }
    return path;
  }

  #normalizeFolder(path) {
    if (!path) return null;
    return path.replace(/\\+/g, "/").replace(/\/+$/, "");
  }

  async #loadFolder(path) {
    if (!path) return;
    const folder = this.#normalizeFolder(path);
    const target = folder.endsWith("/") ? folder : `${folder}/`;
    try {
      const result = await FilePicker.browse(FILE_TYPE, target);
      const previous = new Set(this.selected);
      const images = result.files
        .filter((file) => isMediaFile(file))
        .map((file) => ({
          path: file,
          name: file.split("/").pop(),
          selected: previous.has(file)
        }));

      this.folder = folder;
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
  controls.push({
    name: MODULE_ID,
    title: game.i18n.localize("SOCIALENCOUNTERS.ControlTitle"),
    icon: "fas fa-images",
    layer: null,
    tools: [
      {
        name: "open",
        title: game.i18n.localize("SOCIALENCOUNTERS.OpenBrowser"),
        icon: "fas fa-folder-open",
        button: true,
        onClick: () => ImageFolderBrowser.show()
      }
    ]
  });
});
