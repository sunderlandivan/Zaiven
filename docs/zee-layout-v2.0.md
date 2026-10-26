# Zee Layout Default (v2.0)

This file records the pinned dashboard arrangement requested by the user and set as the default baseline in `public/zee/styles.css`.

## Right rail
- `home-network`: column 9, rows 1-3
- `smart-home`: column 10, rows 1-3
- `time` (Chrono/Luna): columns 11-12, row 1
- `system`: columns 11-12, rows 2-3, with extra top margin to avoid overlap
- `audi`: columns 11-12, rows 4-6

## Center/lower layout
- `communications`: columns 4-7, rows 4-5 (below Gmail, right of Music), with extra top margin to clear Gmail.
- `music`: columns 1-3, rows 4-5
- `youtube`: columns 1-10, row 6

## Notes
- This layout is stamped in code with schema key:
  - `HUD_LAYOUT_SCHEMA_VALUE = "layout-v2.0-2026-05-07-stable-right-rail"`
- When this value changes in the future, saved panel geometry is reset so users return to the intended default grid.
