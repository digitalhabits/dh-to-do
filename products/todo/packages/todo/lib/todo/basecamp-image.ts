/**
 * Where a picture in a note is read from.
 *
 * Basecamp's own addresses answer to a Basecamp web session and not to an
 * API token, so the planner proxies the blob through a route that holds the
 * token. The standalone app has no such route and says so by declining,
 * which leaves the picture unloaded rather than pointing it at a server
 * that will refuse it.
 *
 * A picture in the app's own store (see media-store.ts) is read from the
 * planner's media route, or from the desktop app's own scheme. It comes
 * before the sgid route and after the blob: once a pull has brought
 * Basecamp's address the proxy serves the same bytes, and until then the
 * local copy is the only one there is.
 *
 * Its own module because more than the To-Do board shows a note now: the
 * morning review opens a task's note beside its title, and a picture there
 * has to come from the same place.
 */
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import type { ImageSrcResolver } from "@/lib/todo/basecamp-richtext";
import { tauriMediaSrc } from "@/lib/todo/tauri-media";

/** Where a picture in the app's own store is read from, for this app. */
export function noteMediaSrc(mediaId: string): string {
  return isStandaloneTodo()
    ? tauriMediaSrc(mediaId)
    : `/api/media/${encodeURIComponent(mediaId)}`;
}

export const resolveBasecampImage: ImageSrcResolver = ({
  blobId,
  sgid,
  mediaId,
}) => {
  const standalone = isStandaloneTodo();
  if (blobId && !standalone) {
    return `/api/todo/basecamp-image/${encodeURIComponent(blobId)}`;
  }
  if (mediaId) return noteMediaSrc(mediaId);
  if (standalone) return null;
  if (sgid) {
    return `/api/todo/basecamp-image/sgid?id=${encodeURIComponent(sgid)}`;
  }
  return null;
};
