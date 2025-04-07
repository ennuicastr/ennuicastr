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
 * The “waveform” display.
 */

import * as rpcReceiver from "@ennuicastr/mprpc/receiver";
import * as rpcTarget from "@ennuicastr/mprpc/target";

import * as ifWaveform from "./iface/waveform";

import * as audio from "./audio";
import * as config from "./config";
import * as net from "./net";
import * as ui from "./ui";
import * as util from "./util";
import * as workers from "./workers";

// All current waveforms
const allWaveforms: Record<number, Waveform> = {};

// Increasing index of waveforms allocated
let waveformId = 0;

// Whether to persist the peak labels
let persistPeak = false;

// Waveform worker
class WaveformWorker
    extends rpcTarget.RPCWorker
    implements rpcTarget.Async<ifWaveform.WaveformWorker>,
        rpcReceiver.RPCReceiver<ifWaveform.WaveformWorkerRev>
{
    constructor() {
        super(workers.waveformWorker);

        const mc = new MessageChannel();
        rpcReceiver.rpcReceiver(this, mc.port1);
        this.reverse(mc.port2);

        this.setWaveVADColors(
            config.useContinuous
                ? config.waveVADColorSets.sc
                : config.waveVADColorSets.sv
        );

        this.setUIColors(ui.ui.colors);

        this._resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const target = <HTMLElement> entry.target;
                const id: number = (<any> target)._ecId;
                if (typeof id !== "number") continue;
                this.setCanvasSize(
                    id, target.offsetWidth, target.offsetHeight
                );
            }
        });

        util.events.addEventListener("audio.audioOffset", this.updateGood.bind(this));
        util.events.addEventListener("net.connected", this.updateGood.bind(this));
        util.events.addEventListener("net.transmitting", this.updateGood.bind(this));
        this.updateGood();
    }

    newWaveform(
        id: number, lbl: string, sentRecently: boolean, sampleRate: number,
        width: number, height: number, canvas: OffscreenCanvas,
        lblCanvas: OffscreenCanvas
    ): Promise<void> {
        return this.rpc("newWaveform", [
            id, lbl, sentRecently, sampleRate, width, height, canvas, lblCanvas
        ], [canvas, lblCanvas]);
    }

    registerNewWaveform(
        waveform: Waveform, wrapper: HTMLElement, canvas: HTMLCanvasElement,
        id: number, lbl: string, sentRecently: boolean, sampleRate: number,
        width: number, height: number, osCanvas: OffscreenCanvas,
        lblCanvas: OffscreenCanvas
    ): Promise<void> {
        allWaveforms[id] = waveform;
        const ret = this.newWaveform(
            id, lbl, sentRecently, sampleRate, width, height, osCanvas, lblCanvas
        );
        this._resizeObserver.observe(wrapper);
        return ret;
    }

    termWaveform(id: number): Promise<void> {
        return this.rpc("termWaveform", [id]);
    }

    freeWaveform(wrapper: HTMLElement, id: number): Promise<void> {
        delete allWaveforms[id];
        this._resizeObserver.unobserve(wrapper);
        return this.termWaveform(id);
    }

    async reverse(mp: MessagePort): Promise<void> {
        this.rpcv("reverse", [mp], [mp]);
    }

    push(id: number, val: number, vad: number): Promise<void> {
        return this.rpc("push", [id, val, vad]);
    }

    updateWaveRetroactive(id: number, vadExtension: number): Promise<void> {
        return this.rpc("updateWaveRetroactive", [id, vadExtension]);
    }

    setWaveformPort(id: number, port: MessagePort): Promise<void> {
        return this.rpc("setWaveformPort", [id, port], [port]);
    }

    setCanvasSize(id: number, width: number, height: number): Promise<void> {
        return this.rpc("setCanvasSize", [id, width, height]);
    }

    setSentRecently(id: number, to: boolean): Promise<void> {
        return this.rpc("setSentRecently", [id, to]);
    }

    setWaveVADColors(to: string[]): Promise<void> {
        return this.rpc("setWaveVADColors", [to]);
    }

    setUIColors(to: Record<string, string>): Promise<void> {
        return this.rpc("setUIColors", [to]);
    }

    setGood(to: boolean): Promise<void> {
        return this.rpc("setGood", [to]);
    }

    private _lastGood = false;
    updateGood() {
        const good = audio.timeOffset && net.connected && net.transmitting;
        if (good !== this._lastGood) {
            this._lastGood = good;
            this.setGood(good);
        }
    }

    waveformStats(id: number, text: string): void {
        const wv = allWaveforms[id];
        if (!wv) return;
        wv.wrapper.setAttribute("aria-label", text);
        text = text.replace(/ decibels/g, "dB");
        wv.statsBox.innerText = text;
    }

    setRotate(id: number, to: boolean): void {
        const wv = allWaveforms[id];
        if (!wv) return;
        if (!wv.watcher) return;
        wv.watcher.style.display = to ? "none" : "";
    }

    private _resizeObserver: ResizeObserver;
}

// There's only one waveform worker
let theWaveformWorker: WaveformWorker | null = null;
function getWaveformWorker() {
    if (!theWaveformWorker)
        theWaveformWorker = new WaveformWorker();
    return theWaveformWorker!;
}

const waveformFinalizer = new FinalizationRegistry<[HTMLElement, number]>(
    x => getWaveformWorker().freeWaveform(x[0], x[1])
);

// Waveform disiplay, wrapper for the waveform worker
export class Waveform {
    lbl: string;
    id: number;
    wrapper: HTMLElement;
    canvas: HTMLCanvasElement;
    lblCanvas: HTMLCanvasElement;
    statsBox: HTMLElement;
    css: HTMLStyleElement;
    watcher: HTMLImageElement;

    // Build a waveform display
    constructor(
        lbl: string, sentRecently: boolean, sampleRate: number,
        wrapper: HTMLElement, watcher: HTMLImageElement
    ) {
        this.lbl = lbl;
        this.id = waveformId++;

        this.wrapper = wrapper;
        (<any> wrapper)._ecId = this.id;
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
        const canvasOffscreen = canvas.transferControlToOffscreen();

        // Wrapper for the label and stats canvases
        const lblStatsWrapper = document.createElement("div");
        lblStatsWrapper.classList.add("ec3-waveform-label");
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
        const lblCanvasOffscreen = lblCanvas.transferControlToOffscreen();

        // And the stats box
        const statsBox = this.statsBox = document.createElement("span");
        Object.assign(statsBox.style, {
            position: "absolute",
            right: (ifWaveform.peakWidth + 40) + "px",
            top: "2px",
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

        // Pass it to the worker
        getWaveformWorker().registerNewWaveform(
            this, wrapper, canvas,
            this.id, this.lbl, sentRecently, sampleRate,
            wrapper.offsetWidth, wrapper.offsetHeight,
            canvasOffscreen, lblCanvasOffscreen
        ).catch(net.catastrophicErrorFactory());

        waveformFinalizer.register(this, [wrapper, this.id]);
    }

    // Push data
    push(val: number, vad: number): void {
        getWaveformWorker().push(this.id, val, vad)
            .catch(net.catastrophicErrorFactory());
    }

    // Update the wave display when we retroactively promote VAD data
    updateWaveRetroactive(vadExtension: number): void {
        getWaveformWorker().updateWaveRetroactive(this.id, vadExtension)
            .catch(net.catastrophicErrorFactory());
    }

    setWaveformPort(port: MessagePort): void {
        getWaveformWorker().setWaveformPort(this.id, port)
            .catch(net.catastrophicErrorFactory());
    }

    // Set whether we've sent recently for display
    setSentRecently(to: boolean): void {
        getWaveformWorker().setSentRecently(this.id, to)
            .catch(net.catastrophicErrorFactory());
    }
}

export function setWaveVADColors(to: string): void {
    getWaveformWorker().setWaveVADColors(config.waveVADColorSets[to]);
}
