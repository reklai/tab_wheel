# TabWheel 4.0 store assets

The PNG files in this directory are production-sized product composites built from the same copy, layout, colors, and states as the V4 onboarding, popup, and options surfaces.

| File | Size | Store story |
| --- | ---: | --- |
| `01-switch-anywhere.png` | 1280 × 800 | First-run gesture demo |
| `02-one-natural-gesture.png` | 1280 × 800 | Three-button mouse-action onboarding |
| `03-popup-ready.png` | 1280 × 800 | Complete popup with V4 mouse-action defaults |
| `04-keep-your-place.png` | 1280 × 800 | Shared wheel-and-click settings |
| `05-protected-page-fallback.png` | 1280 × 800 | Protected-page fallback |
| `promo-440x280.png` | 440 × 280 | Chrome Web Store promo tile |

Editable SVG sources live in `store-assets/source/`. Raster files are generated with:

```bash
for source in store-assets/source/*.svg; do
  magick -background none "$source" "store-assets/$(basename "${source%.svg}").png"
done
```

Before uploading, compare each composite with the packaged extension at 100% browser zoom and update any copy that changed after release packaging.
