import { MODULE_ID, SOCKET_CHANNEL, SOCKET_EVENTS } from "./constants.js";

export class ImageViewer extends Application {
  constructor({ images, background = null } = {}) {
    super();
    this.images = Array.isArray(images) ? Array.from(images) : [];
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
      const width = window.innerWidth ?? this.element.width() ?? 800;
      const height = window.innerHeight ?? this.element.height() ?? 600;
      this.element.addClass("viewer-fullscreen");
      this.setPosition({ left: 0, top: 0, width, height });
      this.element.css({ left: 0, top: 0, width, height });
      this.bringToTop();
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

  static broadcastShow({ images, background, index = 0 } = {}) {
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
    if (typeof index === "number" && Number.isFinite(index)) payload.index = index;
    if (typeof background !== "undefined") payload.background = background;
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
          this.show({ images, background, startIndex: index ?? 0, broadcast: false });
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
          if (typeof background !== "undefined") instance.background = background;
          if (typeof index === "number" && Number.isFinite(index)) {
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
