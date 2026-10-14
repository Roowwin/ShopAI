"""The one place that knows how an uploaded file is STORED and how it is ADDRESSED.

Two questions, answered here so that a door never answers either on its own.

HOW A FILE IS STORED. The bytes land in `media_objects` (0013), one row per upload, validated
against a raster-only whitelist and a 5 MiB cap that the migration also carries as CHECKs - these
are the copies that answer with a sentence instead of a 23514. SVG is deliberately absent: it is a
document format that can carry script, and these bytes are served back to a browser.

HOW A FILE IS ADDRESSED, and why that now has a public answer. Until now every media row was
readable only through `/staff/.../raw`, behind the staff bearer token - which was fine while the
only consumer was the backoffice hub, and fatal for a product photograph, because the storefront
renders `products.image_url` in a plain `<img>` with no credential of any kind. So a file that is
meant for the shop floor is addressed by `public_address()`, which returns a path on the SHOP's own
origin. nginx serves it (`location /media/`, store vhost) and the CSP's `img-src 'self'` already
permits it, so nothing about the page or the policy has to change.

That path is deliberately relative and NOT an API URL: an absolute `https://api.<domain>/...` would
be a second origin and the CSP would refuse it, which is the kind of failure that shows up as a
broken tile on the shop floor rather than as an error anyone can read.

ADR 0001 puts media in MinIO/S3 and this module is where that lands when it does. `store_upload`
writes the row and `public_address` mints the address; a bucket-backed implementation replaces those
two bodies and no caller moves. It is NOT done now because the dev stack's object store is moto,
which is in-memory (ADR 0005), so every uploaded photograph would vanish on each `up.ps1` - a
storage backend that loses the operator's work on restart is worse than one that keeps it in the
database the rest of the business already lives in.
"""

from sqlalchemy import text

IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")
IMAGE_MAX_BYTES = 5 * 1024 * 1024


def safe_filename(raw: str | None) -> str:
    """The display name of an uploaded file: its basename, stripped of control characters.

    The name is never used as a path or a key - the bytes go in a row and are addressed by id - so
    this is about what a screen may RENDER and what a header may echo, not about traversal. A
    browser sends a path for some clients and a NUL is legal in no filename worth keeping.
    """
    name = (raw or "").replace("\\", "/").split("/")[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    return name[:120] or "image"


def public_address(public_id: str) -> str:
    """Where the SHOP fetches this file. See the module docstring for why it is a shop-relative path.

    Takes the `public_id`, never the row id: a sequential id would let anyone walk the whole media
    table by counting, and the id of a file is not a thing a page ever needs to know.
    """
    return "/media/" + str(public_id)


async def store_upload(db, *, filename: str | None, content_type: str | None, blob: bytes,
                       uploaded_by: int | None) -> dict:
    """Validate one uploaded file and write it to `media_objects`. Returns the new row.

    Raises `MediaRefused` (a sentence, not a status code) so the door can pick its own status - the
    staff hub answers 422/413, and a storefront-facing door would want the same words with whatever
    status its own contract uses. Does NOT commit: the row belongs to the caller's transaction, so a
    door that stores a file and then fails to attach it leaves neither behind.
    """
    # A multipart part may carry parameters ("image/jpeg; charset=..."); the type is the bare one.
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype not in IMAGE_TYPES:
        raise MediaRefused("only JPEG, PNG, WebP or GIF images can be attached")
    if not blob:
        raise MediaRefused("that file is empty")
    if len(blob) > IMAGE_MAX_BYTES:
        raise MediaRefused("images are capped at 5 MB")
    return (await db.execute(text("""
        INSERT INTO media_objects (filename, content_type, byte_size, bytes, uploaded_by)
        VALUES (:f, :c, :n, :b, :u)
        RETURNING id, public_id::text AS public_id, filename, content_type, byte_size, uploaded_at
    """), {"f": safe_filename(filename), "c": ctype, "n": len(blob), "b": blob,
           "u": uploaded_by})).mappings().one()


async def read_for_upload(blob_source, *, max_bytes: int | None = None) -> bytes:
    """Read an UploadFile, capped, without holding an oversized body in memory first.

    One byte over the cap is read so that "too big" is answered by the size of the read rather than
    by trusting a Content-Length header the client controls.
    """
    return await blob_source.read((max_bytes or IMAGE_MAX_BYTES) + 1)


class MediaRefused(Exception):
    """A refusal with a reason a person can act on. The door turns it into its own status code."""
