# H26ify: A VS Code Extension

Identify and convert videos from other formats to HEVC.

## Features

- Automatically scans your workspace for video files
- Organizes videos into two views: HEVC videos and other videos
- Provides one-click conversion of videos to HEVC format
- Batch convert all non-HEVC videos with a single click
- Visual indicators for video codec and conversion status

## Requirements

This extension requires external tools to function properly:

- **ffprobe**: Used to detect video codecs and metadata
- **ffmpeg**: Used to convert videos to HEVC format

Both tools must be installed and available in your system PATH.

### Installation on macOS

```bash
brew install ffmpeg
```

### Installation on Windows

Download from [FFmpeg's official website](https://ffmpeg.org/download.html) or install using package managers like Chocolatey:

```bash
choco install ffmpeg
```

### Installation on Linux

```bash
sudo apt install ffmpeg  # Debian/Ubuntu
sudo dnf install ffmpeg  # Fedora
```

## Usage

1. Open the H26ify panel from the activity bar
2. The extension will automatically scan your workspace for video files
3. Videos are sorted into "HEVC Videos" and "Other Videos" views
4. To convert a single video to HEVC, click the convert button next to it
5. To convert all videos at once, click the convert all button at the top of the Other Videos view
6. Refresh the views after adding new videos by clicking the refresh button

## Notes

- Converted videos are saved with a ".hevc" suffix in the same directory as the original
- The original videos are not modified or deleted
