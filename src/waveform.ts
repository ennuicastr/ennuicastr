/*
 * Copyright (c) 2018-2021 Yahweasel
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

import * as audio from "./audio";
import * as config from "./config";
import * as net from "./net";
import * as ui from "./ui";

// Constant used by updateWave
const e4 = Math.exp(4);

// Our waveform display class
export class Waveform {
    wrapper: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    watcher: HTMLImageElement;

    // Should we be rotating?
    rotate: boolean;

    // Wave data
    waveData: number[];

    // VAD data
    waveVADs: number[];

    // How much of the old data actually needs to be redrawn?
    staleData: number;

    // How much new data is there?
    newData: number;

    // What was the display height the last time around?
    lastDisplayHeight: number;

    // Was the status good the last time around?
    lastGood: boolean;

    // When was the last frame shown?
    lastFrameTime: number;

    // Build a waveform display
    constructor(wrapper: HTMLElement, canvas: HTMLCanvasElement, watcher: HTMLImageElement) {
        this.wrapper = wrapper;
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", {alpha: false});
        this.watcher = watcher;
        this.rotate = false;
        this.waveData = [];
        this.waveVADs = [];
        this.staleData = this.newData = 0;
        this.lastDisplayHeight = 0;
        this.lastGood = false;
        this.lastFrameTime = 0;
    }

    // Push data
    push(val: number, vad: number) {
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
    }

    // Update the wave display when we retroactively promote VAD data
    updateWaveRetroactive(vadExtension: number) {
        let timeout = Math.ceil(audio.ac.sampleRate*vadExtension/1024000);
        let i = Math.max(this.waveVADs.length - timeout, 0);
        for (; i < this.waveVADs.length; i++)
            this.waveVADs[i] = (this.waveVADs[i] === 1) ? 2 : this.waveVADs[i];
    }

    // Update the wave display
    updateWave(value: number, sentRecently: boolean) {
        var frameTime = performance.now();
        if (frameTime - this.lastFrameTime < 30) {
            // Keep the framerate down to save CPU cycles
            return;
        }
        this.lastFrameTime = frameTime;

        var wc = this.canvas;

        // Start from the element size
        var w = this.wrapper.offsetWidth;
        var h = this.wrapper.offsetHeight;

        // Rotate if our view is vertical
        if (w/h < 4/3) {
            if (!this.rotate) {
                if (this.watcher) this.watcher.style.visibility = "hidden";
                this.rotate = true;
            }
        } else {
            if (this.rotate) {
                if (this.watcher) this.watcher.style.visibility = "";
                this.rotate = false;
            }
        }

        // Set if we need to refresh all data
        var allNew = false;

        // Make sure the canvases are correct
        if (+wc.width !== w) {
            wc.width = w;
            allNew = true;
        }
        if (+wc.height !== h) {
            wc.height = h;
            allNew = true;
        }

        if (this.rotate) {
            var tmp = w;
            w = h;
            h = tmp;
        }

        // Half the wave height is a more useful value
        h = Math.floor(h/2);

        // Figure out the width of each sample
        var sw = Math.max(Math.floor(w/468), 1);
        var dw = Math.ceil(w/sw);

        // Make sure we have an appropriate amount of data
        var waveData = this.waveData;
        var waveVADs = this.waveVADs;
        while (waveData.length > dw) {
            waveData.shift();
            waveVADs.shift();
        }
        while (waveData.length < dw) {
            waveData.unshift(0);
            waveVADs.unshift(0);
        }

        // Figure out the height of the display
        var dh = Math.min(Math.max.apply(Math, waveData) * 1.5, 1);
        if (dh < 0.06) dh = 0.06; // Make sure the too-quiet bars are always visible
        if (this.lastDisplayHeight !== dh) {
            this.lastDisplayHeight = dh;
            allNew = true;
        }

        // Figure out whether it should be colored at all
        var good = net.connected && net.transmitting && audio.timeOffset && sentRecently;
        if (this.lastGood !== good) {
            this.lastGood = good;
            allNew = true;
        }

        // If we should be treating everything as new, do so
        if (allNew) {
            this.staleData = 0;
            this.newData = dw;
        }

        // And draw it
        var ctx = this.ctx;
        var i, p;

        // Make room for new data
        if (this.rotate)
            ctx.drawImage(this.canvas, 0, -sw * this.newData);
        else
            ctx.drawImage(this.canvas, -sw * this.newData, 0);
        this.newData += this.staleData;

        // Get the x location where new data starts
        var ndx = w - sw * this.newData;

        // Transform the canvas if we're rotating
        ctx.save();
        if (this.rotate) {
            ctx.rotate(Math.PI/2);
            ctx.translate(0, -2*h);
        }

        // A function for drawing our level warning bars
        function levelBar(at: number, color: string) {
            if (dh <= at) return;
            var y = Math.log(at/dh * e4) / 4 * h;
            ctx.fillStyle = color;
            ctx.fillRect(ndx, h-y-1, w-ndx, 1);
            ctx.fillRect(ndx, h+y, w-ndx, 1);
        }

        // Background color
        ctx.fillStyle = ui.ui.colors["bg-wave"];
        ctx.fillRect(ndx, 0, w-ndx, h*2);

        // Level bar at 0.4% for "too soft"
        levelBar(0.004, ui.ui.colors["wave-too-soft"]);

        // Each column
        for (i = dw - this.newData, p = w - sw * this.newData; i < dw; i++, p += sw) {
            var d = Math.max(Math.log((waveData[i] / dh) * e4) / 4, 0) * h;
            if (d === 0) d = 1;
            ctx.fillStyle = good ? config.waveVADColors[waveVADs[i]] : "#000";
            ctx.fillRect(p, h-d, sw, 2*d);
        }

        // Level bar at 90% for "too loud"
        levelBar(0.9, ui.ui.colors["wave-too-loud"]);

        ctx.restore();
        this.staleData = this.newData = 0;
    }
}
