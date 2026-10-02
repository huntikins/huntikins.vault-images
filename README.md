# huntikins.vault-images

Public listing photos for the huntikins.vault inventory, served over HTTPS so eBay can fetch them.

## What may live here

This repository is **public**. Git history is permanent and may be cached or forked, so it holds only:

- photos
- the scripts and workflows that process them
- this README
- `index.json`, a lookup keyed by item id and view

**Never** put prices, costs, notes, card values, order numbers, slot or binder info, or anything else from the private vault in this repo, in a filename, in a PR title or in a commit message.

## How photos get here

**Never upload photos to this repository.** It is public, and a camera photo carries hidden location data. Anything pushed here, even to a pull request branch that is closed and deleted a minute later, stays public through GitHub's pull request refs and the commit SHA.

This repository exists only so eBay can fetch listing photos. eBay copies each picture URL into its own image host when a listing is created or revised, so this repo just has to serve the photos long enough for that, and for the vault's `index.json` lookup.

Photos are uploaded to the **private** `huntikins.vault` repository instead:

1. In Safari, open `huntikins/huntikins.vault` (choose "Request Desktop Website" if the Upload option is missing) and go into **`photo-intake`**.
2. **Add file, Upload files**, choose every photo for the group from the camera roll as they are (`IMG_6513.JPG`, ...), choose **Create a new branch for this commit and start a pull request**, then **Propose changes**.
3. In the pull request description, add one line per item inside a code fence, then **Create pull request**:

   ````
   ```
   INV-0010: IMG_6513 IMG_6514
   INV-0011: IMG_6515 IMG_6516 IMG_6517
   ```
   ````

   The first photo is `front`, the second `back`, the rest `detail-1`, `detail-2`, ... To choose views: `INV-0010 front=IMG_6513 back=IMG_6514 corner-tl=IMG_6520`. Files already named `INV-NNNN-<view>.jpg` need no line.

The vault's workflow checks the mapping, re-encodes every photo from its pixels (longest side 1600px, which drops every byte of the original container), strictly scrubs and re-checks the result, and pushes **only the clean files** here as `images/<INV>/<view>-<hash8>.jpg`, with a regenerated `index.json`. It then removes the raw photos from the private pull request, comments the public URLs, and merges it. If anything is wrong it comments the problems and publishes nothing. The vault's `docs/image-standards.md` has the details.

A pull request here that adds photos or touches `intake/` is refused by `intake.yml`: it comments and fails, and never processes or merges anything.

### Naming rules

- Views, in listing order (`front` becomes the gallery image, and every item needs one):

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
- Only JPEG and PNG are accepted. HEIC is rejected, because it cannot be checked for hidden location data; set the iPhone camera to "Most Compatible".
- Uploading a view that already exists **replaces** it: the old file leaves the current tree (git history keeps it) and the new one gets a new URL.

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

Dependency-free Node 22 ESM. `scripts/` is the single source of truth for the image library; `huntikins.vault` vendors an exact copy (`vendor/vault-images/scripts/`) and its intake workflow refuses to publish if that copy differs from this repo's `main`.

| Script | Purpose |
|---|---|
| `scripts/lib/ingest.mjs` | Publish an intake folder into `images/`; all-or-nothing, idempotent. Called by the vault's private intake |
| `scripts/scrub-image-metadata.mjs` | Strip (or `--check`) EXIF/GPS, XMP, IPTC, MPF, comments from JPEG and PNG. Fails closed: anything not cleanly parsed is rejected, never passed through |
| `scripts/validate-image-names.mjs` | Check `images/` naming and that each hash matches its file |
| `scripts/build-image-site.mjs` | Regenerate `index.json`, `index.html`, `sitemap.xml` |

Run `npm test` for the unit tests.

## Workflows

- `intake.yml` refuses every pull request that adds photos or touches `intake/`: it comments a pointer to the private flow and fails. It never checks out, processes or merges anything.
- `scrub-check.yml` is the backstop on every push to `main` (including the vault's deploy-key pushes), every PR, and nightly: unit tests, strict metadata check, naming and hash check, stale-index check.

Actions are pinned to full commit SHAs.
