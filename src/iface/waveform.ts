/*
 * Copyright (c) 2018-2025 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/*
 * This file is part of Ennuicastr.
 *
 * Interface for the waveform worker.
 */

// Width of the peak meter
export const peakWidth = 6;

export interface WaveformWorker {
    newWaveform(
        id: number,
        lbl: string,
        sampleRate: number,
        width: number,
        height: number,
        canvas: OffscreenCanvas,
        lblCanvas: OffscreenCanvas
    ): void;

    termWaveform(id: number): void;

    reverse(mp: MessagePort): void;

    push(id: number, val: number, vad: number): void;
    updateWaveRetroactive(id: number, vadExtension: number): void;
    updateWave(id: number, value: number, sentRecently: boolean): void;

    setCanvasSize(id: number, width: number, height: number): void;

    setWaveVADColors(to: string[]): void;
    setUIColors(to: Record<string, string>): void;
    setGood(to: boolean): void;
}

export interface WaveformWorkerRev {
    waveformStats(id: number, text: string): void;
}
