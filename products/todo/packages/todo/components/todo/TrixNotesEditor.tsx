"use client";

/**
 * The notes editor, on Trix.
 *
 * A task note on a Basecamp-linked list is one replica of a Basecamp rich
 * text field, so the editor that writes it should only be able to write
 * what Basecamp keeps. Quill could not: it writes `<p>` where Basecamp
 * keeps `<div>`, offers six heading levels where Basecamp keeps one, and
 * has no idea about attachments. Every note went up, came back rewritten,
 * and lost whatever Basecamp did not recognise.
 *
 * Trix is Basecamp's own editor, so what it writes is what survives.
 * `basecamp-richtext.ts` handles the two places the shapes differ.
 *
 * A dropped or pasted picture goes to Basecamp before it goes in the note.
 * Rich text there cannot hold an `<img>`, only a `<bc-attachment>` naming a
 * file Basecamp has signed, so the bytes are uploaded, the sgid comes back,
 * and Trix keeps it inside `data-trix-attachment` where saving can find it.
 * Until that returns the picture has no sgid, and `pendingAttachments` is
 * how a save knows not to write the note yet.
 */

import * as React from "react";
import { createPortal } from "react-dom";

// Trix's own, for the attachment furniture: previews, captions, the upload
// progress bar and the little toolbar on a selected picture. The notes box
// around it is dressed in todo.css.
import "trix/dist/trix.css";

import {
  basecampToTrix,
  trixToBasecamp,
  type ImageSrcResolver,
} from "@/lib/todo/basecamp-richtext";

/**
 * Trix registers `<trix-editor>` on the custom element registry, which
 * takes the name once for the life of the page. The import is cached, but
 * a hot reload can run this module again, so the registry is asked rather
 * than trusted.
 */
/**
 * Where the browser fetches Trix from. Copied there by scripts/copy-trix.mjs,
 * which both apps run before they build.
 */
const TRIX_URL = "/vendor/trix.esm.min.js";

let loading: Promise<unknown> | null = null;

/**
 * Fetch Trix with a script tag, not with an import.
 *
 * `import("trix")` put the module in the bundler's graph, and that alone
 * stopped `next build`: it compiled, then spun one core at 100% through
 * "Collecting page data" and never came out, so Amplify failed at its
 * thirty-minute cap and the site stayed on the last build that finished.
 * Bisected to the commit that added the import, and measured either way —
 * the build completes with nothing importing it and hangs with any one
 * import back. The dist file makes no difference, minified or not, and
 * neither `transpilePackages` nor a server-side external helped.
 *
 * A script tag is how Trix is used without a bundler, and it is the same
 * module doing the same thing: registering `<trix-editor>` and hanging its
 * configuration on `window.Trix`. Only the delivery changes.
 */
export function loadTrix(): Promise<unknown> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.customElements?.get("trix-editor")) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    // A second editor on the page waits for the first one's tag rather
    // than asking for the file again.
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-trix]"
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Trix did not load from ${TRIX_URL}`)),
      { once: true }
    );
    if (!existing) {
      script.type = "module";
      script.src = TRIX_URL;
      script.dataset.trix = "";
      document.head.appendChild(script);
    }
  })
    .then(configureTrix)
    .catch((err: unknown) => {
      // The next editor to open asks again rather than inheriting a
      // failure from a load that may have been a flake.
      loading = null;
      console.error("[todo] the notes editor could not load:", err);
      throw err;
    });

  return loading;
}

/** Enough of Trix's own configuration object to add to it. */
type TrixGlobal = {
  config: {
    blockAttributes: Record<string, unknown>;
    textAttributes: Record<string, unknown>;
  };
};

/**
 * The headings Basecamp has, rather than the one Trix ships with.
 *
 * Stock Trix offers `heading1` alone. Basecamp's editor offers H2, H3 and
 * H4, its API keeps all of them — measured, against their own docs, which
 * say otherwise — and the old Quill editor could write them. Registering
 * them here is how Basecamp does it too, and without it the swap would
 * quietly take four heading levels down to one.
 */
function configureTrix(): void {
  const Trix = (window as unknown as { Trix?: TrixGlobal }).Trix;
  if (!Trix?.config?.blockAttributes) return;
  for (const level of [2, 3, 4]) {
    const key = `heading${level}`;
    if (Trix.config.blockAttributes[key]) continue;
    Trix.config.blockAttributes[key] = {
      tagName: `h${level}`,
      terminal: true,
      breakOnReturn: true,
      group: false,
    };
  }

  /*
    Underline, which Trix does not have.

    It was left out of the first pass on the grounds that Basecamp does not
    keep `<u>`. Basecamp's own docs say that; Basecamp does not. A tag sent
    through their API came back untouched, so the reason for leaving it out
    was wrong and the button belongs here.
  */
  if (!Trix.config.textAttributes.underline) {
    Trix.config.textAttributes.underline = {
      tagName: "u",
      inheritable: true,
    };
  }
}

/** `#` through `####`, and which block each one makes. */
const HEADING_PREFIX = /^(#{1,4})$/;

/**
 * `# ` makes a heading, as it did in the old editor.
 *
 * Trix carries no markdown of its own, so this reads the line the caret is
 * on and acts when the space bar would have ended a run of hashes. The
 * hashes come out; they were syntax, not words.
 */
function applyHeadingShortcut(editor: TrixEditor): boolean {
  const range = editor.getSelectedRange?.();
  if (!range || range[0] !== range[1]) return false;
  const caret = range[0];
  const text = editor.getDocument?.().toString() ?? "";
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const prefix = text.slice(lineStart, caret);
  const match = HEADING_PREFIX.exec(prefix);
  if (!match) return false;
  const level = match[1].length;
  editor.recordUndoEntry?.("Heading");
  editor.setSelectedRange([lineStart, caret]);
  editor.deleteInDirection("forward");
  editor.activateAttribute(`heading${level}`);
  return true;
}

/**
 * What comes back when the picture has been taken: by Basecamp (an sgid
 * and, once known, a blob), or by the app's own store (a media id and the
 * address it is read from — see media-store.ts).
 */
export type UploadedImage = {
  sgid?: string;
  blobId?: string | null;
  mediaId?: string;
  url?: string;
  contentType?: string;
  filename?: string;
  filesize?: number;
  width?: number | null;
  height?: number | null;
};

export type UploadImage = (
  file: File,
  onProgress: (percent: number) => void
) => Promise<UploadedImage>;

/**
 * One picture, to Basecamp and back onto the attachment.
 *
 * The sgid is written into the attachment's own data, which Trix keeps
 * whole — so the note carries the only thing needed to write a
 * `<bc-attachment>` when it saves, and no table has to remember it.
 *
 * A failure takes the picture out again. Leaving it would leave something
 * on the page that no one else will ever see, which is the thing this is
 * meant to stop.
 */
async function sendAttachment(
  attachment: TrixAttachment,
  upload: UploadImage | undefined,
  /*
    Trix fires no change event for an attribute written on an attachment,
    so the draft never saw the sgid arrive: it still held the version from
    the moment of the drop, where the picture had no sgid and had therefore
    been dropped from the Basecamp HTML entirely. Saving then wrote a note
    with no picture in it, seconds after one was added.
  */
  emit: () => void
): Promise<void> {
  const file = attachment.file;
  if (!file || !upload) {
    attachment.remove();
    return;
  }
  try {
    attachment.setUploadProgress(0);
    const result = await upload(file, (percent) =>
      attachment.setUploadProgress(percent)
    );
    /*
      Only what there is.

      Trix writes these straight into the attachment's own data, and a key
      whose value is `undefined` is not a key it can store — one of them
      was enough to stop the rest of this function, so the progress bar sat
      part-drawn forever over a picture that had in fact arrived.
    */
    const attributes: Record<string, unknown> = {};
    if (result.sgid) attributes.sgid = result.sgid;
    if (result.mediaId) attributes.mediaId = result.mediaId;
    // Kept so the picture survives a save and reopen before any sync.
    if (result.blobId) {
      attributes.blobId = result.blobId;
    }
    /*
      A url, always — measured, this is the hinge of the whole thing.

      Trix serializes a dropped file into the document's value only once
      the attachment has a url; the sgid alone leaves it "pending", drawn
      on screen but invisible to `el.value` — so every save wrote the note
      without the picture that was plainly sitting in it. Basecamp's upload
      response holds nothing but the sgid, so when there is no address to
      point at, the file we are already holding becomes its own: the
      object URL only ever lives inside the editor, because the Basecamp
      shape a save writes carries the sgid and never the url.
    */
    attributes.url =
      result.url ??
      (result.blobId
        ? `/api/todo/basecamp-image/${encodeURIComponent(result.blobId)}`
        : URL.createObjectURL(file));
    if (result.contentType) attributes.contentType = result.contentType;
    if (result.filename) attributes.filename = result.filename;
    if (result.filesize) attributes.filesize = result.filesize;
    if (result.width) attributes.width = result.width;
    if (result.height) attributes.height = result.height;
    attachment.setAttributes(attributes);
    attachment.setUploadProgress(100);
    // `el.value` is a computed serialization, current the moment the
    // attribute is written — measured, not assumed.
    emit();
  } catch {
    attachment.remove();
    emit();
  }
}

/** An id that is safe in `getElementById`, which is how Trix finds these. */
function tameId(raw: string, suffix: string): string {
  return `trix-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}-${suffix}`;
}

type TrixEditor = {
  loadHTML: (html: string) => void;
  getSelectedRange?: () => [number, number];
  setSelectedRange: (range: [number, number]) => void;
  getDocument?: () => { toString: () => string };
  deleteInDirection: (direction: "forward" | "backward") => void;
  activateAttribute: (name: string, value?: unknown) => void;
  recordUndoEntry?: (description: string) => void;
};

/** The part of a Trix attachment this uses. */
type TrixAttachment = {
  file?: File;
  setAttributes: (attributes: Record<string, unknown>) => void;
  setUploadProgress: (percent: number) => void;
  remove: () => void;
};

type TrixEditorElement = HTMLElement & {
  value: string;
  editor?: TrixEditor;
};

/**
 * The bubble's marks.
 *
 * Drawn, not lettered: the editor this replaces had proper icons and a row
 * of capitals reads as text that wandered into the toolbar. One stroke
 * weight and one box for all of them, so they line up.
 */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICONS = {
  /* The overlay a picture opens into. Drawn at the same weight as the
     bubble's, so the two sets of controls look like one family. */
  lightboxClose: (
    <Icon>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  ),
  lightboxBack: (
    <Icon>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  ),
  lightboxOn: (
    <Icon>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  ),
  bold: (
    <Icon>
      <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
    </Icon>
  ),
  italic: (
    <Icon>
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </Icon>
  ),
  strike: (
    <Icon>
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </Icon>
  ),
  heading: (
    <Icon>
      <path d="M6 4v16" />
      <path d="M18 4v16" />
      <path d="M6 12h12" />
    </Icon>
  ),
  quote: (
    <Icon>
      <path d="M3 5v14" />
      <line x1="8" y1="8" x2="21" y2="8" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </Icon>
  ),
  bullet: (
    <Icon>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  ),
  number: (
    <Icon>
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <path d="M4 6h1V3" strokeWidth="1.6" />
      <path d="M3.6 10.4a1.2 1.2 0 1 1 1.9 1.4L3.6 14h2.2" strokeWidth="1.6" />
      <path d="M3.7 17h1.9l-1.3 1.4a1.2 1.2 0 1 1-.6 2.1" strokeWidth="1.6" />
    </Icon>
  ),
  underline: (
    <Icon>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </Icon>
  ),
  link: (
    <Icon>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  ),
};

export function TrixNotesEditor({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  resolveImageSrc,
  uploadImage,
  onPendingChange,
  readCurrentRef,
  onDone,
}: {
  /** Basecamp's HTML, as stored in `notes_html`. */
  value: string;
  /** Basecamp's HTML, after every edit. */
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Where a Basecamp picture can be read from, for this app. */
  resolveImageSrc?: ImageSrcResolver;
  /**
   * Give the file to Basecamp and come back with its sgid. Left out where
   * there is nowhere to put one — an unlinked list, or the focus window —
   * and then a file drop is refused rather than half-accepted.
   */
  uploadImage?: UploadImage;
  /**
   * How many pictures are still on their way to Basecamp. Saving before
   * that reaches zero writes a note without them.
   */
  onPendingChange?: (count: number) => void;
  /**
   * Hands the caller a way to read the note as it stands, straight from
   * the editor. A save that reads its own state instead depends on every
   * emit having arrived through React first, and one missing is a saved
   * note with no picture in it.
   */
  readCurrentRef?: React.MutableRefObject<(() => string) | null>;
  /**
   * ⌘+Enter (Ctrl+Enter elsewhere), when the box has a way to be finished with.
   *
   * The same thing the tick does. A note is a line or two written between
   * two other jobs, and reaching for a button the size of a full stop to
   * put it away is the slow half of writing one. Left out where there is
   * no tick — the out-of-office box is saved with the dialog around it.
   * Shift+Enter is Trix's own line break either way: it used to finish the
   * note here, and a hand reaching for a new line kept closing it.
   */
  onDone?: () => void;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<TrixEditorElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  /*
    What this editor last handed out. The value comes back down as a prop,
    and reloading the document on our own edit would move the caret to the
    end of it on every keystroke.
  */
  const lastEmitted = React.useRef<string | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);
  /** Pictures Basecamp has not answered for yet. A save waits on these. */
  const pending = React.useRef(0);
  /** This editor's own reader, to tell whose is in the shared slot. */
  const readerRef = React.useRef<(() => string) | null>(null);
  const onPendingRef = React.useRef(onPendingChange);
  onPendingRef.current = onPendingChange;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;
  const resolveRef = React.useRef(resolveImageSrc);
  resolveRef.current = resolveImageSrc;
  const uploadRef = React.useRef(uploadImage);
  uploadRef.current = uploadImage;

  const reactId = React.useId();
  const inputId = tameId(reactId, "input");
  const toolbarId = tameId(reactId, "toolbar");

  const [bubble, setBubble] = React.useState<{ top: number; left: number } | null>(
    null
  );
  /* The portal needs a document, so not until this is on a page. */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  /**
   * The picture being looked at, and every picture in this note beside it.
   *
   * Read off the document when the overlay opens rather than followed:
   * looking at a picture is a moment, and a note that changes underneath
   * one is not a thing that happens.
   */
  const [lightbox, setLightbox] = React.useState<{
    items: { src: string; name: string }[];
    index: number;
  } | null>(null);

  /*
    Held in a ref because the buttons that call it are built by hand, in
    the editor's own document, long after this render — see dressToolbars.
  */
  const openLightboxRef = React.useRef<((image: HTMLImageElement) => void) | null>(
    null
  );
  openLightboxRef.current = (image) => {
    const editor = editorRef.current;
    const all = editor
      ? [...editor.querySelectorAll<HTMLImageElement>("figure.attachment img")]
      : [image];
    const items = all.map((el) => ({
      src: el.src,
      name: readAttachmentFilename(el.closest("figure")),
    }));
    const index = Math.max(
      0,
      all.findIndex((el) => el === image)
    );
    setLightbox({ items: items.length ? items : [{ src: image.src, name: "" }], index });
  };

  /* Escape closes it; the arrows walk the note's pictures. Bound while it
     is open, so the keys mean nothing the rest of the time. */
  React.useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLightbox(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setLightbox((now) => {
        if (!now || now.items.length < 2) return now;
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = (now.index + step + now.items.length) % now.items.length;
        return { ...now, index: next };
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [lightbox]);

  React.useEffect(() => {
    /*
      Not before the toolbar is on the page.

      Trix looks its toolbar up by id the moment the editor is connected,
      and builds a dialog controller from what it finds. The bubble is
      rendered through a portal, which does not exist until this component
      has mounted once — so on the first pass Trix found nothing, and its
      own setup threw on a null element. A broken toolbar controller is
      also a broken editor: the file drop that should have uploaded a
      picture died there.

      Waiting for `mounted` puts the portal in the DOM first. Effects run
      after the commit, so by the time this one does, the toolbar is real.
    */
    if (!mounted) return;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    void loadTrix().then(() => {
      if (cancelled || !hostRef.current) return;
      // Built here rather than in JSX: a custom element needs no type
      // declaration this way, and the toolbar is in the DOM before the
      // editor looks for it — without which Trix makes one of its own.
      const el = document.createElement("trix-editor") as TrixEditorElement;
      el.setAttribute("input", inputId);
      el.setAttribute("toolbar", toolbarId);
      if (placeholder) el.setAttribute("placeholder", placeholder);
      el.classList.add("trix-notes-content");
      hostRef.current.appendChild(el);
      editorRef.current = el;

      /*
        Caught on the way down, and taken off the event entirely.

        Trix binds Enter with modifiers to breaks of its own, on the element
        and on the document both. A handler that runs after either of them
        is a handler that runs after the break is in the note — so this one
        listens in the capture phase, where it comes first, and stops the
        event there rather than only asking it not to act.
      */
      el.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
          if (event.shiftKey || event.altKey) return;
          // Mid-word in an input method: Enter is choosing a candidate.
          if (event.isComposing) return;
          const done = onDoneRef.current;
          if (!done) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          done();
        },
        true
      );

      el.addEventListener("trix-initialize", () => {
        const initial = basecampToTrix(value, resolveRef.current);
        el.editor?.loadHTML(initial);
        lastEmitted.current = trixToBasecamp(el.value);
        if (autoFocus) {
          el.focus();
          /*
            Trix puts the caret at the start of the document on focus, so a
            note that already has words took the next ones in front of them.
            A document always ends with a newline, so the last place a caret
            can stand is one before the end.
          */
          const text = el.editor?.getDocument?.().toString() ?? "";
          const end = Math.max(0, text.length - 1);
          el.editor?.setSelectedRange([end, end]);
        }
      });

      const emitNow = () => {
        const html = trixToBasecamp(el.value);
        lastEmitted.current = html;
        onChangeRef.current(html);
      };
      el.addEventListener("trix-change", emitNow);
      const readCurrent = () => trixToBasecamp(el.value);
      if (readCurrentRef) {
        readCurrentRef.current = readCurrent;
      }
      readerRef.current = readCurrent;

      /*
        Pictures only, and only on a list Basecamp knows.

        Anything else has nowhere to live: a note on an unlinked list is not
        pushed anywhere, so an upload would have no home, and a file that is
        not an image is not something the note can draw.
      */
      el.addEventListener("trix-file-accept", (event) => {
        const file = (event as CustomEvent<{ file?: File }> & { file?: File })
          .file;
        if (!uploadRef.current || !file || !file.type.startsWith("image/")) {
          event.preventDefault();
        }
      });

      el.addEventListener("trix-attachment-add", (event) => {
        const attachment = (event as unknown as { attachment: TrixAttachment })
          .attachment;
        // No file means it came from somewhere else in the document — a
        // picture moved, or one already uploaded. Nothing to send.
        if (!attachment?.file) return;
        pending.current += 1;
        onPendingRef.current?.(pending.current);
        void sendAttachment(attachment, uploadRef.current, emitNow).finally(
          () => {
            pending.current = Math.max(0, pending.current - 1);
            onPendingRef.current?.(pending.current);
          }
        );
      });

      el.addEventListener("keydown", (event) => {
        if (event.key !== " " || !el.editor) return;
        if (applyHeadingShortcut(el.editor)) event.preventDefault();
      });

      /*
        Command+C on a chosen picture puts the picture on the clipboard.

        Left alone, the copy is a piece of HTML with an `<img>` whose
        address only this app can open — the planner's own proxy, or the
        desktop app's scheme. Another program pastes nothing. So the pixels
        go on the clipboard as a PNG, which every program reads, and which
        pastes back into a note as a new picture.
      */
      el.addEventListener(
        "copy",
        (event) => {
          const image = readChosenImage(el);
          if (!image || !copyImageToClipboard(image)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true
      );

      el.addEventListener("trix-selection-change", () => {
        positionBubble(el, hostRef.current, toolbarRef.current, setBubble);
      });
      el.addEventListener("blur", () => setBubble(null));

      /* Fixed to the window, so it does not travel with the words on its
         own. Scrolling the note, or the board under it, moves them. */
      const follow = () =>
        positionBubble(el, hostRef.current, toolbarRef.current, setBubble);
      el.addEventListener("scroll", follow);
      window.addEventListener("scroll", follow, true);
      window.addEventListener("resize", follow);

      /*
        Full screen and download, beside the bin Trix gives us.

        Trix builds the attachment toolbar itself and puts one button in
        it, so these are added to the group after the fact. It rebuilds
        that toolbar whenever the picture is chosen again, which is why
        this watches rather than running once — and why it checks before
        it adds, so a rebuild does not leave two of each.
      */
      const dressToolbars = () => {
        el.querySelectorAll(".attachment__toolbar .trix-button-group").forEach(
          (group) => {
            if (group.querySelector("[data-dh-image-action]")) return;
            const figure = group.closest("figure");
            const image = figure?.querySelector("img");
            if (!image) return;
            group.prepend(
              imageActionButton("fullscreen", "View full size", () => {
                openLightboxRef.current?.(image);
              }),
              imageActionButton("download", "Download", () => {
                const link = document.createElement("a");
                link.href = image.src;
                link.download = readAttachmentFilename(figure) || "image";
                document.body.appendChild(link);
                link.click();
                link.remove();
              })
            );
          }
        );
      };
      const toolbarWatch = new MutationObserver(dressToolbars);
      toolbarWatch.observe(el, { childList: true, subtree: true });
      dressToolbars();

      cleanupRef.current = () => {
        el.removeEventListener("scroll", follow);
        window.removeEventListener("scroll", follow, true);
        window.removeEventListener("resize", follow);
        toolbarWatch.disconnect();
      };
    });

    return () => {
      cancelled = true;
      /* Only if it is still ours. Two editors can share the slot — the
         small note and the full-window one — and the one going away must
         not wipe out the reader the other just registered. */
      if (readCurrentRef && readCurrentRef.current === readerRef.current) {
        readCurrentRef.current = null;
      }
      cleanupRef.current?.();
      cleanupRef.current = null;
      editorRef.current?.remove();
      editorRef.current = null;
    };
    // Built once, as soon as the toolbar exists. The value is followed by
    // the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /** A value that changed somewhere else — a sync, or another window. */
  React.useEffect(() => {
    const el = editorRef.current;
    if (!el?.editor) return;
    if (value === lastEmitted.current) return;
    el.editor.loadHTML(basecampToTrix(value, resolveRef.current));
    lastEmitted.current = value;
  }, [value]);

  /*
    The bubble lives on the body, not in the card.

    `position: fixed` is only fixed to the window while no ancestor is
    transformed — and a task card is, on hover, which is exactly when
    somebody is selecting words in it. The card became the containing block
    and the bubble went somewhere off the screen entirely. A card that
    hides its overflow would clip it too.

    Out here it answers to the window, as intended. Trix finds it by id,
    which does not care where in the document it sits.
  */
  /*
    The bubble lives on the body, not in the card.

    `position: fixed` is only fixed to the window while no ancestor is
    transformed — and a task card is, on hover, which is exactly when
    somebody is selecting words in it. The card became the containing block
    and the bubble went off the screen. A card that hides its overflow
    would clip it too.

    Out here it answers to the window. Trix finds it by id, which does not
    care where in the document it sits.

    Trix drives it once found: each button's command and its active state
    are its work, and ours is only where the thing sits. It shows over the
    selection, so nobody has to think about formatting until they have
    chosen something to format.
  */
  const bubbleUi = (
      <div
        ref={toolbarRef}
        id={toolbarId}
        className="trix-notes-bubble"
        data-shown={bubble ? "true" : undefined}
        style={bubble ? { top: bubble.top, left: bubble.left } : undefined}
      >
        <div data-trix-button-group="text-tools">
          {/*
            `data-trix-key` is how Trix binds a shortcut: the default
            toolbar carries these, and building our own without them is
            what took Cmd+B and Cmd+I away.
          */}
          <button type="button" data-trix-attribute="bold" data-trix-key="b" title="Bold (⌘B)" aria-label="Bold">{ICONS.bold}</button>
          <button type="button" data-trix-attribute="italic" data-trix-key="i" title="Italic (⌘I)" aria-label="Italic">{ICONS.italic}</button>
          <button type="button" data-trix-attribute="underline" data-trix-key="u" title="Underline (⌘U)" aria-label="Underline">{ICONS.underline}</button>
          {/* Trix binds no key for this one, and neither does Basecamp's
              editor. ⌘⇧X is what Docs, Slack, GitHub and Linear use, so it
              is the one most people already have in their fingers. Written
              the way Trix writes its own modifiers — see `shift+z` for
              redo in its default toolbar. */}
          <button type="button" data-trix-attribute="strike" data-trix-key="shift+x" title="Strikethrough (⌘⇧X)" aria-label="Strikethrough">{ICONS.strike}</button>
          <button type="button" data-trix-attribute="heading1" title="Heading" aria-label="Heading">{ICONS.heading}</button>
          <button type="button" data-trix-attribute="quote" title="Quote" aria-label="Quote">{ICONS.quote}</button>
          <button type="button" data-trix-attribute="bullet" title="Bulleted list" aria-label="Bulleted list">{ICONS.bullet}</button>
          <button type="button" data-trix-attribute="number" title="Numbered list" aria-label="Numbered list">{ICONS.number}</button>
          <button
            type="button"
            data-trix-attribute="href"
            data-trix-action="link"
            data-trix-key="k"
            title="Link (⌘K)"
            aria-label="Link"
          >
            {ICONS.link}
          </button>
        </div>
        {/* Trix's own link dialog. Without this markup the link button has
            nowhere to ask for an address. */}
        <div data-trix-dialogs>
          <div data-trix-dialog="href" data-trix-dialog-attribute="href">
            <div data-trix-dialog__link-fields>
              <input type="url" name="href" placeholder="https://" data-trix-input required />
              <div data-trix-button-group>
                <input type="button" data-trix-method="setAttribute" value="Link" />
                <input type="button" data-trix-method="removeAttribute" value="Unlink" />
              </div>
            </div>
          </div>
        </div>
    </div>
  );

  /*
    A picture on its own, over everything.

    On the body rather than in the note: the card it came from is narrow,
    scrolls, and hides its overflow, and a picture worth opening is worth
    more room than that. The backdrop closes it, and so does Escape; the
    arrows are only drawn when the note holds more than one picture.
  */
  const step = (by: number) =>
    setLightbox((now) =>
      now
        ? { ...now, index: (now.index + by + now.items.length) % now.items.length }
        : now
    );
  const shown = lightbox ? lightbox.items[lightbox.index] : null;
  const lightboxUi = lightbox && shown ? (
    <div
      className="trix-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={shown.name || "Picture"}
      onClick={() => setLightbox(null)}
    >
      <button
        type="button"
        className="trix-lightbox-close"
        title="Close (Esc)"
        aria-label="Close"
        onClick={() => setLightbox(null)}
      >
        {ICONS.lightboxClose}
      </button>

      {lightbox.items.length > 1 ? (
        <button
          type="button"
          className="trix-lightbox-step trix-lightbox-step--back"
          title="Previous (←)"
          aria-label="Previous picture"
          onClick={(event) => {
            event.stopPropagation();
            step(-1);
          }}
        >
          {ICONS.lightboxBack}
        </button>
      ) : null}

      {/* The picture keeps the click: the backdrop closes, and pressing the
          thing you came to look at should not. */}
      <figure
        className="trix-lightbox-frame"
        onClick={(event) => event.stopPropagation()}
      >
        <img src={shown.src} alt={shown.name || ""} draggable={false} />
        <figcaption>
          {shown.name ? <span>{shown.name}</span> : null}
          {lightbox.items.length > 1 ? (
            <span className="trix-lightbox-count">
              {lightbox.index + 1} / {lightbox.items.length}
            </span>
          ) : null}
        </figcaption>
      </figure>

      {lightbox.items.length > 1 ? (
        <button
          type="button"
          className="trix-lightbox-step trix-lightbox-step--on"
          title="Next (→)"
          aria-label="Next picture"
          onClick={(event) => {
            event.stopPropagation();
            step(1);
          }}
        >
          {ICONS.lightboxOn}
        </button>
      ) : null}
    </div>
  ) : null;

  /*
    The bubble and the lightbox are portaled to the page body, outside the
    shell that carries the board's theme variables — so on a page where
    nothing else defines them, the bubble drew with no background. They go
    inside a box that wears the shell's class and theme, and no layout of
    its own (see .todo-portal-root), the way the assign menu travels.
  */
  const [portalTheme, setPortalTheme] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const shell = hostRef.current?.closest<HTMLElement>(".todo-shell");
    if (!shell) return;
    const read = () => setPortalTheme(shell.getAttribute("data-theme") ?? undefined);
    read();
    const watch = new MutationObserver(read);
    watch.observe(shell, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, [mounted]);
  const portalUi = (
    <div className="todo-shell todo-portal-root" data-theme={portalTheme}>
      {bubbleUi}
      {lightboxUi}
    </div>
  );

  return (
    <div ref={hostRef} className={className} style={{ position: "relative" }}>
      {mounted ? createPortal(portalUi, document.body) : null}
      <input id={inputId} type="hidden" />
    </div>
  );
}

/**
 * Put the bubble over what is selected.
 *
 * Nothing selected means nothing to format, so it goes away. Everything
 * here is in window coordinates: the bubble sits on the body, so that is
 * what it answers to. The editor's own box is read only to keep the bubble
 * within the note and to decide which side of the words it goes.
 */
const BUBBLE_GAP = 6;
const BUBBLE_EDGE = 8;

/** The icons the two added buttons are drawn with, at 24×24. */
const IMAGE_ACTION_ICONS: Record<string, string> = {
  fullscreen:
    "<path d='M15 3h6v6'/><path d='M9 21H3v-6'/><path d='M21 3l-7 7'/><path d='M3 21l7-7'/>",
  download: "<path d='M12 3v12'/><path d='M7 12l5 5 5-5'/><path d='M5 21h14'/>",
};

/**
 * A button for the toolbar over a picture, in Trix's own group.
 *
 * Built by hand rather than in React: it lives inside the editor's
 * document, which React does not own and must not try to.
 */
function imageActionButton(
  kind: keyof typeof IMAGE_ACTION_ICONS & string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  /*
    Not one of Trix's own buttons.

    Wearing `trix-button` brought a rule with it — every button in a group
    but the first gets a grey `border-left` — so a pale line appeared to
    the left of the download button, nothing like the divider before the
    bin. These are dressed here, not by Trix, so they take only our class.
  */
  button.className = "dh-image-action";
  button.dataset.dhImageAction = kind;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">${IMAGE_ACTION_ICONS[kind]}</svg>`;
  // The editor takes a click on itself as a place to put the caret, and
  // the toolbar sits over the picture: without this, pressing a button
  // moved the selection and Trix rebuilt the toolbar under the pointer.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * The picture that is chosen, if a picture is all that is chosen.
 *
 * Trix marks the attachment it is editing as mutable. A caption in the
 * middle of being typed is a text box with a selection of its own, and a
 * copy there is a copy of words.
 */
function readChosenImage(el: TrixEditorElement): HTMLImageElement | null {
  if (document.activeElement instanceof HTMLTextAreaElement) return null;
  const range = el.editor?.getSelectedRange?.();
  if (!range || range[1] - range[0] !== 1) return null;
  return el.querySelector<HTMLImageElement>(
    "figure.attachment[data-trix-mutable] img"
  );
}

/**
 * The picture, as a PNG, on the system clipboard. False when this browser
 * cannot do it, so the caller leaves the ordinary copy alone.
 *
 * The write starts inside the key press and the pixels arrive later: WebKit
 * refuses a clipboard write that starts after an `await`, and takes a
 * promise for the content in its place.
 */
function copyImageToClipboard(image: HTMLImageElement): boolean {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  const png = imageToPng(image);
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": png })])
    .catch((error) => console.warn("[todo] copy image failed", error));
  return true;
}

async function imageToPng(image: HTMLImageElement): Promise<Blob> {
  /*
    From the bytes when they can be fetched: a bitmap made from a blob never
    taints the canvas. The desktop app's scheme may refuse a fetch, and then
    the element on the page is drawn as it is.
  */
  let source: CanvasImageSource = image;
  try {
    const blob = await (await fetch(image.src)).blob();
    if (blob.type === "image/png") return blob;
    source = await createImageBitmap(blob);
  } catch {
    source = image;
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("no PNG"))),
      "image/png"
    );
  });
}

/** The name Basecamp gave the file, for the download to save it under. */
function readAttachmentFilename(figure: Element | null): string {
  if (!figure) return "";
  const raw = figure.getAttribute("data-trix-attachment");
  if (!raw) return "";
  try {
    const data = JSON.parse(raw) as { filename?: string };
    return data.filename ?? "";
  } catch {
    return "";
  }
}

function positionBubble(
  el: TrixEditorElement,
  host: HTMLDivElement | null,
  toolbar: HTMLDivElement | null,
  set: (next: { top: number; left: number } | null) => void
) {
  const selection = window.getSelection();
  if (!host || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    set(null);
    return;
  }
  const range = selection.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) {
    set(null);
    return;
  }
  /*
    A chosen picture is not a piece of text.

    Clicking one selects the whole attachment, and bold, italic and the
    rest have nothing to act on — so the bubble offered a row of buttons
    for a thing they cannot change. Worse, the rectangle a selection like
    that reports is not the picture's, so the bubble was drawn nowhere
    near it: at the far edge of the window, over another column.
  */
  if (range.cloneContents().querySelector("figure.attachment")) {
    set(null);
    return;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    set(null);
    return;
  }

  /*
    Measured against the window, and placed against the window.

    This used to be positioned inside the editor's own box, which meant two
    problems at once: the arithmetic had to agree with whatever the nearest
    positioned ancestor turned out to be, and a card that clips its
    overflow clipped the bubble with it. A selection at the foot of a note
    put the bubble under the card's edge, out of reach.

    A rectangle from the selection is already in window coordinates, so
    `position: fixed` needs no translation and nothing can crop it.
  */
  const box = el.getBoundingClientRect();
  const width = toolbar?.offsetWidth ?? 0;
  const height = toolbar?.offsetHeight ?? 0;

  /* Below the words, unless the note ends before there is room — then
     above them, which is where the space is. */
  const roomBelow = Math.min(box.bottom, window.innerHeight) - rect.bottom;
  const above = roomBelow < height + BUBBLE_GAP;
  const top = above
    ? rect.top - height - BUBBLE_GAP
    : rect.bottom + BUBBLE_GAP;

  /* Centred on the selection, then slid back inside the note — a card is
     narrow and a selection is usually near one of its edges. */
  const centred = rect.left + rect.width / 2 - width / 2;
  const leftLimit = Math.max(BUBBLE_EDGE, box.left);
  const rightLimit = Math.min(window.innerWidth - BUBBLE_EDGE, box.right) - width;
  const left = Math.max(
    BUBBLE_EDGE,
    Math.min(centred, Math.max(leftLimit, rightLimit))
  );

  set({ top: Math.max(BUBBLE_EDGE, top), left });
}
