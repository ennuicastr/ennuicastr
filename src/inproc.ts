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
 * Input audio processing.
 */

import * as audio from "./audio";
import * as config from "./config";
import * as ifInproc from "./iface/inproc";
import * as inprocWorker from "./inproc-worker-js";
import * as log from "./log";
import * as net from "./net";
import * as capture from "./capture";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as vad from "./vad";
import * as waveform from "./waveform";

import { Ennuiboard } from "ennuiboard";
import * as rpcReceiver from "@ennuicastr/mprpc/receiver";
import * as rpcTarget from "@ennuicastr/mprpc/target";
import * as rtennui from "rtennui";

// Set if we've sent data recently
let sentRecently = false;

// A timeout for periodic checks that are done regardless of processing backend
let periodic: null|number = null;

// En/disable noise reduction
export let useNR = false;
export function setUseNR(to: boolean): void { useNR = to; }

// VAD sensitivity (0 to 3, more is less)
export let vadSensitivity = 0;
export function setVadSensitivity(to: number): void { vadSensitivity = to; }

// VAD noise gate (-100 to 0, dB)
export let vadNoiseGate = -100;
export function setVadNoiseGate(to: number): void { vadNoiseGate = to; }

/**
 * Our own custom capture class that can use a bare MessagePort.
 */
class InProcAudioCapture extends rtennui.AudioCapture {
    constructor(
        /**
         * The raw capture (for sample rate).
         */
        public rawCapture: rtennui.AudioCapture,

        /**
         * The port on which the actual data will be received.
         */
        public port: MessagePort
    ) {
        super();
    }

    // Just thru to the raw capture
    override getSampleRate(): number {
        return this.rawCapture.getSampleRate();
    }

    override getLatency(): number {
        return this.rawCapture.getLatency();
    }

    // Overridden on to make sure we know if they want normal data
    override on(ev: string, handler: any) {
        if (ev !== "data")
            return super.on(ev, handler);

        if (!this._initialized) {
            // Initialize it for simple piping mode
            this.port.postMessage({c: "out", tryShared: false});
            this.port.onmessage = ev => {
                this.emitEvent("data", ev.data);
            };
            this._initialized = true;
        }

        return super.on(ev, handler);
    }

    // Pipe directly
    override pipe(to: MessagePort, shared?: boolean): void {
        if (!shared) {
            super.pipe(to, shared);
            return;
        }

        this._initialized = true;
        this.port.postMessage({c: "out", tryShared: true});
    }

    override close(): void {
    }

    private _initialized = false;
}

// The local processing worker
class InputProcessorWorker
    extends rpcTarget.RPCWorker
    implements
        rpcTarget.Async<ifInproc.InputProcessor>,
        rpcReceiver.RPCReceiver<ifInproc.InputProcessorRev>
{
    constructor(optsBasic: ifInproc.InProcOptsBasic & {ecOutput: boolean}) {
        super(inprocWorker.js);

        const opts = <ifInproc.InProcOpts> <any> optsBasic;

        const inputMC = new MessageChannel();
        this.inputPort = inputMC.port1;
        opts.input = inputMC.port2;

        const renderInputMC = new MessageChannel();
        this.renderInputPort = inputMC.port1;
        opts.renderInput = inputMC.port2;

        const outputMC = new MessageChannel();
        this.outputPort = outputMC.port1;
        opts.output = outputMC.port2;

        if (optsBasic.ecOutput) {
            const ecOutputMC = new MessageChannel();
            this.ecOutputPort = ecOutputMC.port1;
            opts.ecOutput = ecOutputMC.port2;
        }

        const reverseMC = new MessageChannel();
        rpcReceiver.rpcReceiver(this, reverseMC.port1);
        opts.reverse = reverseMC.port2;

        this.init(opts).catch(net.catastrophicErrorFactory());
    }

    init(opts: ifInproc.InProcOpts): Promise<void> {
        const transfer: Transferable[] = [
            opts.input, opts.renderInput, opts.output, opts.reverse
        ];
        if (opts.ecOutput)
            transfer.push(opts.ecOutput);
        return this.rpc("init", [opts], transfer);
    }

    setOpts(opts: Partial<ifInproc.InProcOptsBasic>): Promise<void> {
        return this.rpc("setOpts", [opts]);
    }

    vadState(raw: boolean, rtc: boolean, merged: boolean): void {
        if (this.onvadstate)
            this.onvadstate(raw, rtc, merged);
    }

    max(v: number): void {
        if (this.onmax)
            this.onmax(v);
    }

    transcription(
        result: ifInproc.TranscriptionResult, complete: boolean
    ): void {
        if (this.ontranscription)
            this.ontranscription(result, complete);
    }

    onvadstate?: (raw: boolean, rtc: boolean, merged: boolean) => unknown;
    onmax?: (v: number) => unknown;
    ontranscription?: (
        result: ifInproc.TranscriptionResult, complete: boolean
    ) => unknown;

    inputPort: MessagePort;
    renderInputPort: MessagePort;
    outputPort: MessagePort;
    ecOutputPort?: MessagePort;
}

// All local processing: The VAD, wave display, and noise reduction
export async function localProcessing(idx: number): Promise<void> {
    if (!audio.inputs[idx].userMedia) {
        // Need our MediaSource first!
        await new Promise<void>(res => {
            util.events.addEventListener("usermediaready" + idx, ()=>res(), {once: true});
        });
    }

    /* Set sentRecently and lastSentTime to slightly in the future so we
     * don't get messages about failing to send while everything starts up
     * */
    sentRecently = true;
    const input = audio.inputs[idx];
    input.lastSentTime = performance.now() + 2500;

    // Some things done periodically other than audio per se
    if (!periodic) {
        periodic = setInterval(function() {
            // Display an issue if we haven't sent recently
            const now = performance.now();
            sentRecently = (input.lastSentTime > now-1500);
            if (sentRecently)
                log.popStatus("notencoding");
            else
                log.pushStatus("notencoding", "Audio encoding is not functioning!");

            if (Ennuiboard.enabled.gamepad)
                Ennuiboard.subsystems.gamepad.poll();
        }, 100);
    }

    // Create a display for it, either in the main waveform wrapper or the studio location
    let studio = (ui.ui.video.mode === ui.ViewMode.Studio);
    let wd: waveform.Waveform;
    function studioSwapped() {
        if (studio) {
            const user = ui.ui.video.users[net.selfId];
            if (!user) {
                studio = false;
                studioSwapped();
            } else {
                wd = new waveform.Waveform("self", audio.ac.sampleRate / 1024, user.waveformWrapper, null);
            }
        } else {
            wd = new waveform.Waveform("self", audio.ac.sampleRate / 1024, ui.ui.wave.wrapper, ui.ui.wave.watcher);
        }
    }
    studioSwapped();

    // Start the capture
    const cap = await capture.createCapture(audio.ac, {
        input: input.userMedia,
        matchSampleRate: true
    });
    /* REMOVE
    const cap = await capture.createCapture(audio.ac, {
        input: input.userMedia,
        backChannels: 1,
        workerCommand: {
            c: "filter",
            renderSampleRate: audio.ac.sampleRate,
            useEC: audio.useEC,
            useNR: useNR,
            sentRecently: sentRecently,
            vadSensitivity: vadSensitivity,
            vadNoiseGate: vadNoiseGate,
            useTranscription: config.useTranscription,
            channel: input.channel
        }

    });
    */

    // State to send back to the worker
    let lastUseEC = audio.useEC;
    let lastUseNR = useNR;
    let lastSentRecently = sentRecently;
    let lastVadSensitivity = vadSensitivity;
    let lastVadNoiseGate = vadNoiseGate;

    // Prepare the backchannel (rendered output)
    const backChannel = await rtennui.createAudioCapture(
        audio.ac, audio.ac.ecDestination
    );
    audio.ac.ecDestinationDelay.delayTime.value =
        (backChannel.getLatency() + 5) / 1000;
    const backChannelMC = new MessageChannel();
    backChannel.pipe(backChannelMC.port1, true);

    // Prepare the encoding backchannel (encode echo-cancelled data)
    let ecBackChannelMC: MessageChannel | undefined;
    if (audio.useDualEC)
        ecBackChannelMC = new MessageChannel();

    // Create the worker
    const worker = new InputProcessorWorker({
        baseURL: config.urlDirname.toString(),
        inSampleRate: cap.ac.sampleRate,
        renderSampleRate: audio.ac.sampleRate,
        channel: input.channel,
        useEC: audio.useEC,
        useNR,
        useTranscription: config.useTranscription,
        sentRecently,
        vadSensitivity,
        vadNoiseGate,
        ecOutput: audio.useDualEC
    });

    // Accept state updates
    worker.onvadstate = (raw, rtc, merged) => {
        const vadI = vad.vads[idx];
        vadI.rawVadOn = raw;
        if (rtc !== vadI.rtcVadOn) {
            vadI.rtcVadOn = rtc;
            util.dispatchEvent("vad.rtc", {idx});
            util.dispatchEvent("vad.rtc" + idx, {idx});
        }
        if (merged !== vadI.vadOn) {
            if (merged)
                wd.updateWaveRetroactive(vad.vadExtension);
            vadI.vadOn = merged;
            const state = {user: null, idx, status: merged};
            util.dispatchEvent("ui.speech", state);
            util.dispatchEvent("ui.speech" + idx, state);
        }
    };

    // FIXME: This should be done worker-to-worker
    worker.onmax = v => {
        // Waveform data

        // Check studio mode
        const nowStudio = (ui.ui.video.mode === ui.ViewMode.Studio);
        if (studio !== nowStudio) {
            studio = nowStudio;
            studioSwapped();
        }

        // Display
        const vadI = vad.vads[idx];
        wd.push(v, net.transmitting?(vadI.rawVadOn?3:(vadI.vadOn?2:1)):0);
        wd.updateWave(v, sentRecently);

        // This is also an opportunity to update them on changed state
        if (audio.useEC !== lastUseEC || useNR !== lastUseNR ||
            sentRecently !== lastSentRecently ||
            vadSensitivity !== lastVadSensitivity ||
            vadNoiseGate !== lastVadNoiseGate
        ) {
            worker.setOpts({
                useEC: audio.useEC,
                useNR, sentRecently,
                vadSensitivity, vadNoiseGate
            });
            lastUseEC = audio.useEC;
            lastUseNR = useNR;
            lastSentRecently = sentRecently;
            lastVadSensitivity = vadSensitivity;
            lastVadNoiseGate = vadNoiseGate;
        }
    };

    worker.ontranscription = (result, complete) => {
        const text = result.text || result.partial!;

        // Show our own caption
        ui.caption(net.selfId, text, false, complete);

        // Send it to peers
        // FIXME: Irrelevant now?
        //util.dispatchEvent("proc.caption", msg);

        // Send it to the server
        if (complete && result.result && audio.timeOffset &&
            net.mode === prot.mode.rec) {

            // Adjustment from Date.now timestamps to server timestamps
            const offset = performance.now() - Date.now() +
                audio.timeOffset;

            // Set the times
            for (const word of result.result) {
                word.start = Math.round(word.start * 1000 + offset);
                word.end = Math.round(word.end * 1000 + offset);
                if (word.conf === 1)
                    delete word.conf;
            }

            // Make the packet
            const resBuf = util.encodeText(JSON.stringify(result));
            const p = prot.parts.caption.cs;
            const out = new DataView(new ArrayBuffer(p.length + resBuf.length));
            out.setUint32(0, prot.ids.caption, true);
            (new Uint8Array(out.buffer)).set(resBuf, p.data);
            net.dataSock.send(out.buffer);
        }

    };

    cap.capture.pipe(worker.inputPort);
    backChannel.pipe(worker.renderInputPort);

    // The output from this is our RTC audio
    input.userMediaCapture = {
        ac: cap.ac,
        capture: new InProcAudioCapture(
            cap.capture, worker.outputPort
        )
    };
    util.dispatchEvent("usermediartcready", {idx});
    util.dispatchEvent("usermediartcready" + idx, {idx});

    // Restart if we change devices
    // FIXME: This should probably be done elsewhere
    util.events.addEventListener("usermediastopped" + idx, function() {
        backChannel.close();
        cap.capture.close();
        localProcessing(idx);
    }, {once: true});
}
