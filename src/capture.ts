/*
 * Copyright (c) 2020, 2022 Yahweasel
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

// Worker paths to use
const workerVer = "p";
const awpPath = "awp/ennuicastr-awp.js?v=" + workerVer;
export const workerPath = "awp/ennuicastr-worker.js?v=" + workerVer + "." + Math.random() + Math.random() + Math.random();

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
    bufferSize?: number;
    noMultiplex?: boolean;
}

function isChrome() {
    // Edge is Chrome, Opera is Chrome, Brave is Chrome...
    return navigator.userAgent.indexOf("Chrome") >= 0;
}

export function isSafari(): boolean {
    // Chrome pretends to be Safari
    return navigator.userAgent.indexOf("Safari") >= 0 && !isChrome();
}


/* Create a capture node for the given MediaStream on the given AudioContext
 * (or a fresh one if needed), using either an AudioWorkletProcessor or a
 * ScriptProcessor+worker as needed. */
export function createCapture(ac: AudioContext, options: CaptureOptions): Promise<Capture> {
    /*
     * Status of AWP support:
     *
     * Safari: It's... bad. It's just bad. Don't use AWP on Safari.
     *
     * Everywhere else: Good!
     */
    if (typeof AudioWorkletNode !== "undefined" && !isSafari()) {
        return createCaptureAWP(ac, options);

    } else {
        console.log("[INFO] Not using AWP");
        return createCaptureSP(ac, options);

    }
}

// Create a capture node using AudioWorkletProcessors
async function createCaptureAWP(
    ac: AudioContext & {ecAWPP?: Promise<unknown>}, options: CaptureOptions
): Promise<Capture> {
    if (options.ms && !options.noMultiplex) {
        // Share a single processor
        return createCaptureAWPMultiplex(ac, options);
    }

    // Make sure the module is loaded
    if (!ac.ecAWPP)
        ac.ecAWPP = ac.audioWorklet.addModule(awpPath);
    await ac.ecAWPP;

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
    const cmd = Object.assign({
        port: mc.port2,
        sampleRate: ac.sampleRate
    }, options.workerCommand);
    worker.postMessage(cmd, [mc.port2]);

    // Now hook everything up
    let source: AudioNode = null;
    if (options.ms)
        source = ac.createMediaStreamSource(options.ms);
    else if (options.input)
        source = options.input;
    if (source)
        source.connect(awn);
    const msd: MediaStreamAudioDestinationNode =
        ac.createMediaStreamDestination();
    awn.connect(msd);

    // Prepare to terminate
    function disconnect() {
        if (dead)
            return;
        dead = true;

        if (source)
            source.disconnect(awn);
        awn.disconnect(msd);
        worker.terminate();
    }

    // Done!
    return {
        source: source,
        worker: worker,
        node: awn,
        destination: msd.stream,
        disconnect: disconnect
    };
}

// Create a capture node by multiplexing a single AudioWorkletProcessor
async function createCaptureAWPMultiplex(
    ac: AudioContext & {ecMultiplex?: Record<string, Promise<Capture>>},
    options: CaptureOptions
): Promise<Capture> {
    // Create our multiplexer itself
    if (!ac.ecMultiplex)
        ac.ecMultiplex = {};

    if (!ac.ecMultiplex[options.ms.id]) {
        // Make the multiplex worker first
        ac.ecMultiplex[options.ms.id] = createCaptureAWP(ac, {
            workerCommand: {
                c: "multiplex"
            },
            ms: options.ms,
            noMultiplex: true
        });
    }

    const multiplex = await ac.ecMultiplex[options.ms.id];

    // Now create this individual worker and port
    const worker = new Worker(workerPath);
    const mc = new MessageChannel();
    multiplex.worker.postMessage({
        c: "port",
        p: mc.port1
    }, [mc.port1]);
    const cmd = Object.assign({
        port: mc.port2,
        sampleRate: ac.sampleRate
    }, options.workerCommand);
    worker.postMessage(cmd, [mc.port2]);

    // Done!
    return {
        source: multiplex.source,
        worker: worker,
        node: multiplex.node,
        destination: multiplex.destination,
        disconnect: multiplex.disconnect
    };
}

// Create a capture node using ScriptProcessor
function createCaptureSP(ac: AudioContext, options: CaptureOptions): Promise<Capture> {
    if (isSafari() && options.ms)
        return createCaptureSafari(ac, options);

    // Create our nodes
    let dead = false;
    const node = ac.createScriptProcessor(options.bufferSize || 4096);
    const worker = new Worker(workerPath);

    // Need a channel to communicate from the ScriptProcessor to the worker
    const mc = new MessageChannel();
    const workerPort = mc.port1;
    const cmd = Object.assign({
        port: mc.port2,
        sampleRate: ac.sampleRate
    }, options.workerCommand);
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
    const msd: MediaStreamAudioDestinationNode = 
        ac.createMediaStreamDestination();
    node.connect(msd);

    // Prepare to terminate
    function disconnect() {
        if (dead)
            return;
        dead = true;

        source.disconnect(node);
        node.disconnect(msd);
        worker.terminate();
    }

    // Done!
    return Promise.resolve({
        source: source,
        worker: worker,
        node: node,
        destination: msd.stream,
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
    const cmd = Object.assign({
        port: mc.port2,
        sampleRate: ac.sampleRate
    }, options.workerCommand);
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
        destination: sp.ecDestination.stream,
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
