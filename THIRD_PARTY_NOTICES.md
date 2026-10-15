# FREEkMapper attribution

This integration adapts interaction/rendering patterns from [FREEkMapperV67](https://github.com/davygit67/FREEkMapperV67), commit `62ad34ad5c3b52c100a423dd3a28ff8a7485c669`. The upstream is Python/Tk/OpenGL; its selected behavior is adapted to the existing TypeScript/React/Electron renderer, without importing or executing the Python application.

- `renderers.py:draw_surface`, `redraw`, `GLFullscreenRenderer.draw`: 8-pixel corner markers, ordered alpha composition and shared preview/output semantics → `src/mapper-controls.css`, `src/shared/layers.ts`, `src/LayerArtwork.tsx`, `src/SpatialView.tsx`.
- `main.py:on_gl_click/on_gl_drag`, rotation and opacity controls → precise grab-offset corner manipulation in `src/SurfaceEditor.tsx`, media rotation/opacity controls.
- `video_source.py:VideoSource`, `main.py:video_reader_thread/get_surface_frame` → decoder/render separation, retaining the latest decoded frame, looping and paused-frame retention in `src/localMedia.ts` and `src/mediaPainter.ts`. Browser media decoding replaces OpenCV and avoids a Python runtime or per-frame JPEG conversion for imported files.
- `main.py:load_video_to_surface/load_image_to_surface`, quality/output controls and `toggle_blackout` → local persisted file import, render-quality settings and output blackout in the existing studio.

The published commit renders in array order but does not expose a general layer-reorder UI. The integrated layer stack makes that ordering explicit across uploaded media, YouTube, notes, recipes, games and timers. Living art retains this project's pinned-background convention.

## Upstream license

MIT License

Copyright (c) 2026 Vishal Rajendra Kumar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
