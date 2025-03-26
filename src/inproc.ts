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
import * as log from "./log";
import * as net from "./net";
import * as capture from "./capture";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as vad from "./vad";
import * as waveform from "./waveform";
import * as workers from "./workers";

import * as rpcReceiver from "@ennuicastr/mprpc/receiver";
import * as rpcTarget from "@ennuicastr/mprpc/target";
import * as rtennui from "rtennui";

// En/disable noise reduction
export let useNR = false;
export function setUseNR(to: boolean): void {
    useNR = to;
    util.dispatchEvent("inproc.useNR");
}

// VAD sensitivity (0 to 3, more is less)
export let vadSensitivity = 0;
export function setVadSensitivity(to: number): void {
    vadSensitivity = to;
    util.dispatchEvent("inproc.vadSensitivity");
}

// VAD noise gate (-100 to 0, dB)
export let vadNoiseGate = -100;
export function setVadNoiseGate(to: number): void {
    vadNoiseGate = to;
    util.dispatchEvent("inproc.vadNoiseGate");
}

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
        super(workers.inprocWorker);

        const opts = <ifInproc.InProcOpts> <any> optsBasic;

        const inputMC = new MessageChannel();
        this.inputPort = inputMC.port1;
        opts.input = inputMC.port2;

        const renderInputMC = new MessageChannel();
        this.renderInputPort = renderInputMC.port1;
        opts.renderInput = renderInputMC.port2;

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
    const input = audio.inputs[idx];
    const cap = await capture.createCapture(audio.ac, {
        input: input.userMedia,
        matchSampleRate: true
    });

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
        inSampleRate: cap.ac.sampleRate,
        renderSampleRate: audio.ac.sampleRate,
        channel: input.channel,
        useEC: audio.useEC,
        useNR,
        useTranscription: config.useTranscription,
        sentRecently: audio.sentRecently,
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

    // Check for all the various mode changes
    util.events.addEventListener("ui.video.mode", () => {
        // Check studio mode
        const nowStudio = (ui.ui.video.mode === ui.ViewMode.Studio);
        if (studio !== nowStudio) {
            studio = nowStudio;
            studioSwapped();
        }
    });

    function stateChanged() {
        worker.setOpts({
            useEC: audio.useEC,
            useNR,
            sentRecently: audio.sentRecently,
            vadSensitivity, vadNoiseGate
        });
    }

    for (const st of [
        "audio.useEC",
        "inproc.useNR",
        "audio.sentRecently",
        "inproc.vadSensitivity",
        "inproc.vadNoiseGate"
    ]) {
        util.events.addEventListener(st, stateChanged);
    }

    // FIXME: This should be done worker-to-worker
    worker.onmax = v => {
        // Waveform data

        // Display
        const vadI = vad.vads[idx];
        wd.push(v, net.transmitting?(vadI.rawVadOn?3:(vadI.vadOn?2:1)):0);
        wd.updateWave(v, audio.sentRecently);
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

    // Connect echo-cancelled data for encoding
    (async () => {
        if (!audio.useDualEC)
            return;

        if (!audio.inputs[idx].userMediaEncoder) {
            await new Promise(res =>
                util.events.addEventListener(
                    "usermediaencoderready" + idx,
                    res, {once: true}
                )
            );
        }

        audio.inputs[idx].userMediaEncoder.encode(
            worker.ecOutputPort!, audio.ecTrack
        ).catch(net.catastrophicErrorFactory());
    })();

    // Restart if we change devices
    // FIXME: This should probably be done elsewhere
    util.events.addEventListener("usermediastopped" + idx, function() {
        backChannel.close();
        cap.capture.close();
        localProcessing(idx);
    }, {once: true});
}
