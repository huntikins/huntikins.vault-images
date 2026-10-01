# huntikins.vault-images

Public listing photos for the huntikins.vault inventory, served over HTTPS so eBay can fetch them.

## What may live here

This repository is **public**. Git history is permanent and may be cached or forked, so it holds only:

- photos
- the scripts and workflows that process them
- this README
- `index.json`, a lookup keyed by item id and view

**Never** put prices, costs, notes, card values, order numbers, slot or binder info, or anything else from the private vault in this repo, in a filename, in a PR title or in a commit message.

## Uploading photos for a listing group

Photos arrive as a pull request, so a whole group goes up in one go. A workflow strips hidden location data, names and files the photos, adds them to the index, comments the public URLs, and merges the PR.

### From the phone (no renaming)

1. In Safari, open this repo (if the Upload option is missing, choose "Request Desktop Website") and go into the **`intake`** folder.
2. **Add file, Upload files**, and choose every photo for the group from the camera roll, as they are (`IMG_6513.JPG`, ...).
3. Under "Commit changes" choose **Create a new branch for this commit and start a pull request**, then **Propose changes**.
4. On the pull request form, the description is pre-filled with a template. Replace the example lines with one line per item, then **Create pull request**:

   ````
   ```
   INV-0010: IMG_6513 IMG_6514
   INV-0011: IMG_6515 IMG_6516 IMG_6517
   ```
   ````

   The first photo is `front`, the second `back`, and the rest are `detail-1`, `detail-2`, and so on. To choose views yourself: `INV-0010 front=IMG_6513 back=IMG_6514 corner-tl=IMG_6520`. Use the photo name without the extension; case does not matter.
5. Wait about a minute. A comment appears with a table of the public URLs and the PR merges itself. If something is wrong, the comment lists every problem and nothing is published. Fix the files or edit the description and it re-runs.

Everything is checked together: a file in `intake/` that is neither listed nor named correctly, a listed name with no file, a duplicate view, or an item with no `front` fails the whole upload.

### Alternative: rename first

Name each photo `INV-NNNN-<view>.jpg` (for example `INV-0001-front.jpg`) before uploading, using the Files app (long-press, Rename). Files named this way need no lines in the description, and the two styles can be mixed in one upload. A file listed in the description uses the description, not its filename.

The GitHub mobile app cannot upload from the camera roll; use the website.

### Naming rules (renamed files)

- `INV-` plus 4 or more digits, a dash, the view, and the extension: `INV-0001-front.jpg`. Case does not matter.
- Extensions: `.jpg`, `.jpeg`, `.png`. Anything else, including HEIC, is rejected, because it cannot be checked for hidden location data. Set the iPhone camera to "Most Compatible", or convert to JPEG first.
- Every item needs a `front`. Views, in listing order (`front` becomes the gallery image):

  | Order | View |
  |---|---|
  | 1 | `front` |
  | 2 | `back` |
  | 3-6 | `corner-tl` `corner-tr` `corner-bl` `corner-br` |
  | 7-10 | `edge-top` `edge-bottom` `edge-left` `edge-right` |
  | 11 | `surface` |
  | 12-14 | `slab-front` `slab-back` `label` |
  | 15+ | `detail-1` ... `detail-99` |

  Other view names are still published, ordered last.
- Subfolders inside `intake/` are fine (`intake/may-batch/INV-0001-front.jpg`).
- One photo per item and view per upload. Uploading a view that already exists **replaces** it: the old file is deleted from the current tree (git history keeps it) and the new one gets a new URL.

## URLs

```
https://huntikins.github.io/huntikins.vault-images/images/<INV>/<view>-<hash8>.jpg
```

`hash8` is the first 8 hex characters of the sha256 of the published file (after metadata removal). It is derivable from the file, and a replaced photo gets a new URL, so eBay and CDN caches never serve a stale image. Raw form, usable even if Pages is off:

```
https://raw.githubusercontent.com/huntikins/huntikins.vault-images/main/images/<INV>/<view>-<hash8>.jpg
```

`index.json` maps every item to its views, in listing order, and contains nothing else:

```json
{ "INV-0001": { "front": "images/INV-0001/front-1a2b3c4d.jpg", "back": "images/INV-0001/back-5e6f7a8b.jpg" } }
```

## Scripts

Dependency-free Node 22 ESM.

| Script | Purpose |
|---|---|
| `scripts/ingest-intake.mjs` | Publish everything in `intake/`; all-or-nothing, idempotent |
| `scripts/scrub-image-metadata.mjs` | Strip (or `--check`) EXIF/GPS, XMP, IPTC, comments from JPEG and PNG |
| `scripts/validate-image-names.mjs` | Check `images/` naming and that each hash matches its file |
| `scripts/build-image-site.mjs` | Regenerate `index.json`, `index.html`, `sitemap.xml` |

Run `npm test` for the unit tests.

## Workflows

- `intake.yml` runs on pull requests from `huntikins` touching `intake/**`, from a branch in this repo (never a fork). It refuses PRs that change anything besides `intake/` and generated image files.
- `scrub-check.yml` is a backstop on every push to `main` and every PR: unit tests, metadata check, naming and hash check, stale-index check.

Actions are pinned to full commit SHAs.
