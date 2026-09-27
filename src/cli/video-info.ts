/*
 * video-info.ts
 * H26ify
 * 
 * Created by Tanner Bennett on 2025-07-11
 * Copyright © 2025 Tanner Bennett.
 */

export default interface VideoInfo {
    codec: string;
    isHEVC: boolean;
    width?: number;
    height?: number;
    bitrate?: string;
    /** Seconds */
    duration?: number;
    /** Codec of the first audio stream (e.g. `aac`), if there is one */
    audioCodec?: string;
    filename: string;
}
