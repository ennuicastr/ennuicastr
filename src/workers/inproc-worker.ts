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

import * as ifInproc from "../iface/inproc";
import * as ifLibav from "../iface/libav";
import * as inh from "./in-handler";
import * as outh from "./out-handler";

import * as rpcReceiver from "@ennuicastr/mprpc/receiver-worker";
import * as rpcTarget from "@ennuicastr/mprpc/target";

import type * as LibSpecBleachT from "@ennuicastr/libspecbleach.js";
import type * as WebRtcAec3T from "@ennuicastr/webrtcaec3.js";

declare let __filename: string;
declare let WebRtcVad: any;
declare let WebRtcAec3: typeof WebRtcAec3T;
declare let LibSpecBleach: typeof LibSpecBleachT;
declare let Vosk: any;

const webRtcAec3Version = "0.3.0";
const webRtcAec3Path = `../libs/webrtcaec3-${webRtcAec3Version}.js`;

const webRtcVadPath = "../libs/webrtcvad.js";

const libspecbleachVersion = "0.1.7-js2";
const libspecbleachPath = `../libs/libspecbleach-${libspecbleachVersion}.js`;

const voskPath = "../libs/vosk.js?v=3";
const voskModelVersion = "en-us-0.15";
const voskModelPath = `../libs/vosk-model-small-${voskModelVersion}.tar.gz`;

const vadBufSz = 640 /* 20ms at 32000Hz */;

// Number of milliseconds to run the VAD for before/after talking
const vadExtension = 2000;

// Similar, for RTC transmission
const rtcVadExtension = 1000;

class InputProcessor
    implements
        rpcReceiver.RPCReceiver<ifInproc.InputProcessor>,
        rpcTarget.Async<ifInproc.InputProcessorRev>
{
    init(opts: ifInproc.InProcOpts): void {
        this._reverse = new rpcTarget.RPCTarget(opts.reverse);

        this._ready = false;
        this._baseURL = opts.baseURL;
        this._inSampleRate = opts.inSampleRate;
        this._renderSampleRate = opts.renderSampleRate;
        this._vadStep = opts.inSampleRate / 32000;
        this.setOpts(opts);

        this._outHandler = new outh.OutHandler(opts.output, true);
        if (opts.ecOutput)
            this._ecOutHandler = new outh.OutHandler(opts.ecOutput, true);
        this._inHandler = new inh.InHandler(opts.input, this.ondata.bind(this));
        this._renderHandler = new inh.InHandler(
            opts.renderInput, this.onRenderData.bind(this));

        // Load all our libraries
        this._ser = this._ser.catch(console.error).then(async () => {
            // Load the VAD
            __filename = `${opts.baseURL}/${webRtcVadPath}`;
            importScripts(__filename);
            const vad = this._vad = await WebRtcVad();

            // Create our WebRTC vad
            const mkVad = lvl => {
                const vadHandle: number = vad.Create();
                if (vadHandle === 0) {
                    // FIXME
                    //postMessage({c: "log", i: "failvad", m: "Failed to create VAD."});
                    throw new Error();
                }
                if (vad.Init(vadHandle) < 0) {
                    // FIXME
                    //postMessage({c: "log", i: "failvad", m: "Failed to initialize VAD."});
                    throw new Error();
                }
                vad.set_mode(vadHandle, lvl);
                return vadHandle;
            };
            this._vadHandleLo = mkVad(this._vadSensitivity);
            this._lastVadSensitivity = this._vadSensitivity;
            this._vadHandleHi = mkVad(3);

            this._vadDataPtr = vad.malloc(vadBufSz * 2);
            this._vadBuf = new Int16Array(vad.HEAPU8.buffer, this._vadDataPtr, vadBufSz * 2);

            // Load echo cancellation
            __filename = `${opts.baseURL}/${webRtcAec3Path}`;
            importScripts(__filename);
            this._AEC3 = await WebRtcAec3();

            // And load libspecbleach
            __filename = `${opts.baseURL}/${libspecbleachPath}`;
            importScripts(__filename);
            this._SpecBleach = await LibSpecBleach.LibSpecBleach();

            // Possibly load Vosk
            if (opts.useTranscription) {
                __filename = `${opts.baseURL}/${voskPath}`;
                importScripts(__filename);
            }

            // If we loaded Vosk, it can finish loading in the background
            if (opts.useTranscription)
                this.loadVosk();

            this._ready = true;
        });

    }

    setOpts(opts: Partial<ifInproc.InProcOptsBasic>): void {
        if (typeof opts.useEC !== "undefined")
            this._useEC = opts.useEC;
        if (typeof opts.useNR !== "undefined")
            this._useNR = opts.useNR;
        if (typeof opts.sentRecently !== "undefined")
            this._sentRecently = opts.sentRecently;
        if (typeof opts.useTranscription !== "undefined")
            this._useTranscription = opts.useTranscription;
        if (typeof opts.channel !== "undefined")
            this._channel = opts.channel;
        if (typeof opts.vadSensitivity !== "undefined")
            this._vadSensitivity = opts.vadSensitivity;
        if (typeof opts.vadNoiseGate !== "undefined") {
            this._vadNoiseGate = opts.vadNoiseGate;
            this._vadNoiseGateLvl = Math.pow(10, opts.vadNoiseGate / 20);
        }
    }

    ondata(ts: number, data: Float32Array[]): void {
        if (!this._ready) return;

        this._ser = this._ser.catch(console.error).then(async () => {
            // Merge together the channels
            let ib: Float32Array;
            if (this._channel >= 0 && data.length > this._channel) {
                // Just one channel
                ib = data[this._channel];

            } else {
                // Possibly multiple channels
                ib = data[0];
                const cc = data.length;
                if (cc !== 1) {
                    // Mix it
                    for (let i = 1; i < cc; i++) {
                        const ibc = data[i];
                        for (let j = 0; j < ib.length; j++)
                            ib[j] += ibc[j];
                    }

                    // Then temper it
                    for (let i = 0; i < ib.length; i++)
                        ib[i] /= cc;
                }

            }


            // Perform echo cancellation
            let ecbuf = ib;
            if (this._AEC3 && !this._aec3) {
                this._aec3 = new this._AEC3.AEC3(48000, 1, 1);
                this._aec3Opts = {
                    sampleRateIn: this._inSampleRate,
                    sampleRateOut: this._inSampleRate
                };
                this._aec3AnalyzeOpts = {
                    sampleRateIn: this._renderSampleRate
                };
            }
            if (this._aec3) {
                const aec3In = [ib];
                const sz = this._aec3.processSize(aec3In, this._aec3Opts);
                if (sz && (!this._aec3Output || this._aec3Output.length !== sz))
                    this._aec3Output = new Float32Array(sz);
                this._aec3.process([this._aec3Output], aec3In, this._aec3Opts);
                if (sz)
                    ecbuf = this._aec3Output;
                else
                    ecbuf = new Float32Array(0);
            }

            // Output the echo cancel on its own port
            if (this._ecOutHandler)
                this._ecOutHandler.send([ecbuf]);

            let nrin = ecbuf;
            if (!this._useEC && this._useNR) {
                /* If we're actually using the noise-reduced output but not using
                 * the echo-cancelled output, we can't use the echo cancellation as
                 * input, or we'd need to noise-reduce in a separate step. */
                nrin = ib;
            }

            // Choose an appropriate buffer size for noise reduction
            if (!this._specBleachBufSize ||
                nrin.length % this._specBleachBufSize !== 0) {
                if (this._aec3 && nrin === ecbuf) {
                    this._specBleachBufSize = ~~(this._inSampleRate / 100);
                    if (nrin.length &&
                        nrin.length % this._specBleachBufSize !== 0)
                        this._specBleachBufSize = nrin.length;
                } else {
                    this._specBleachBufSize = nrin.length;
                }
            }

            // Perform noise reduction
            let nrbuf = nrin;
            if (this._SpecBleach &&
                (!this._specBleach ||
                 this._specBleach.input_buffer.length !== this._specBleachBufSize)) {
                // NR instance is out of date or nonexistent, make a new one
                if (this._specBleach)
                    this._specBleach.free();
                this._specBleach = new this._SpecBleach.SpecBleach({
                    adaptive: true,
                    block_size: this._specBleachBufSize,
                    sample_rate: this._inSampleRate,
                    reduction_amount: 20,
                    whitening_factor: 50
                });
            }
            if (this._specBleach) {
                if (!this._nroutput || this._nroutput.length < nrin.length)
                    this._nroutput = new Float32Array(nrin.length);
                for (let i = 0; i < nrin.length; i += this._specBleachBufSize) {
                    this._specBleach.process(
                        nrin.subarray(i, i + this._specBleachBufSize),
                        this._nroutput.subarray(i, i + this._specBleachBufSize)
                    );
                }
                nrbuf = this._nroutput.subarray(0, nrin.length);
            }

            // Transfer data for the VAD
            let vadLvl = this._rawVadLvl;
            let vadSet = this._rawVadOn;
            for (let i = 0; i < nrbuf.length; i += this._vadStep) {
                const v = nrbuf[~~i];
                const a = Math.abs(v);
                this._curVadVolume += a;
                if (a > this._curVadPeak)
                    this._curVadPeak = a;

                this._vadBuf[this._bi++] = v * 0x7FFF;

                if (this._bi == vadBufSz) {
                    // Make sure our VAD sensitivity is right
                    if (this._lastVadSensitivity !== this._vadSensitivity) {
                        this._vad.set_mode(this._vadHandleLo, this._vadSensitivity);
                        this._lastVadSensitivity = this._vadSensitivity;
                    }

                    // We have a complete packet
                    this._rawVadLvl = vadLvl =
                        this._vad.Process(this._vadHandleLo, 32000, this._vadDataPtr, vadBufSz) +
                        this._vad.Process(this._vadHandleHi, 32000, this._vadDataPtr, vadBufSz);
                    vadSet = !!vadLvl;
                    this._bi = 0;

                    if (vadLvl === 2) {
                        // Adjust the trigger value quickly up or slowly down
                        const triggerTarget = this._curVadVolume/vadBufSz;
                        if (triggerTarget > this._triggerVadCeil) {
                            this._triggerVadCeil = triggerTarget;
                        } else {
                            this._triggerVadCeil = (
                                this._triggerVadCeil * 1023 +
                                triggerTarget
                            ) / 1024;
                        }
                    } else if (vadLvl === 0) {
                        // Adjust the floor
                        const triggerTarget = this._curVadVolume/vadBufSz*2;
                        this._triggerVadFloor = (
                            this._triggerVadFloor * 511 +
                            triggerTarget
                        ) / 512;
                    }
                    this._lastVolume = this._curVadVolume;
                    this._curVadVolume = 0;
                    this._lastPeak = this._curVadPeak;
                    this._curVadPeak = 0;
                }
            }

            // Gate the VAD by volume if it's not confident
            if (vadSet && (vadLvl < 2 || this._vadSensitivity >= 3)) {
                const relVolume = this._lastVolume/vadBufSz;
                vadSet = false;
                // We must be over the floor...
                if (relVolume >= this._triggerVadFloor) {
                    // And at least 1/32nd way to the ceiling
                    if (this._triggerVadCeil < this._triggerVadFloor*2 ||
                        relVolume - this._triggerVadFloor >= (this._triggerVadCeil - this._triggerVadFloor) / 32) {
                        vadSet = true;
                    }
                }
            }

            // Apply the noise get if applicable
            if (vadSet && this._vadNoiseGate > -100) {
                if (this._lastPeak < this._vadNoiseGateLvl)
                    vadSet = false;
            }

            // Possibly swap the VAD mode
            if (vadSet) {
                // Switch on the transmission VAD
                if (!this._rtcVadOn) {
                    this._rtcVadOn = true;
                } else if (this._rtcTimeout) {
                    clearTimeout(this._rtcTimeout);
                    this._rtcTimeout = null;
                }

                // And the recording VAD
                if (this._timeout) {
                    clearTimeout(this._timeout);
                    this._timeout = null;
                }
                if (!this._rawVadOn) {
                    // We flipped on
                    this._rawVadOn = true;
                    this._vadOn = true;
                    this._curVadVolume = 0;
                }

            } else {
                if (this._rtcVadOn) {
                    // Flip off after a second
                    if (!this._rtcTimeout) {
                        this._rtcTimeout = setTimeout(() => {
                            this._rtcTimeout = null;
                            this._rtcVadOn = false;
                        }, rtcVadExtension);
                    }
                }

                if (this._rawVadOn) {
                    // Flip off after a while
                    this._rawVadOn = false;
                    if (!this._timeout) {
                        this._timeout = setTimeout(() => {
                            this._timeout = null;
                            this._vadOn = false;
                        }, vadExtension);
                    }
                }
            }


            // Find the max for this input
            for (let i = 0; i < ib.length; i++) {
                let v = ib[i];
                if (v < 0) v = -v;
                if (v > this._max) this._max = v;
                if (++this._maxCtr >= 1024) {
                    // Send a max count
                    this.max(this._max);
                    this._max = this._maxCtr = 0;
                }
            }

            // And send everything to the host
            this.vadState(this._rawVadOn, this._rtcVadOn, this._vadOn);

            {
                let ob = ib;
                if (this._useNR)
                    ob = nrbuf;
                else if (this._useEC)
                    ob = ecbuf;
                if (ob.length) {
                    const od = [];
                    if (!this._sentRecently) {
                        ob = ob.slice(0);
                        ob.fill(0);
                    }
                    while (od.length < data.length)
                        od.push(ob.slice(0));
                    this._outHandler!.send(od);
                }
            }

            // Perform transcription
            if (this._useTranscription && this._vosk.recognizer) {
                this._vosk.inSamples += ib.length;
                this._vosk.inTime = this._vosk.inSamples / this._inSampleRate;
                this._vosk.outTime = ts / 1000;
                this._vosk.recognizer.acceptWaveformFloat(ib, this._inSampleRate);
            }
        });
    }

    onRenderData(ts: number, data: Float32Array[]): void {
        if (this._aec3)
            this._aec3.analyze(data, this._aec3AnalyzeOpts);
    }

    async vadState(raw: boolean, rtc: boolean, merged: boolean): Promise<void> {
        this._reverse!.rpcv("vadState", [raw, rtc, merged]);
    }

    async max(v: number): Promise<void> {
        this._reverse!.rpcv("max", [v]);
    }

    async transcription(
        result: ifInproc.TranscriptionResult, complete: boolean
    ): Promise<void> {
        this._reverse!.rpcv("transcription", [result, complete]);
    }

    // Load the Vosk model in the background
    async loadVosk() {
        const vosk = this._vosk;
        const model = await Vosk.createModel(`${this._baseURL}/${voskModelPath}`);

        vosk.model = model;
        vosk.recognizer = new vosk.model.KaldiRecognizer(this._inSampleRate);
        vosk.recognizer.setWords(true);

        vosk.recognizer.on("partialresult", msg => {
            this.voskResult(msg, false);
        });
        vosk.recognizer.on("result", msg => {
            this.voskResult(msg, true);
        });
    }

    // Handle a vosk result
    voskResult(msg: any, complete: boolean) {
        // Ignore empty results
        const result: ifInproc.TranscriptionResult = msg.result;
        if (complete && result.text === "")
            return;
        if (!complete && result.partial === "")
            return;

        if (result.result) {
            const vosk = this._vosk;
            const offset = vosk.outTime - vosk.inTime;
            for (const word of result.result) {
                word.start += offset;
                word.end += offset;
            }
        }

        // Send it to the host
        this.transcription(result, complete);
    }

    private _ser: Promise<unknown> = Promise.all([]);
    private _reverse?: rpcTarget.RPCTarget;

    private _ready = false;
    private _baseURL = "";
    private _inSampleRate = 48000;
    private _renderSampleRate = 48000;
    private _vadStep = 0;
    private _useEC = true;
    private _useNR = true;
    private _sentRecently = false;
    private _useTranscription = false;
    private _channel = -1;
    private _lastVadSensitivity = 0;
    private _vadSensitivity = 0;
    private _vadNoiseGate = 0;
    private _vadNoiseGateLvl = 0;

    /* WebRTC VAD is pretty finicky, so also keep track of volume as a
     * secondary gate */
    private _triggerVadCeil = 0;
    private _triggerVadFloor = 0;
    private _curVadVolume = 0;
    private _curVadPeak = 0;
    private _lastVolume = 0;
    private _lastPeak = 0;

    // State for transfer to the host
    private _rawVadLvl = 0;
    private _rawVadOn = false;
    private _rtcVadOn = false;
    private _vadOn = false;
    private _max = 0;
    private _maxCtr = 0;

    // Libraries
    private _vad: any = null;
    private _vadHandleLo = 0;
    private _vadHandleHi = 0;
    private _vadDataPtr = 0;
    private _vadBuf?: Int16Array;
    private _bi = 0;
    private _AEC3?: WebRtcAec3T.WebRtcAec3;
    private _aec3?: WebRtcAec3T.AEC3;
    private _aec3Opts?: WebRtcAec3T.AEC3ProcessOpts;
    private _aec3AnalyzeOpts?: WebRtcAec3T.AEC3AnalyzeOpts;
    private _aec3Output?: Float32Array;
    private _SpecBleach?: LibSpecBleachT.LibSpecBleach;
    private _specBleach?: LibSpecBleachT.LibSpecBleachOO;
    private _specBleachBufSize = 0;
    private _nroutput?: Float32Array;
    private _timeout: null|number = null;
    private _rtcTimeout: null|number = null;
    private _vosk = {
        model: <any> null,
        recognizer: <any> null,
        inSamples: 0,
        inTime: 0,
        outTime: 0
    };

    private _inHandler?: inh.InHandler;
    private _renderHandler?: inh.InHandler;
    private _outHandler?: outh.OutHandler;
    private _ecOutHandler?: outh.OutHandler;
}

rpcReceiver.rpcWorkerMain(new InputProcessor());
