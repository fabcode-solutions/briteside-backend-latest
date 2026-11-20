import crypto from 'crypto';

/**
 * Stable id for a gallery photo (gallery items are plain URLs): the first 24
 * hex chars of its SHA-256. Same URL → same key, so likes and comments survive
 * reordering the gallery.
 */
export const galleryPostKey = url => crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 24);

export const GALLERY_KEY_RE = /^[0-9a-f]{24}$/;

/** The gallery photo with this key, or null (removed / never existed). */
export const findGalleryPost = (gallery, postKey) => {
  const url = (gallery ?? []).find(u => galleryPostKey(u) === postKey);
  return url ? { key: postKey, url } : null;
};

export const GALLERY_COMMENT_MAX = 1000;
/** Anti-spam: comments one person may leave on one business's photos per hour. */
export const GALLERY_COMMENTS_PER_HOUR = 30;
