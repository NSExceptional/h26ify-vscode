# H26ify

Identify, convert, and edit videos right inside VS Code — HEVC (H.265) conversion plus trimming, cropping, and resizing.

![H26ify — the Videos view and the edit panel](https://raw.githubusercontent.com/NSExceptional/h26ify-vscode/master/images/screenshot.png)

## Features

### Browse & identify
- Automatically scans your workspace for video files
- Organizes videos into **HEVC**, **Non-HEVC**, and **All Videos** groups
- Shows codec, duration, and file size at a glance, with a reveal-in-Finder action per file

### Convert to HEVC
- One-click conversion of any video to HEVC (H.265)
- Batch-convert every non-HEVC video at once
- Re-encode existing HEVC videos to reduce file size (choose a CRF quality)

### Edit (single or batch)
- **Edit Selected Videos** from the view toolbar or the right-click menu
- **Trim** with a filmstrip scrubber and start/end times
- **Crop** with a live preview — and four modes for applying one crop across differently-sized clips: Percentage, Absolute, Aspect Ratio (with anchor), and Insets
- **Resize** by percentage or to common presets (720p/1080p/4K), with aspect-ratio lock
- Preview any frame while cropping, and pick which clip to visualize against when editing several at once
- Save your trim/crop/resize combinations as reusable **presets**

## Requirements

This extension shells out to external tools, which must be installed and available on your `PATH`:

- **ffmpeg** — converts and edits videos
- **ffprobe** — detects codecs and reads metadata

### Install ffmpeg

```bash
# macOS
brew install ffmpeg

# Windows (Chocolatey)
choco install ffmpeg

# Linux
sudo apt install ffmpeg   # Debian/Ubuntu
sudo dnf install ffmpeg   # Fedora
```

## Usage

1. Open the **Videos** view in the Explorer sidebar.
2. H26ify scans your workspace and sorts videos into HEVC / Non-HEVC groups.
3. Convert a single video with its inline button, or convert all non-HEVC videos from the group's toolbar.
4. To edit, select one or more videos and choose **Edit Selected Videos** (view toolbar or right-click), then enable Trim, Crop, and/or Resize and click **Apply**.
5. Click **Refresh** after adding new files.

## Notes

- Output videos are written alongside the originals using a configurable name pattern.
- Originals are never modified in place; the handling of the source file (keep, trash, or delete) is configurable in settings.
