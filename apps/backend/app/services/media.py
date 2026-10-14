"""The one place that knows how an uploaded file is STORED and how it is ADDRESSED.

Two questions, answered here so that a door never answers either on its own.

HOW A FILE IS STORED. The bytes land in `media_objects` (0013), one row per upload, validated
against a raster-only whitelist and a 5 MiB cap that the migration also carries as CHECKs - these
are the copies that answer with a sentence instead of a 23514. SVG is deliberately absent: it is a
document format that can carry script, and these bytes are served back to a browser.

AND A SECOND COPY LANDS IN A FOLDER ON THE HOST. Every upload is also written as an ordinary file
into one directory, `MEDIA_DIR`, which compose mounts in from outside the project - so the operator
can open it, copy it, back it up, or hand the whole lot to a CDN, and the repository stays clean.
`store_upload` does both and every door goes through it, which is what keeps it ONE folder rather
than one per feature.

THE ROW IS THE SOURCE OF TRUTH AND THE FILE IS THE COPY, and that asymmetry is deliberate. A row
whose file could not be written - no folder, read-only mount, full disk - keeps its bytes and stays
perfectly serveable, so a missing file costs a person nothing but a file. The other arrangement,
where the folder is load-bearing, means moving or losing it breaks the shop's photographs; that is
a much worse failure than a folder that quietly drifts out of step. `disk_name` is the record of what
was written, and NULL there means "no file", never "this row is broken".

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

import os

from sqlalchemy import text

IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")
IMAGE_MAX_BYTES = 5 * 1024 * 1024

# Where the copy on disk goes, inside the container. The compose file mounts a folder from the HOST
# here (`MEDIA_DIR` in .env decides which), which is the whole point: a person can open it, copy it,
# back it up, or hand the lot to a CDN, and the project tree stays untouched.
DEFAULT_MEDIA_DIR = "/media-files"


def media_dir() -> str:
    """The folder the copies live in, as the container sees it."""
    return (os.getenv("MEDIA_DIR") or DEFAULT_MEDIA_DIR).strip() or DEFAULT_MEDIA_DIR


def disk_name_for(public_id: str, filename: str | None) -> str:
    """The name a file is written under in that folder.

    PREFIXED WITH THE ROW'S OWN public_id, and the prefix is load-bearing rather than decoration: a
    folder is uploaded BEFORE any group has claimed any of it, so two photographs called
    `IMG_4471.jpg` are two rows with the same `filename` and nothing else to tell them apart. The
    first eight hex characters are enough to separate them while leaving the name a person can
    still read in Explorer.

    `safe_filename` has already taken the basename, so the result can contain no separator and
    cannot escape the folder - which matters here in a way it did not when this was only a label on
    a database column.
    """
    return f"{str(public_id)[:8]}-{safe_filename(filename)}"


def write_to_disk(disk_name: str, blob: bytes) -> bool:
    """Write one copy of the bytes into the media folder. Returns False if it could not.

    BEST EFFORT, AND THE UPLOAD IS NOT ALLOWED TO FAIL BECAUSE OF IT. The row in `media_objects` is
    what the shop serves from and what a customer's order is checked against; this folder is a
    convenience for the person running the shop. A missing folder, a read-only mount or a full disk
    must therefore cost nothing but the copy - refusing an upload because a browseable duplicate
    could not be written would be the tail wagging the dog.
    """
    try:
        target = media_dir()
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, disk_name), "wb") as fh:
            fh.write(blob)
        return True
    except OSError:
        return False


def remove_from_disk(disk_name: str | None) -> bool:
    """Delete one copy, for a row that is itself being deleted. Same best-effort rule."""
    if not disk_name:
        return False
    try:
        os.remove(os.path.join(media_dir(), disk_name))
        return True
    except OSError:
        return False


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
    row = (await db.execute(text("""
        INSERT INTO media_objects (filename, content_type, byte_size, bytes, uploaded_by)
        VALUES (:f, :c, :n, :b, :u)
        RETURNING id, public_id::text AS public_id, filename, content_type, byte_size, uploaded_at
    """), {"f": safe_filename(filename), "c": ctype, "n": len(blob), "b": blob,
           "u": uploaded_by})).mappings().one()

    # THE COPY ON DISK, written AFTER the insert so the name can be built from the row's own
    # public_id rather than from anything a caller supplied. `disk_name` records which name it got,
    # and stays NULL when the write failed - see `write_to_disk` for why that is a normal outcome
    # rather than an error. Written through here rather than by each door so that every upload in
    # the app lands in the one folder, which is the thing the folder is for.
    name = disk_name_for(row["public_id"], filename)
    wrote = write_to_disk(name, blob)
    if wrote:
        await db.execute(text("UPDATE media_objects SET disk_name = :d WHERE id = :i"),
                         {"d": name, "i": row["id"]})
    return {**dict(row), "disk_name": (name if wrote else None)}


async def read_for_upload(blob_source, *, max_bytes: int | None = None) -> bytes:
    """Read an UploadFile, capped, without holding an oversized body in memory first.

    One byte over the cap is read so that "too big" is answered by the size of the read rather than
    by trusting a Content-Length header the client controls.
    """
    return await blob_source.read((max_bytes or IMAGE_MAX_BYTES) + 1)


class MediaRefused(Exception):
    """A refusal with a reason a person can act on. The door turns it into its own status code."""
