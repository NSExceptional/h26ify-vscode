/*
 * mp4.ts
 * media
 *
 * Created by Tanner Bennett on 2025-04-19
 * Copyright © 2025 Tanner Bennett. All rights reserved.
 */

import * as fs from 'fs';

type Atom = {
    size: number;
    type: string;
    offset: number;
};

type SeekOptions = {
    reset?: boolean;
    uptoOffset?: number;
};

export default class MP4 {
    
    static isHEVC(file: string): boolean {
        const reader = new MP4(file, false);
        const isHEVC = reader.isHEVC;
        reader.close();
        return isHEVC;
    }

    static getDuration(file: string): number | undefined {
        const reader = new MP4(file, false);
        const duration = reader.duration;
        reader.close();
        return duration;
    }
    
    constructor(private readonly file: string, enableLogging = false) {
        this.enableLogging = enableLogging;
        this.handle = fs.openSync(this.file, 'r');
        this.offset = 0;
    }

    private handle: number; // file descriptor
    private enableLogging = false;
    private offset: number = 0

    private reset(): void {
        this.offset = 0;
    }

    public close(): void {
        fs.closeSync(this.handle);
    }

    private readBytes(size: number): Uint8Array {
        const buffer = Buffer.alloc(size);
        const bytesRead = fs.readSync(this.handle, buffer, 0, size, this.offset);
        if (bytesRead === 0) {
            throw new Error('End of file reached');
        }
        this.offset += bytesRead;
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    }

    private seek(position: number): void {
        this.offset = position;
    }

    private readAtomHeader(): Atom {
        const offset = this.offset;
        const header = this.readBytes(8);
        const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0);
        const type = new TextDecoder().decode(header.subarray(4, 8));

        // Read the next 8 bytes for the extended size
        if (size == 1) {
            const extendedSize = this.readBytes(8);
            const extendedSizeValue = new DataView(extendedSize.buffer, extendedSize.byteOffset, extendedSize.byteLength).getBigUint64(0);
            if (extendedSizeValue > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new Error('Atom size exceeds maximum safe integer');
            }

            return { size: Number(extendedSizeValue), type, offset };
        }

        return { size, type, offset };
    }

    /**
     * Seeks up to the end of the specified atom header.
     *
     * If the atom has children or data, the reader will be positioned
     * at the start of the next child or data, so that you can immediately
     * read the next atom header or start reading the data.
     */
    public seekAtom(type: string, options?: SeekOptions): Atom | null {
        const { reset, uptoOffset } = options || {};
        if (reset) {
            this.reset();
        }

        const shouldLoop = (): boolean => {
            if (uptoOffset) {
                return this.offset < uptoOffset;
            }

            return true;
        };

        try {
            while (shouldLoop()) {
                const header = this.readAtomHeader();
                const { type: nextType } = header;
                if (nextType === type) {
                    return header;
                }

                this.seek(header.offset + header.size);
            }
        } catch {
            return null;
        }

        return null;
    }

    /** Traverse a branch of the atom tree. Assumes each atom immediately contains child atoms. */
    public traverseAtoms(branch: string[]): Atom | null {
        if (branch.length === 0) {
            return null;
        }
        if (branch.length === 1) {
            return this.seekAtom(branch[0]);
        }

        const first = branch.shift()!;
        let currentAtom = this.seekAtom(first);

        // Logging
        if (!currentAtom && this.enableLogging) {
            console.log(`mp4.ts: file ${this.file}:`)
            console.log(`Could not find first atom in branch:\n${[first, ...branch].join(' > ')}`);
            return null;
        }

        for (const type of branch) {
            // No need to check for null at any point here, it's fine
            // if we come across null right away and keep looping,
            // `seekAtomWithinAtom` will no-op each time in that case
            const childAtom = this.seekAtomWithinAtom(currentAtom, type);
            currentAtom = childAtom;

            // Logging
            if (!currentAtom && this.enableLogging) {
                console.log(`mp4.ts: file ${this.file}:`)
                console.log(`Could not find atom '${type}' in branch:\n${branch.join(' > ')}`);
                break;
            }
        }

        return currentAtom;
    }

    /** Scan all atoms at the current depth for the given type, up to the end of the parent atom */
    public seekAtomWithinAtom(parent: Atom | null, type: string): Atom | null {
        if (!parent) {
            return null;
        }

        const { size, offset } = parent;
        const endOffset = offset + size;

        return this.seekAtom(type, { uptoOffset: endOffset });
    }

    /** The codec tag is stored as an atom inside moov > trak > mdia > minf > stbl > stsd */
    private seekToCodecAtom(minEntries: number): Atom | null {
        this.reset();
        
        // It is usually in the first track...
        const stsd = this.traverseAtoms(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
        if (!stsd) {
            return null;
        }

        // Can't just put hvc1 at the end of the list above, because
        // stsd is the first and only atom in this list that doesn't
        // immediately contain other atoms, so we need to seek past
        // some metadata before we can read the next atom

        // Skip version/flags (4 bytes)
        this.seek(this.offset + 4);

        // Read the number of entries in the stsd atom
        const stsdHeader = this.readBytes(4);
        const numEntries = new DataView(stsdHeader.buffer, stsdHeader.byteOffset, stsdHeader.byteLength).getUint32(0);
        if (numEntries < minEntries) {
            return null;
        }

        return stsd;
    }

    /** Get the duration of the video in seconds from the mvhd atom */
    public get duration(): number | undefined {
        this.reset();
        
        // The mvhd (movie header) atom is inside the moov atom
        const mvhd = this.traverseAtoms(['moov', 'mvhd']);
        if (!mvhd) {
            return undefined;
        }
        
        // Skip to the timescale and duration fields
        // - First 4 bytes: version (1 byte) and flags (3 bytes)
        // - Next 8 bytes (version 1) or 4 bytes (version 0): creation time
        // - Next 8 bytes (version 1) or 4 bytes (version 0): modification time
        
        // Read version byte
        const versionBytes = this.readBytes(1);
        const version = versionBytes[0];
        
        // Skip flags
        this.seek(this.offset + 3);
        
        // Skip creation time and modification time
        const fieldSize = version === 1 ? 8 : 4;
        this.seek(this.offset + (fieldSize * 2));
        
        // Read timescale (4 bytes) - number of time units that pass per second
        const timescaleBytes = this.readBytes(4);
        const timescale = new DataView(timescaleBytes.buffer, timescaleBytes.byteOffset, timescaleBytes.byteLength).getUint32(0);
        
        // Read duration (4 or 8 bytes depending on version)
        let duration: number;
        if (version === 1) {
            const durationBytes = this.readBytes(8);
            const durationBigInt = new DataView(durationBytes.buffer, durationBytes.byteOffset, durationBytes.byteLength).getBigUint64(0);
            duration = Number(durationBigInt);
        } else {
            const durationBytes = this.readBytes(4);
            duration = new DataView(durationBytes.buffer, durationBytes.byteOffset, durationBytes.byteLength).getUint32(0);
        }
        
        // Calculate duration in seconds
        return duration / timescale;
    }
    
    /** How Apple platforms identify HEVC */
    public get hvc1(): boolean {
        const stsd = this.seekToCodecAtom(1);
        const hvc1 = this.seekAtomWithinAtom(stsd, 'hvc1');
        return !!hvc1;
    }

    /** How most other platforms identify HEVC */
    public get hev1(): boolean {
        const stsd = this.seekToCodecAtom(1);
        const mp4a = this.seekAtomWithinAtom(stsd, 'hev1');
        return !!mp4a;
    }
    
    public get isHEVC(): boolean {
        return this.hvc1 || this.hev1;
    }
}

// ...
// [moov] size=8+8089
//   ...
//   [trak] size=8+5105
//     ...
//     [mdia] size=8+4949
//       ...
//       [minf] size=8+4851
//         ...
//         [stbl] size=8+4787
//           [stsd] size=12+2606
//             entry_count = 1
//             [hvc1] size=8+2594  <-- The HEVC codec atom
//               ...
//           [stts] size=12+12
//           ...
//   [trak] size=8+2130
//     ...
//     [mdia] size=8+1994
//       [mdhd] size=12+20
//        ...
//       [minf] size=8+1896
//         ...
//         [stbl] size=8+1836
//           [stsd] size=12+114
//             entry_count = 1
//             [mp4a] size=8+102
//           ...
//   [trak] size=8+434
//     ...
