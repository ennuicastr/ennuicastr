/*
 * Copyright (c) 2018-2023 Yahweasel
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
 * The “waveform” display.
 */

import * as audio from "./audio";
import * as config from "./config";
import * as net from "./net";
import * as ui from "./ui";

// Constants used by updateWave
const log10 = Math.log(10);
const log1036 = log10 * 3.6;

// Global display timer
let displayInterval: number|null = null;

// Array of waveforms to display
let toDisplay: Waveform[] = [];

// Set of waveforms to display
let toDisplaySet: Record<number, boolean> = {};

// Increasing index of waveforms allocated
let waveformId = 0;

// Width of the peak meter
const peakWidth = 6;

// Whether to persist the peak labels
let persistPeak = false;

// Our waveform display class
export class Waveform {
    lbl: string;
    id: number;
    wrapper: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    lblCanvas: HTMLCanvasElement;
    lblCtx: CanvasRenderingContext2D;
    statsBox: HTMLElement;
    css: HTMLStyleElement;
    watcher: HTMLImageElement;

    // Should we be rotating?
    rotate: boolean;

    // Sample rate of data
    sampleRate: number;

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

    // Have we sent recently?
    sentRecently: boolean;

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
        lbl: string, sampleRate: number, wrapper: HTMLElement,
        watcher: HTMLImageElement
    ) {
        this.lbl = lbl;
        this.id = waveformId++;
        this.sampleRate = sampleRate;

        this.wrapper = wrapper;
        Object.assign(wrapper.style, {
            position: "relative",
            overflow: "hidden"
        });

        // Main canvas
        const canvas = this.canvas = document.createElement("canvas");
        Object.assign(canvas.style, {
            position: "absolute",
            left: "0px",
            top: "0px"
        });
        wrapper.setAttribute("role", "img");
        wrapper.innerHTML = "";
        wrapper.appendChild(canvas);
        this.ctx = canvas.getContext("2d", {alpha: false});

        // Wrapper for the label and stats canvases
        const lblStatsWrapper = document.createElement("div");
        lblStatsWrapper.classList.add("ecwaveform-label");
        Object.assign(lblStatsWrapper.style, {
            position: "absolute",
            left: "0px",
            top: "0px",
            width: "100%",
            height: "100%"
        });
        wrapper.appendChild(lblStatsWrapper);

        // The label canvas
        const lblCanvas = this.lblCanvas = document.createElement("canvas");
        Object.assign(lblCanvas.style, {
            position: "absolute",
            left: "0px",
            top: "0px"
        });
        lblStatsWrapper.appendChild(lblCanvas);
        lblCanvas.onclick = function() {
            persistPeak = !persistPeak;
            document.body.setAttribute("data-persist-peak-labels", persistPeak ? "yes" : "no");
        };
        this.lblCtx = lblCanvas.getContext("2d");

        // And the stats box
        const statsBox = this.statsBox = document.createElement("span");
        Object.assign(statsBox.style, {
            position: "absolute",
            right: (peakWidth + 8) + "px",
            bottom: "2px",
            fontSize: "0.8em"
        });
        lblStatsWrapper.appendChild(statsBox);

        // CSS for other elements that need the waveform
        const css = this.css = document.createElement("style");
        css.type = "text/css";
        document.head.appendChild(css);

        // The watcher image
        this.watcher = watcher;
        if (watcher)
            wrapper.appendChild(watcher);

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
        this.lastDisplayHeight = 0;
        this.lastGood = false;
        this.lastWaveVADColors = null;

        // If there is no rendering interval, make one
        if (!displayInterval) {
            displayInterval = setInterval(function() {
                let af: number = null;

                function go() {
                    af = null;
                    toDisplay.forEach((w) => {
                        w.display();
                    });
                    toDisplay = [];
                    toDisplaySet = {};
                }

                /* For smoothness, we want this on an animation frame. We don't
                 * want to wait for an animation frame if the screen is
                 * minimized, but we *do* still want to run the display
                 * function, because it also does data management. So, we use
                 * requestAnimationFrame if the window is visible, and just
                 * call display otherwise. */
                if (document.visibilityState === "visible") {
                    af = window.requestAnimationFrame(go);

                    setTimeout(function() {
                        if (af !== null) {
                            window.cancelAnimationFrame(af);
                            go();
                        }
                    }, 100);

                } else {
                    go();

                }
            }, 50);
        }

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
        let stats = "30 second peak " + peakDb + " decibels, RMS " + rmsDb + " decibels";
        this.wrapper.setAttribute("aria-label", stats);
        stats = stats.replace(/ decibels/g, "dB");
        this.statsBox.innerText = stats;
    }

    // Update the wave display when we retroactively promote VAD data
    updateWaveRetroactive(vadExtension: number): void {
        const timeout = Math.ceil(audio.ac.sampleRate*vadExtension/1024000);
        let i = Math.max(this.waveVADs.length - timeout, 0);
        const s = this.waveVADs.length - i;
        if (s > this.staleData)
            this.staleData = s;
        for (; i < this.waveVADs.length; i++)
            this.waveVADs[i] = (this.waveVADs[i] === 1) ? 2 : this.waveVADs[i];
    }

    // Queue the wave to be displayed
    updateWave(value: number, sentRecently: boolean): void {
        this.sentRecently = sentRecently;
        if (toDisplaySet[this.id])
            return;
        toDisplay.push(this);
        toDisplaySet[this.id] = true;
    }

    // Display this wave
    display(): void {
        const sentRecently = this.sentRecently;
        const wc = this.canvas;
        const lwc = this.lblCanvas;

        // Start from the element size
        let w = this.wrapper.offsetWidth;
        let h = this.wrapper.offsetHeight;

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
        if (w > peakWidth * 2)
            w -= peakWidth;

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
        const good = net.connected && net.transmitting && audio.timeOffset && sentRecently;
        if (this.lastGood !== good) {
            this.lastGood = good;
            allNew = true;
        }

        // And redraw if the colors have changed
        if (this.lastWaveVADColors !== config.waveVADColors) {
            this.lastWaveVADColors = config.waveVADColors;
            allNew = true;
        }

        // If we should be treating everything as new, do so
        if (allNew) {
            this.staleData = 0;
            this.newData = dw;
        }

        // And draw it
        const ctx = this.ctx;
        const lctx = this.lblCtx;
        let i, p;

        // Make room for new data
        try {
            if (this.rotate)
                ctx.drawImage(this.canvas, 0, -sw * this.newData);
            else
                ctx.drawImage(this.canvas, -sw * this.newData, 0);
        } catch (ex) {}
        this.newData += this.staleData;

        // Get the x location where new data starts
        const ndx = w - sw * this.newData;

        // Transform the canvas if we're rotating
        ctx.save();
        lctx.save();
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
        ctx.fillStyle = ui.ui.colors["bg-wave"];
        ctx.fillRect(ndx, 0, w-ndx, h*2);

        // Level bar at 1% (-40dB) for "too soft"
        levelBar(0.01, ui.ui.colors["wave-too-soft"]);

        // Each column
        for (i = dw - this.newData, p = w - sw * this.newData; i < dw; i++, p += sw) {
            const d = Math.log(waveData[i] + 1) / log10 / dh * h;
            ctx.fillStyle = good ? config.waveVADColors[waveVADs[i]] : "#000";
            ctx.fillRect(p, h-d, sw, 2*d);
        }

        // Level bar at 50% (about -6dB) for "too loud"
        levelBar(0.5, ui.ui.colors["wave-too-loud"]);

        // Possibly draw the peak labels
        function drawLabel(db: number, t: number) {
            const txt = db + "dB";
            const m = lctx.measureText(txt);
            const l = w - m.width - peakWidth - 2;
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
                ctx.fillStyle = ui.ui.colors["nopeak-" + c];
                ctx.fillRect(w, ~~(h*pi/3), peakWidth, ~~(h*2*(3-pi)/3));
            }
            if (peak >= pl) {
                ctx.fillStyle = ui.ui.colors["peak-" + c];
                if (peak >= pu)
                    ctx.fillRect(w, ~~(h-(pu*h)), peakWidth, ~~(h*2*pu));
                else
                    ctx.fillRect(w, ~~(h-(peak*h)), peakWidth, ~~(h*2*peak));
            }
        }

        ctx.restore();
        lctx.restore();
        this.staleData = this.newData = 0;

        // Set the CSS
        const peakDb = 20 * Math.log(waveData[waveData.length-1]) / log10;
        const cssPeak = (peakDb < -100) ? 0 : peakDb + 100;
        let css = "";
        for (const part of [
            `input[type=range].ecpeak-horizontal-${this.lbl}::-webkit-slider-runnable-track`,
            `input[type=range].ecpeak-horizontal-${this.lbl}:focus::-webkit-slider-runnable-track`,
            `input[type=range].ecpeak-horizontal-${this.lbl}::-moz-range-track`
        ]) {
            css += `${part} { ` +
                `background: linear-gradient(90deg, ` +
                    `var(--peak-3) 0 ${cssPeak}%, ` +
                    `var(--bg-wave) ${cssPeak}% 100%); ` +
                `} `;
        }
        this.css.innerHTML = css;
    }
}
