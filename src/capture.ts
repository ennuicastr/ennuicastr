/*
 * Copyright (c) 2020, 2021 Yahweasel
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

// extern
declare let webkitAudioContext: any;

// Worker paths to use
const workerVer = "g";
const awpPath = "awp/ennuicastr-awp.js?v=" + workerVer;
export const workerPath = "awp/ennuicastr-worker.js?v=" + workerVer;

export interface Capture {
    source: AudioNode,
    worker: Worker,
    node: AudioNode,
    destination: MediaStream,
    disconnect: ()=>unknown
}

export interface CaptureOptions {
    workerCommand: any;
    ms?: MediaStream; // Input as a MediaStream
    input?: AudioNode; // Input as an AudioNode
    sampleRate: string;
    matchSampleRate?: boolean; // Must be false if input is set
    bufferSize?: number;
    outStream?: boolean;
}

/* Create a capture node for the given MediaStream on the given AudioContext
 * (or a fresh one if needed), using either an AudioWorkletProcessor or a
 * ScriptProcessor+worker as needed. */
export function createCapture(ac: AudioContext, options: CaptureOptions): Promise<Capture> {
    function isChrome() {
        // Edge is Chrome, Opera is Chrome, Brave is Chrome...
        return navigator.userAgent.indexOf("Chrome") >= 0;
    }

    function isWindows() {
        return navigator.userAgent.indexOf("Windows") >= 0;
    }

    function isMacOSX() {
        return navigator.userAgent.indexOf("OS X") >= 0;
    }

    /* Here's the status of AWP support:
     * Safari doesn't support it at all.
     * Firefox supports it well everywhere.
     * On Chrome on Linux, it's very dodgy, and ScriptProcessor is quite reliable.
     * On Chrome everywhere else, it's reliable.
     * There are no other browsers */
    if (typeof AudioWorkletNode !== "undefined" &&
        (isWindows() || isMacOSX() || !isChrome())) {
        return createCaptureAWP(ac, options);

    } else {
        console.log("[INFO] Not using AWP");
        return createCaptureSP(ac, options);

    }
}

// Create a capture node using AudioWorkletProcessors
function createCaptureAWP(ac: AudioContext & {ecAWPP?: Promise<unknown>}, options: CaptureOptions): Promise<Capture> {
    // Possibly use a different AudioContext
    if (options.matchSampleRate) {
        const msSampleRate = options.ms.getAudioTracks()[0].getSettings().sampleRate;
        if (msSampleRate !== ac.sampleRate)
            ac = new AudioContext({sampleRate: msSampleRate});
    }

    return Promise.all([]).then(() => {
        // Make sure the module is loaded
        if (!ac.ecAWPP)
            ac.ecAWPP = ac.audioWorklet.addModule(awpPath);
        return ac.ecAWPP;

    }).then(() => {
        let dead = false;

        /* Here's how the whole setup works:
         * input ->
         * AudioWorkletNode in awp.js ->
         * Worker in worker.js ->
         * back to us */
        const awn = new AudioWorkletNode(ac, "worker-processor");
        const worker = new Worker(workerPath);

        // Need a channel for them to communicate
        const mc = new MessageChannel();
        awn.port.postMessage({c: "workerPort", p: mc.port1}, [mc.port1]);
        const cmd = Object.assign({port: mc.port2}, options.workerCommand);
        cmd[options.sampleRate] = ac.sampleRate;
        worker.postMessage(cmd, [mc.port2]);

        // Now hook everything up
        let source: AudioNode = null;
        if (options.ms)
            source = ac.createMediaStreamSource(options.ms);
        else if (options.input)
            source = options.input;
        if (source)
            source.connect(awn);
        let msd: MediaStreamAudioDestinationNode = null;
        if (options.outStream) {
            msd = ac.createMediaStreamDestination();
            awn.connect(msd);
        }

        // Prepare to terminate
        function disconnect() {
            if (dead)
                return;
            dead = true;

            if (source)
                source.disconnect(awn);
            if (msd)
                awn.disconnect(msd);
            worker.terminate();
        }

        // Done!
        return {
            source: source,
            worker: worker,
            node: awn,
            destination: msd ? msd.stream : null,
            disconnect: disconnect
        };

    });

}

// Create a capture node using ScriptProcessor
function createCaptureSP(ac: AudioContext, options: CaptureOptions): Promise<Capture> {
    if (typeof webkitAudioContext !== "undefined" && options.ms)
        return createCaptureSafari(ac, options);

    // Possibly use a different AudioContext
    if (options.matchSampleRate) {
        const msSampleRate = options.ms.getAudioTracks()[0].getSettings().sampleRate;
        if (msSampleRate !== ac.sampleRate)
            ac = new AudioContext({sampleRate: msSampleRate});
    }

    // Create our nodes
    let dead = false;
    const node = ac.createScriptProcessor(options.bufferSize || 4096);
    const worker = new Worker(workerPath);

    // Need a channel to communicate from the ScriptProcessor to the worker
    const mc = new MessageChannel();
    const workerPort = mc.port1;
    const cmd = Object.assign({port: mc.port2}, options.workerCommand);
    cmd[options.sampleRate] = ac.sampleRate;
    worker.postMessage(cmd, [mc.port2]);

    // Create the ScriptProcessor's behavior
    node.onaudioprocess = createOnAudioProcess(workerPort);

    // Now hook everything up
    let source: AudioNode = null;
    if (options.ms)
        source = ac.createMediaStreamSource(options.ms);
    else if (options.input)
        source = options.input;
    if (source)
        source.connect(node);
    let msd: MediaStreamAudioDestinationNode = null;
    if (options.outStream) {
        msd = ac.createMediaStreamDestination();
        node.connect(msd);
    }

    // Prepare to terminate
    function disconnect() {
        if (dead)
            return;
        dead = true;

        source.disconnect(node);
        if (msd)
            node.disconnect(msd);
        worker.terminate();
    }

    // Done!
    return Promise.resolve({
        source: source,
        worker: worker,
        node: node,
        destination: msd ? msd.stream : null,
        disconnect: disconnect
    });
}

/* Safari-specific capture node, because it doesnt support having more than one
 * ScriptProcessor on one audio device */
function createCaptureSafari(ac: AudioContext & {ecSP?: any}, options: CaptureOptions): Promise<Capture> {
    /* Safari has major problems if you have more than one ScriptProcessor, so
     * we only allow one per MediaStream, and overload it. */
    if (!ac.ecSP)
        ac.ecSP = {};

    // First, create a single ScriptProcessor for everybody
    let sp: ScriptProcessorNode & {
        ecUsers: any[],
        ecCt: number,
        ecSource: AudioNode,
        ecDestination: MediaStreamAudioDestinationNode,
        ecDisconnect: ()=>unknown
    } = ac.ecSP[options.ms.id];
    if (!sp) {
        // Choose the older name if necessary
        let name = "createScriptProcessor";
        if (!(<any> ac)[name])
            name = "createJavaScriptNode";

        // Create our script processor with a compromise buffer size
        sp = ac.ecSP[options.ms.id] = (<any> ac)[name](4096, 1, 1);

        // Keep track of who's using it
        sp.ecUsers = [];
        sp.ecCt = 0;

        // And call all the users when we get data
        sp.onaudioprocess = function(ev: AudioProcessingEvent) {
            sp.ecUsers.forEach(function(user: any) {
                user.onaudioprocess(ev);
            });
        }

        // Connect it
        const mss = ac.createMediaStreamSource(options.ms);
        mss.connect(sp);
        sp.ecSource = mss;
        const msd = ac.createMediaStreamDestination();
        sp.connect(msd);
        sp.ecDestination = msd;

        // Prepare to disconnect it
        sp.ecDisconnect = function() {
            mss.disconnect(sp);
            sp.disconnect(msd);
            delete ac.ecSP[options.ms.id];
        };
    }

    // Now, add this user
    let dead = false;
    const node = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
        onaudioprocess: function(ev: AudioProcessingEvent) {}
    };
    sp.ecUsers.push(node);
    sp.ecCt++;
    const worker = new Worker(workerPath);

    // Need a channel to communicate from the ScriptProcessor to the worker
    const mc = new MessageChannel();
    const workerPort = mc.port1;
    const cmd = Object.assign({port: mc.port2}, options.workerCommand);
    cmd[options.sampleRate] = ac.sampleRate;
    worker.postMessage(cmd, [mc.port2]);

    // Create the ScriptProcessor's behavior
    node.onaudioprocess = createOnAudioProcess(workerPort);

    // Prepare to terminate
    function disconnect() {
        if (dead)
            return;
        dead = true;

        // Remove this node from the users list
        for (let i = 0; i < sp.ecUsers.length; i++) {
            if (sp.ecUsers[i] === node) {
                sp.ecUsers.splice(i, 1);
                sp.ecCt--;
                break;
            }
        }

        // Possibly break the chain
        if (sp.ecCt === 0)
            sp.ecDisconnect();

        worker.terminate();
    }

    // Done!
    return Promise.resolve({
        source: sp.ecSource,
        worker: worker,
        node: null,
        destination: options.outStream ? sp.ecDestination.stream : null,
        disconnect: disconnect
    });
}

// Create the onaudioprocess function necessary for any ScriptProcessor
function createOnAudioProcess(workerPort: MessagePort) {
    const buffer: Float32Array[][] = [];
    let lenPerBuf = 0;

    // Get audio data from the worker
    workerPort.onmessage = function(ev) {
        const buf = ev.data.d;
        const len = buf[0].length;
        if (len > lenPerBuf)
            lenPerBuf = len;
        buffer.push(buf);
    };

    // And send/receive data from the ScriptProcessor
    return function(ev: AudioProcessingEvent) {
        // Get it into the right format
        const input: Float32Array[] = [];
        const cc = ev.inputBuffer.numberOfChannels;
        for (let i = 0; i < cc; i++)
            input.push(ev.inputBuffer.getChannelData(i));

        // Send inputs to the worker
        workerPort.postMessage(Date.now());
        workerPort.postMessage(input);

        // Drain any excess buffer
        while (buffer.length >= 3 &&
            (buffer.length * lenPerBuf >= 4800))
            buffer.shift();

        // And send buffered output out
        const out: Float32Array[] = [];
        for (let i = 0; i < cc; i++)
            out.push(ev.outputBuffer.getChannelData(i));
        const len = out[0].length;
        let i = 0;
        while (i < len && buffer.length) {
            const remain = len - i;
            const first = buffer[0];

            if (first[0].length > remain) {
                // First has enough to fill out the remainder
                for (let c = 0; c < out.length; c++)
                    out[c].set(first[c%first.length].subarray(0, remain), i);
                for (let c = 0; c < first.length; c++)
                    first[c] = first[c].subarray(remain);
                i += remain;

            } else {
                // Use all of the data from first
                for (let c = 0; c < out.length; c++)
                    out[c].set(first[c%first.length], i);
                i += first[0].length;
                buffer.shift();

            }
        }
    };
}
