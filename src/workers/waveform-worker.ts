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
 * The “waveform” display in a dedicated worker, writing to an OffscreenCanvas.
 */

import * as ifWaveform from "../iface/waveform";
import * as rpcReceiver from "@ennuicastr/mprpc/receiver-worker";
import * as rpcTarget from "@ennuicastr/mprpc/target";

// Constants used by updateWave
const log10 = Math.log(10);
const log1036 = log10 * 3.6;

// Global display timer
let displayLoop: Promise<unknown> | null = null;

// All current waveform displays
const allWaveforms: Record<number, Waveform> = {};

// Array of waveforms to display
let toDisplay: Waveform[] = [];

// Set of waveforms to display
let toDisplaySet: Record<number, boolean> = {};

// If we're currently in a good state
let globalGood = false;

// Wave VAD colors
let waveVADColors: string[] = [];

// Other UI colors
let uiColors: Record<string, string> = {};

// Our waveform display class
class Waveform {
    ctx: OffscreenCanvasRenderingContext2D;
    lblCtx: OffscreenCanvasRenderingContext2D;

    // Should we be rotating?
    rotate: boolean;

    // Wave data
    waveData: number[];

    // VAD data
    waveVADs: number[];

    // Peak data
    peakData: number[];

    // RMS data (i.e., square roots of each value)
    rmsData: number[];

    // Running peak
    curPeak: number;

    // Running sum of roots
    rootSum: number;

    // Number of placeholders (VAD-off zero values) in the RMS data
    rmsPlaceholders: number;

    // How much of the old data actually needs to be redrawn?
    staleData: number;

    // How much new data is there?
    newData: number;

    // How many frames since we reset?
    resetTime: number;
    static resetTimeMax = 1024;

    // What was the display height the last time around?
    lastDisplayHeight: number;

    // Was the status good the last time around?
    lastGood: boolean;

    // What wave VAD color set did we use last time?
    lastWaveVADColors: string[];

    // What was our peak last time?
    lastPeak: number;

    // Build a waveform display
    constructor(
        public id: number,
        public lbl: string,
        public sentRecently: boolean,
        public sampleRate: number,
        public width: number,
        public height: number,
        public canvas: OffscreenCanvas,
        public lblCanvas: OffscreenCanvas
    ) {
        // Canvas contexts
        this.ctx = canvas.getContext("2d", {alpha: false});
        this.lblCtx = lblCanvas.getContext("2d");

        // Other internal data
        this.rotate = false;
        this.waveData = [];
        this.waveVADs = [];
        this.peakData = [];
        this.rmsData = [];
        this.curPeak = 0;
        this.rootSum = 0;
        this.rmsPlaceholders = 0;
        this.staleData = this.newData = 0;
        this.resetTime = Waveform.resetTimeMax;
        this.lastDisplayHeight = 0;
        this.lastGood = false;
        this.lastWaveVADColors = null;

        // If there is no rendering loop, make one
        if (!displayLoop) displayLoop = (async () => {
            let lastAnimationFrame = performance.now();
            while (true) {
                // Wait for a frame
                await new Promise<void>(res => {
                    let af: number | null = null;
                    let to: number | null = null;

                    af = requestAnimationFrame(() => {
                        clearTimeout(to);
                        res();
                    });

                    to = setTimeout(() => {
                        cancelAnimationFrame(af);
                        res();
                    }, 500);
                });

                const curAnimationFrame = performance.now();

                if (curAnimationFrame >= lastAnimationFrame + ifWaveform.frameTime) {
                    lastAnimationFrame += ifWaveform.frameTime;
                    if (lastAnimationFrame < curAnimationFrame - ifWaveform.frameTime)
                        lastAnimationFrame = curAnimationFrame;

                    // Draw
                    for (const w of toDisplay)
                        w.display();
                    toDisplay = [];
                    toDisplaySet = {};
                }
            }
        })();

        // Seed the data
        this.push(0, 2);
    }

    // Push data
    push(val: number, vad: number): void {
        // Bump up surrounding ones to make the wave look nicer
        if (this.waveData.length > 0) {
            let last = this.waveData.pop();
            if (last < val) {
                last = (last+val)/2;
                if (this.newData === 0)
                    this.staleData++;
            } else {
                val = (last+val)/2;
            }
            this.waveData.push(last);
        }

        this.newData++;
        this.waveData.push(val);
        this.waveVADs.push(vad);

        // And push to peak data too
        this.peakData.push(val);
        if (val > this.curPeak)
            this.curPeak = val;
        const root = Math.sqrt(val);
        if (vad >= 2) {
            this.rmsData.push(root);
            this.rootSum += root;
        } else {
            this.rmsData.push(null);
            this.rmsPlaceholders++;
        }

        // Shift over obsolete data
        const max = 30 * this.sampleRate;
        let recalculate = false;
        while (this.peakData.length > max) {
            if (this.peakData[0] === this.curPeak)
                recalculate = true;
            this.peakData.shift();
            const root = this.rmsData.shift();
            if (root !== null)
                this.rootSum -= root;
            else
                this.rmsPlaceholders--;
        }
        if (recalculate)
            this.curPeak = Math.max.apply(Math, this.peakData);

        // And report
        const peakDb = Math.round(20 * Math.log(this.curPeak) / log10);
        const rmsDb = Math.round(20 * Math.log(Math.pow(this.rootSum / (this.rmsData.length - this.rmsPlaceholders), 2)) / log10);
        const stats = "30 second peak " + peakDb + " decibels, RMS " + rmsDb + " decibels";
        workerHandler.waveformStats(this.id, stats);

        // Queue for display
        if (!toDisplaySet[this.id]) {
            toDisplay.push(this);
            toDisplaySet[this.id] = true;
        }
    }

    // Update the wave display when we retroactively promote VAD data
    updateWaveRetroactive(vadExtension: number): void {
        const timeout = Math.ceil(this.sampleRate*vadExtension/1024000);
        let i = Math.max(this.waveVADs.length - timeout, 0);
        const s = this.waveVADs.length - i;
        if (s > this.staleData)
            this.staleData = s;
        for (; i < this.waveVADs.length; i++)
            this.waveVADs[i] = (this.waveVADs[i] === 1) ? 2 : this.waveVADs[i];
    }

    // Display this wave
    display(): void {
        const sentRecently = this.sentRecently;
        const wc = this.canvas;
        const lwc = this.lblCanvas;

        let w = this.width;
        let h = this.height;

        // Rotate if our view is vertical
        if (w/h < 4/3) {
            if (!this.rotate) {
                this.rotate = true;
                workerHandler.setRotate(this.id, true);
            }
        } else {
            if (this.rotate) {
                this.rotate = false;
                workerHandler.setRotate(this.id, false);
            }
        }

        // Set if we need to refresh all data
        let allNew = false;

        // Make sure the canvases are correct
        if (+wc.width !== w) {
            wc.width = w;
            lwc.width = w;
            allNew = true;
        }
        if (+wc.height !== h) {
            wc.height = h;
            lwc.height = h;
            allNew = true;
        }

        if (this.rotate) {
            const tmp = w;
            w = h;
            h = tmp;
        }

        // peakWidth pixels at the right for peak meter
        if (w > ifWaveform.peakWidth * 2)
            w -= ifWaveform.peakWidth;

        // Half the wave height is a more useful value
        h = Math.floor(h/2);

        // Figure out the width of each sample
        const sw = Math.max(Math.floor(w/468), 1);
        const dw = Math.ceil(w/sw);

        // Make sure we have an appropriate amount of data
        const waveData = this.waveData;
        const waveVADs = this.waveVADs;
        while (waveData.length > dw) {
            waveData.shift();
            waveVADs.shift();
        }
        while (waveData.length < dw) {
            waveData.unshift(0);
            waveVADs.unshift(0);
        }
        if (this.newData >= dw)
            allNew = true;

        // Figure out the ceiling of the display
        const maxVal = Math.max(
            Math.min(
                Math.max.apply(Math, waveData) * 1.1,
                1
            ),
            0.015 // So the too-quiet bar will always show
        );
        const dh = Math.log(maxVal + 1) / log10;
        if (this.lastDisplayHeight !== dh) {
            this.lastDisplayHeight = dh;
            allNew = true;
        }

        // Figure out whether it should be colored at all
        const good = globalGood && sentRecently;
        if (this.lastGood !== good) {
            this.lastGood = good;
            allNew = true;
        }

        // And redraw if the colors have changed
        if (this.lastWaveVADColors !== waveVADColors) {
            this.lastWaveVADColors = waveVADColors;
            allNew = true;
        }

        // Or if we haven't reset in a while
        if (this.resetTime-- <= 0)
            allNew = true;

        // And draw it
        const ctx = this.ctx;
        const lctx = this.lblCtx;
        let i, p;

        // Make room for new data
        if (!allNew) {
            try {
                const cut = sw * this.newData;
                const ow = w - cut, oh = h*2;
                let id = ctx.getImageData(cut, 0, ow, oh);
                ctx.putImageData(id, 0, 0);
            } catch (ex) {
                allNew = true;
            }
        }

        // If we should be treating everything as new, do so
        if (allNew) {
            this.staleData = 0;
            this.newData = dw;
            this.resetTime = Waveform.resetTimeMax;
            ctx.reset();
            lctx.reset();
        }

        // Get the x location where new data starts
        const ndx = w - sw * this.newData;

        // Transform the canvas if we're rotating
        /*
        ctx.save();
        lctx.save();
        */
        if (this.rotate) {
            ctx.rotate(Math.PI/2);
            ctx.translate(0, -2*h);
            lctx.rotate(Math.PI/2);
            lctx.translate(0, -2*h);
        }

        // A function for drawing our level warning bars
        function levelBar(at: number, color: string) {
            at = Math.log(at + 1) / log10;
            if (dh <= at) return;
            const y = at / dh * h;
            ctx.fillStyle = color;
            ctx.fillRect(ndx, h-y-1, w-ndx, 1);
            ctx.fillRect(ndx, h+y, w-ndx, 1);
        }

        // Background color
        ctx.fillStyle = uiColors["bg"];
        ctx.fillRect(ndx, 0, w-ndx, h*2);

        // Level bar at 1% (-40dB) for "too soft"
        levelBar(0.01, uiColors["wave-too-soft"]);

        // Each column
        for (i = dw - this.newData, p = w - sw * this.newData; i < dw; i++, p += sw) {
            const d = Math.log(waveData[i] + 1) / log10 / dh * h;
            ctx.fillStyle = good ? waveVADColors[waveVADs[i]] : "#000";
            ctx.fillRect(p, h-d, sw, 2*d);
        }

        // Level bar at 50% (about -6dB) for "too loud"
        levelBar(0.5, uiColors["wave-too-loud"]);

        // Possibly draw the peak labels
        function drawLabel(db: number, t: number) {
            const txt = db + "dB";
            const m = lctx.measureText(txt);
            const l = w - m.width - ifWaveform.peakWidth - 2;
            t = ~~(t + m.actualBoundingBoxAscent/2);
            lctx.fillStyle = "#fff";
            lctx.fillText(txt, l, t);
        }
        if (allNew) {
            lctx.clearRect(0, 0, w, h*2);
            drawLabel(-12, h/3);
            drawLabel(-24, 2*h/3);
            drawLabel(-36, h);
        }

        // Peak meter at the right
        let peak = 2 * Math.log(waveData[waveData.length-1]) / log1036 + 1;
        if (peak < this.lastPeak)
            peak = (this.lastPeak * 3 + peak) / 4;
        this.lastPeak = peak;
        for (let pi = 0; pi < 3; pi++) {
            const c = pi + 1;
            const pl = (2-pi)/3, pu = (3-pi)/3;
            if (peak <= pu) {
                ctx.fillStyle = uiColors["nopeak-" + c];
                ctx.fillRect(w, ~~(h*pi/3), ifWaveform.peakWidth, ~~(h*2*(3-pi)/3));
            }
            if (peak >= pl) {
                ctx.fillStyle = uiColors["peak-" + c];
                if (peak >= pu)
                    ctx.fillRect(w, ~~(h-(pu*h)), ifWaveform.peakWidth, ~~(h*2*pu));
                else
                    ctx.fillRect(w, ~~(h-(peak*h)), ifWaveform.peakWidth, ~~(h*2*peak));
            }
        }

        /*
        ctx.restore();
        lctx.restore();
        */
        this.staleData = this.newData = 0;

        // Set the CSS
        const peakDb = 20 * Math.log(waveData[waveData.length-1]) / log10;
        const cssPeak = (peakDb < -100) ? 0 : peakDb + 100;
        let css = "";
        for (const part of [
            `input[type=range].ec3-peak-horizontal-${this.lbl}::-webkit-slider-runnable-track`,
            `input[type=range].ec3-peak-horizontal-${this.lbl}:focus::-webkit-slider-runnable-track`,
            `input[type=range].ec3-peak-horizontal-${this.lbl}::-moz-range-track`
        ]) {
            css += `${part} { ` +
                `background: linear-gradient(90deg, ` +
                    `var(--peak-3) 0 ${cssPeak}%, ` +
                    `var(--bg-button) ${cssPeak}% 100%); ` +
                `} `;
        }
        postMessage({
            c: "waveform-css",
            id: this.id,
            css
        });
    }

    setCanvasSize(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    setSentRecently(sentRecently: boolean) {
        this.sentRecently = sentRecently;
    }
}

// A class just for receiving particular waveform messages
class WaveformReceiver
    implements rpcReceiver.RPCReceiver<ifWaveform.WaveformReceiver>
{
    constructor(private _id: number) {}

    push(val: number, vad: number): void {
        const wf = allWaveforms[this._id];
        if (!wf) return;
        wf.push(val, vad);
    }
}

// Our message-receiving “main” class
class WaveformWorker 
    implements ifWaveform.WaveformWorker, rpcTarget.Async<ifWaveform.WaveformWorkerRev>
{
    newWaveform(
        id: number,
        lbl: string,
        sentRecently: boolean,
        sampleRate: number,
        width: number,
        height: number,
        canvas: OffscreenCanvas,
        lblCanvas: OffscreenCanvas
    ) {
        allWaveforms[id] = new Waveform(
            id, lbl, sentRecently, sampleRate, width, height, canvas, lblCanvas
        );
    }

    termWaveform(id: number): void {
        delete allWaveforms[id];
    }

    reverse(mp: MessagePort): void {
        this._reverse = new rpcTarget.RPCTarget(mp);
    }

    push(id: number, val: number, vad: number): void {
        allWaveforms[id].push(val, vad);
    }

    updateWaveRetroactive(id: number, vadExtension: number): void {
        allWaveforms[id].updateWaveRetroactive(vadExtension);
    }

    setWaveformPort(id: number, port: MessagePort): void {
        const wr = new WaveformReceiver(id);
        rpcReceiver.rpcReceiver(wr, port);
        port.start();
    }

    setCanvasSize(id: number, width: number, height: number): void {
        allWaveforms[id].setCanvasSize(width, height);
    }

    setSentRecently(id: number, to: boolean): void {
        allWaveforms[id].setSentRecently(to);
    }

    setWaveVADColors(to: string[]): void {
        waveVADColors = to;
    }

    setUIColors(to: Record<string, string>): void {
        uiColors = to;
    }

    setGood(to: boolean): void {
        globalGood = to;
    }

    private _reverse?: rpcTarget.RPCTarget;

    async waveformStats(id: number, text: string): Promise<void> {
        this._reverse.rpcv("waveformStats", [id, text]);
    }

    async setRotate(id: number, to: boolean): Promise<void> {
        this._reverse.rpcv("setRotate", [id, to]);
    }
}

const workerHandler = new WaveformWorker();
rpcReceiver.rpcWorkerMain(workerHandler);
