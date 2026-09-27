# Change Log

All notable changes to the "h26ify" extension are documented here.

## [2026.9.27]

### Added
- Trim preview: a playable video above the trim timeline.
  - Draggable playhead; click or drag the ruler or track to scrub. Dragging a trim handle shows that frame.
  - Play/pause, loop the selection, mute, and Set start / Set end at the playhead.
  - Keyboard: Space plays/pauses, I/O set start/end, ←/→ step a frame (Shift: 1s).
  - Trim times now show hundredths of a second.
  - Videos VS Code can't play directly (e.g. MKV) are previewed through a cached copy.

### Fixed
- Trim preview had no sound for AAC audio (most MP4/MOV files), which VS Code can't decode; it now previews a copy with MP3 audio.

## [2026.9.26]

### Added
- Browse workspace videos grouped into HEVC, Non-HEVC, and All Videos.
- Convert videos to HEVC (H.265), individually or in batch.
- Re-encode HEVC videos to reduce file size with a chosen CRF.
- Edit videos (single or batch): trim, crop, and resize.
  - Filmstrip trim control with start/end times.
  - Crop with live frame preview and four cross-resolution modes (Percentage, Absolute, Aspect Ratio, Insets), plus a per-clip thumbnail carousel and frame scrubber.
  - Resize by percentage or to 720p/1080p/4K presets, with aspect-ratio lock.
  - Save trim/crop/resize combinations as reusable presets.
- Reveal-in-Finder inline action and an Edit Selected Videos toolbar action.
