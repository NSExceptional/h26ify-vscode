/*
 * ffprobe.ts
 * H26ify
 * 
 * Created by Tanner Bennett on 2025-07-11
 * Copyright © 2025 Tanner Bennett.
 */

import * as path from 'path';
import { EnvironmentCmd } from './environment-cmd';
import VideoInfo from './video-info';

class ffprobe extends EnvironmentCmd {
    protected commandName = 'ffprobe';
    protected expectedBinaryPath = { inPATH: 'ffprobe' };

    static shared = new ffprobe();
    
    private guardCanUseFFprobe(): void {
        if (this.isAvailable === false) {
            throw new Error('ffprobe is not available. Please install it and make sure it is in your PATH.');
        }
    }

    async getVideoInfo(filePath: string): Promise<VideoInfo | null> {
        this.guardCanUseFFprobe();
        
        try {
            // Use ffprobe to get video info in JSON format
            const jsonOutput = await this.runCommand(
                `-v quiet -print_format json -show_format -show_streams "${filePath}"`
            );
            const data = JSON.parse(jsonOutput);
            
            // Find video stream
            const videoStream = data.streams.find((stream: any) => stream.codec_type === 'video');
            if (!videoStream) {
                return null;
            }
            
            // Check if the codec is HEVC
            const isHEVC = videoStream.codec_name === 'hevc' || 
                          videoStream.codec_name === 'h265' || 
                          videoStream.codec_tag_string === 'hev1' || 
                          videoStream.codec_tag_string === 'hvc1';
            
            return {
                codec: videoStream.codec_name,
                isHEVC,
                width: videoStream.width,
                height: videoStream.height,
                bitrate: data.format.bit_rate ? `${Math.round(data.format.bit_rate / 1000)} kbps` : 'Unknown',
                duration: data.format.duration ? parseFloat(data.format.duration) : 0,
                filename: path.basename(filePath),
            };
        } catch (error) {
            throw new Error(`Error getting video info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

export default ffprobe.shared as ffprobe;
