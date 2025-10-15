import { MODULE_ID, SOCKET_CHANNEL, SOCKET_EVENTS } from "./constants.js";

const BODY_VIEWER_CLASS = `${MODULE_ID}-viewer-open`;
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/image-viewer.hbs`;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function clampIndex(index, total) {
  if (!isFiniteNumber(index)) return 0;
  if (total <= 0) return 0;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

function normalizePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths
    .map((path) => (typeof path === "string" ? path.trim() : ""))
    .filter((path) => path.length > 0);
}

function normalizeBackground(background) {
  if (typeof background !== "string") return null;
  const trimmed = background.trim();
  return trimmed.length ? trimmed : null;
}

export class ImageViewer {
  constructor({ images, background = null, startIndex = 0 } = {}) {
    this.images = normalizePaths(images);
    this.background = normalizeBackground(background);
    this.index = clampIndex(startIndex, this.images.length);
    this.element = null;
    this._renderPromise = null;
    this._closingPromise = null;
    this._keysAttached = false;
  }

  static async show({ images, background, startIndex = 0, broadcast = true } = {}) {
    this.registerSocket();
    const prepared = normalizePaths(images);
    if (!prepared.length) return null;

    if (this._instance) {
      await this.closeActive({ animate: false, broadcast: false });
    }

    const instance = new this({ images: prepared, background, startIndex });
    this._instance = instance;

    try {
      await instance.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to render viewer`, error);
      this._instance = null;
      throw error;
    }

    if (broadcast && game.user?.isGM) {
      this.broadcastShow({
        images: Array.from(instance.images),
        background: instance.background,
        index: instance.index
      });
    }

    return instance;
  }

  async render() {
    if (this._closingPromise) await this._closingPromise;

    if (this._renderPromise) {
      try {
        await this._renderPromise;
      } catch {
        // Ignore previous render failure; allow retry.
      }
    }

    this._renderPromise = this.#renderInternal();
    try {
      await this._renderPromise;
    } finally {
      this._renderPromise = null;
    }
    return this;
  }

  async #renderInternal() {
    if (!this.images.length) {
      await this.close({ broadcast: false });
      return;
    }

    if (!this.element) {
      this.element = document.createElement("section");
      this.element.classList.add("app", MODULE_ID, "image-viewer", "viewer-fullscreen");
      this.element.id = `${MODULE_ID}-viewer`;
      this.element.setAttribute("role", "dialog");
      this.element.setAttribute("aria-modal", "true");
      document.body.appendChild(this.element);
    }

    document.body.classList.add(BODY_VIEWER_CLASS);

    const data = this.getTemplateData();
    let html;
    try {
      html = await renderTemplate(TEMPLATE_PATH, data);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to render viewer template`, error);
      throw error;
    }

    this.element.innerHTML = html;
    this.#attachDomListeners();
    this.#attachKeyHandler();
    this.#ensureActiveThumbVisible();
  }

  getTemplateData() {
    const total = Math.max(this.images.length, 0);
    if (total === 0) {
      this.index = 0;
    } else if (this.index >= total) {
      this.index = total - 1;
    } else if (this.index < 0) {
      this.index = 0;
    }

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

    const current = thumbnails[this.index] ?? null;

    return {
      background: this.background,
      current: current?.path ?? null,
      currentLabel: current?.label ?? "",
      thumbnails,
      index: total ? this.index + 1 : 0,
      total
    };
  }

  async close({ broadcast = true } = {}) {
    if (this._closingPromise) return this._closingPromise;

    const performClose = async () => {
      if (this._renderPromise) {
        try {
          await this._renderPromise;
        } catch {
          // Ignore render failure during shutdown.
        }
      }

      if (broadcast && game.user?.isGM) {
        this.constructor.broadcastClose();
      }

      this.#detachKeyHandler();

      if (this.element?.parentElement) {
        this.element.remove();
      }
      this.element = null;

      document.body.classList.remove(BODY_VIEWER_CLASS);

      if (this.constructor._instance === this) {
        this.constructor._instance = null;
      }
    };

    this._closingPromise = performClose()
      .catch((error) => {
        console.error(`${MODULE_ID} | Failed to close viewer`, error);
        throw error;
      })
      .finally(() => {
        this._closingPromise = null;
      });

    return this._closingPromise;
  }

  #attachDomListeners() {
    if (!this.element) return;

    const closeButton = this.element.querySelector('[data-action="close"]');
    closeButton?.addEventListener("click", this.#handleCloseClick, { once: true });

    const image = this.element.querySelector(".viewer__image");
    image?.addEventListener("click", this.#handleImageClick);

    this.element
      .querySelectorAll('[data-action="select-image"]')
      .forEach((button) => button.addEventListener("click", this.#handleThumbClick));
  }

  #ensureActiveThumbVisible() {
    const activeThumb = this.element?.querySelector(".viewer__thumb.is-active");
    if (!activeThumb) return;
    try {
      activeThumb.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
    } catch {
      // Ignore inability to scroll into view.
    }
  }

  #attachKeyHandler() {
    if (this._keysAttached) return;
    document.addEventListener("keydown", this.#handleKeyDown);
    this._keysAttached = true;
  }

  #detachKeyHandler() {
    if (!this._keysAttached) return;
    document.removeEventListener("keydown", this.#handleKeyDown);
    this._keysAttached = false;
  }

  #advance(step) {
    if (!this.images.length) return;
    const nextIndex = (this.index + step + this.images.length) % this.images.length;
    this.#showAt(nextIndex);
  }

  #showAt(target) {
    if (!this.images.length) return;
    const bounded = clampIndex(target, this.images.length);
    if (bounded === this.index) return;
    this.index = bounded;
    this.#queueRender();
    if (game.user?.isGM) {
      this.constructor.syncWithPlayers();
    }
  }

  #queueRender() {
    this.render().catch((error) => {
      console.error(`${MODULE_ID} | Failed to update viewer`, error);
    });
  }

  #handleThumbClick = (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    const index = Number.parseInt(button?.dataset?.index ?? "", 10);
    if (Number.isNaN(index)) return;
    this.#showAt(index);
  };

  #handleImageClick = (event) => {
    event.preventDefault();
    this.#advance(1);
  };

  #handleCloseClick = (event) => {
    event.preventDefault();
    void this.close();
  };

  #handleKeyDown = (event) => {
    if (this.constructor.active !== this) return;

    switch (event.key) {
      case "ArrowRight":
      case "Enter":
      case "Space":
      case " ":
        event.preventDefault();
        this.#advance(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        this.#advance(-1);
        break;
      case "Escape":
        event.preventDefault();
        void this.close();
        break;
      default:
        break;
    }
  };

  static async closeActive({ animate = false, broadcast = true } = {}) {
    if (!this._instance) return null;
    return this._instance.close({ broadcast });
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
    if (isFiniteNumber(index)) payload.index = index;
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

  static get active() {
    return this._instance ?? null;
  }

  static syncWithPlayers({ includeImages = false } = {}) {
    if (!game.user?.isGM) return;
    const instance = this.active;
    if (!instance) return;

    const payload = {
      index: instance.index,
      background: instance.background
    };

    if (includeImages) {
      payload.images = Array.from(instance.images);
    }

    this.broadcastUpdate(payload);
  }

  static registerSocket() {
    if (this._socketRegistered || !game?.socket) return;

    const handlePayload = async (payload = {}) => {
      const { type, userId } = payload;
      if (!type) return;
      if (userId === game.user?.id) return;

      try {
        switch (type) {
          case SOCKET_EVENTS.SHOW: {
            const { images, background, index = 0 } = payload;
            if (!Array.isArray(images) || !images.length) return;
            await this.show({ images, background, startIndex: index ?? 0, broadcast: false });
            break;
          }
          case SOCKET_EVENTS.UPDATE: {
            const { images, background, index } = payload;
            if (Array.isArray(images) && images.length) {
              await this.show({ images, background, startIndex: index ?? 0, broadcast: false });
              break;
            }
            const instance = this.active;
            if (!instance) return;
            if (typeof background !== "undefined") {
              instance.background = normalizeBackground(background);
            }
            if (isFiniteNumber(index)) {
              instance.index = clampIndex(index, instance.images.length);
            }
            await instance.render();
            break;
          }
          case SOCKET_EVENTS.CLOSE:
            await this.closeActive({ broadcast: false });
            break;
          default:
            break;
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Socket handling failed`, error);
      }
    };

    game.socket.on(SOCKET_CHANNEL, (payload) => {
      void handlePayload(payload);
    });

    this._socketRegistered = true;
  }
}

ImageViewer._instance = null;
ImageViewer._socketRegistered = false;
