/*
 * Copyright (c) 2020-2022 Yahweasel
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
 * Video recording.
 */

// extern
declare let LibAV: any, MediaRecorder: any;

import * as audio from "./audio";
import * as avloader from "./avloader";
import * as config from "./config";
import * as downloadStream from "./download-stream";
import * as fileStorage from "./file-storage";
import * as jitsi from "./jitsi";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as video from "./video";

import * as wsp from "web-streams-polyfill/ponyfill";

export const supported = (typeof MediaRecorder !== "undefined");

// Function to stop the current video recording, or null if there is none
let recordVideoStop: () => Promise<void> = null;

// Function to call to verify remote willingness to accept video data
export let recordVideoRemoteOK: (x: number) => void = null;
let recordVideoRemoteOKTimeout: null|number = null;

interface RecordVideoOptions {
    local?: boolean;
    remote?: boolean;
    remotePeer?: number;
    bitrate?: number; // in Mbit
    localWriter?: WritableStreamDefaultWriter;
}

const fixedTimeBase = {
    num: 1,
    den: 1000
};

// Record video
async function recordVideo(opts: RecordVideoOptions): Promise<unknown> {
    recordVideoUI(true);

    // Which format?
    const formats: [string, string, boolean][] = [
        /* Only supported by Chrome, and its framerate there is dodgy
        ["x-matroska", "avc1", true],
        */
        ["webm", "vp9", false],
        ["webm", "vp8", false],
        ["mp4", "avc1", true]
    ];
    let format: [string, string, boolean];
    let mimeType: string;
    let fi: number;
    for (fi = 0; fi < formats.length; fi++) {
        format = formats[fi];
        mimeType = "video/" + format[0] + "; codecs=" + format[1];
        if (MediaRecorder.isTypeSupported(mimeType))
            break;
    }
    if (fi === formats.length) {
        log.pushStatus("mediaRecorder", "No supported video encoder found!");
        setTimeout(function() {
            log.popStatus("mediaRecorder");
        }, 10000);
        return;
    }
    const outFormat = (format[0] === "webm") ? "webm" : "mkv";

    // Choose a name
    let filename = "";
    if (net.recName)
        filename = net.recName + "-";
    filename += config.username + "-video." + outFormat;

    // We decide the bitrate based on the height
    const videoSettings = video.userMediaVideo.getVideoTracks()[0].getSettings();
    let bitrate: number;
    if (opts.bitrate)
        bitrate = Math.min(opts.bitrate * 1000000, videoSettings.height * 100000);
    else
        bitrate = videoSettings.height * 10000;
    const globalFrameTime = 1/videoSettings.frameRate * 1000;

    // Input and output files within libav
    const inExt = (format[0] === "x-matroska") ? "mkv" : format[0];
    const inF = "in." + inExt;
    const outF = "out." + outFormat;

    // Check if remote recording is OK
    if (opts.remote) {
        if (typeof opts.remotePeer !== "number") {
            // Verify first!
            jitsi.videoRecSend(jitsi.videoRecHost, prot.videoRec.startVideoRecReq, {ext: outFormat});

            await new Promise<void>(res => {
                recordVideoRemoteOK = (peer: number) => {
                    if (recordVideoRemoteOKTimeout) {
                        clearTimeout(recordVideoRemoteOKTimeout);
                        recordVideoRemoteOKTimeout = null;
                        opts.remotePeer = peer;
                        res();
                    }
                };

                recordVideoRemoteOKTimeout = setTimeout(() => {
                    res();
                }, 5000);
            });

            recordVideoRemoteOK = null;
            if (recordVideoRemoteOKTimeout) {
                clearTimeout(recordVideoRemoteOKTimeout);
                recordVideoRemoteOKTimeout = null;
            }
        }

        if (typeof opts.remotePeer !== "number") {
            // No remote recording without a remote host
            opts.remote = false;
        }
    }

    if (!opts.remote && !opts.local)
        opts.local = true;

    // Get a libav
    await avloader.loadLibAV();
    const libav = await LibAV.LibAV();
    await libav.mkreaderdev(inF);

    // Get libav's output
    const libavBuf: Uint8Array[] = [];
    let libavPos = 0;
    let libavNotify: () => void = null;
    libav.onwrite = function(name: string, pos: number, chunk: Uint8Array) {
        if (chunk) {
            if (libavPos !== pos)
                return;
            libavPos = pos + chunk.length;
        }
        libavBuf.push((new Uint8Array(chunk.buffer)).slice(0));
        if (libavNotify)
            libavNotify();
    };

    // Make it a stream
    const libavStream = new wsp.ReadableStream<Uint8Array>({
        async pull(controller) {
            if (!libavBuf.length) {
                await new Promise<void>(res => libavNotify = res);
                libavNotify = null;
            }

            const chunk = libavBuf.shift();
            if (chunk)
                controller.enqueue(chunk);
            else
                controller.close();
        }
    });

    // Our output context/info
    let out_oc = -1;

    // With MP4, we need a full file to get the format options
    if (format[2]) {
        // Currently received data
        let data: Uint8Array;

        // MediaRecorder stream
        const mrs = getMediaRecorderStream(video.userMediaVideo, {
            mimeType: mimeType,
            videoBitsPerSecond: bitrate
        });
        const rdr = mrs.stream.getReader();

        // Get some data
        {
            const blob = await rdr.read();
            const ab = await blobToArrayBuffer(blob.value);
            data = new Uint8Array(ab);
        }

        // Stop the media recorder
        try {
            mrs.mediaRecorder.stop();
        } catch (ex) {}

        // And flush the remaining data
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const blob = await rdr.read();
            if (blob.done)
                break;
            const u8 = new Uint8Array(await blobToArrayBuffer(blob.value));
            const newData = new Uint8Array(data.length + u8.length);
            newData.set(data);
            newData.set(u8, data.length);
            data = newData;
        }

        // Now transfer it to libav
        const tmpFile = inF + ".tmp." + inExt;
        await libav.writeFile(tmpFile, data);
        const [in_fmt_ctx, [in_stream]] =
            await libav.ff_init_demuxer_file(tmpFile);
        await libav.avformat_find_stream_info(in_fmt_ctx);
        const c = await libav.avcodec_alloc_context3(0);
        await libav.avcodec_parameters_to_context(c, in_stream.codecpar);

        // Use the context to make our output
        [out_oc] =
            await libav.ff_init_muxer({filename: outF, open: true, device: true},
                [[c, fixedTimeBase.num, fixedTimeBase.den]]);

        // Write out the header
        await libav.avformat_write_header(out_oc, 0);

        // And clean up the temporary file info
        await libav.avcodec_free_context_js(c);
        await libav.avformat_close_input_js(in_fmt_ctx);
        await libav.unlink(tmpFile);
    } // Pre-allocate output file

    // Get our MediaRecorder stream
    const mrs = getMediaRecorderStream(video.userMediaVideo, {
        mimeType: mimeType,
        videoBitsPerSecond: bitrate
    });
    const inputRdr = mrs.stream.getReader();

    // Do the rest in the background
    const recordPromise = (async function() {
        // Transit the data from the input to the device in the background
        (async function() {
            while (true) {
                // Send the data to the dev
                const rdres = await inputRdr.read();
                const chunk = rdres.done ? null :
                    new Uint8Array(await blobToArrayBuffer(rdres.value));
                await libav.ff_reader_dev_send(inF, chunk);
                if (rdres.done)
                    break;
            }
        })();

        // Transit it through libav in the background
        (async function() {
            // Open the file
            const [in_fmt_ctx, [in_stream]] =
                await libav.ff_init_demuxer_file(inF);
            const c = await libav.avcodec_alloc_context3(0);
            const pkt = await libav.av_packet_alloc();
            await libav.avcodec_parameters_to_context(c, in_stream.codecpar);

            function timeFrom(fromhi: number, from: number) {
                from += fromhi * 0x100000000;
                return from * in_stream.time_base_num / in_stream.time_base_den * 1000;
            }

            function timeTo(from: number) {
                const to = from * fixedTimeBase.den / fixedTimeBase.num / 1000;
                return {
                    hi: ~~(to / 0x100000000),
                    lo: ~~(to % 0x100000000)
                };
            }

            // DTS of the last packet we received
            let lastDTS = 0;

            // The offset from the DTS of the recording to the DTS of reality
            let dtsOffset = null;

            // We keep some starter packets to make sure we get a keyframe
            let starterPackets: any[] = [];

            // eslint-disable-next-line no-constant-condition
            while (true) {
                /* Read it back. Generally read only a single frame, for
                 * timing. */
                const [res, allPackets] =
                    await libav.ff_read_multi(in_fmt_ctx, pkt, inF, {devLimit: 1, limit: 1});
                const endTimeReal = performance.now();
                if (res !== 0 && res !== -libav.EAGAIN && res !== libav.AVERROR_EOF) {
                    // Weird error!
                    throw new Error(res + "");
                }

                let packets = allPackets[in_stream.index];
                if (!packets || !packets.length) {
                    if (res === libav.AVERROR_EOF)
                        break;
                    else
                        continue;
                }

                if (out_oc < 0) {
                    // Good opportunity to make our output
                    [out_oc] =
                        await libav.ff_init_muxer({filename: outF, open: true, device: true},
                            [[c, fixedTimeBase.num, fixedTimeBase.den]]);

                    // Write out the header
                    await libav.avformat_write_header(out_oc, 0);
                }

                // Update the timing
                if (net.remoteBeginTime && audio.timeOffset) {
                    // The last packet tells us roughly when we are
                    const lastPacket = packets[packets.length-1];

                    // The end time as set by the packet
                    let inEndTime = timeFrom(lastPacket.dtshi, lastPacket.dts);
                    if (inEndTime < 0)
                        inEndTime = timeFrom(lastPacket.ptshi, lastPacket.pts);

                    // The end time as seen by "reality"
                    const outEndTime = endTimeReal // The real time when we received this packet
                        - video.videoLatency // Adjusted for input latency
                        + audio.timeOffset // Convert to remote time
                        - net.remoteBeginTime; // Base at recording start time

                    // Use that to adjust the offset
                    if (dtsOffset === null) {
                        dtsOffset = outEndTime - inEndTime;
                    } else {
                        let portion = Math.min(globalFrameTime / 2000, 1);
                        dtsOffset = (outEndTime - inEndTime) * portion +
                            dtsOffset * (1-portion);
                    }

                    // Then retime the packets based on the offset
                    for (const packet of packets) {
                        let pdts: any = timeFrom(packet.dtshi, packet.dts);
                        let ppts: any = timeFrom(packet.ptshi, packet.pts);
                        if (pdts < 0) pdts = ppts;
                        ppts -= pdts;
                        pdts += dtsOffset;
                        if (pdts < lastDTS)
                            pdts = lastDTS;
                        ppts += pdts;
                        if (ppts < 0) ppts = 0;
                        pdts = timeTo(pdts);
                        ppts = timeTo(ppts);
                        packet.dtshi = pdts.hi;
                        packet.dts = pdts.lo;
                        packet.ptshi = ppts.hi;
                        packet.pts = ppts.lo;
                        lastDTS = pdts;
                    }

                    // If we haven't sent the starter packets, do so
                    if (starterPackets) {
                        if (starterPackets.length) {
                            // Use them to make sure we have an I-frame
                            packets = starterPackets.concat(packets);
                        } else {
                            // We definitely have an I-frame, but fix timing
                            const packet = packets[0];
                            packet.dtshi = packet.dts = packet.ptshi = packet.pts = 0;
                        }
                        starterPackets = null;
                    }

                    // Write these out
                    await libav.ff_write_multi(out_oc, pkt, packets);

                } else {
                    /* No starting time yet, so just collect packets, making
                     * sure we keep a keyframe */
                    for (const packet of packets) {
                        packet.dtshi = packet.dts = packet.ptshi = packet.pts = 0;
                        if (packet.flags & 1 /* KEY */)
                            starterPackets = [packet];
                        else
                            starterPackets.push(packet);
                    }

                }

                if (res === libav.AVERROR_EOF)
                    break;
            }

            // Close the file
            if (out_oc >= 0)
                await libav.av_write_trailer(out_oc);
            libavBuf.push(null);
            if (libavNotify)
                libavNotify();
            if (libav.worker)
                libav.terminate();
        })();

        // Now libavStream is ready. Tee it.
        let localStream: ReadableStream<Uint8Array> = null;
        let remoteStream: ReadableStream<Uint8Array> = null;
        let promises: Promise<unknown>[];
        if (opts.local && opts.remote) {
            [localStream, remoteStream] = <any[]> libavStream.tee();
            promises = [doLocal(), doRemote()];
        } else if (opts.remote) {
            remoteStream = <any> libavStream;
            promises = [doRemote()];
        } else {
            localStream = <any> libavStream;
            promises = [doLocal()];
        }

        // Do the local writing
        async function doLocal() {
            await saveVideo(filename, localStream, mimeType);
        }

        // Do the remote writing
        async function doRemote() {
            const rdr = remoteStream.getReader();
            let idx = 0;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const chunk = await rdr.read();
                if (chunk.done) {
                    recordVideoRemoteClose(opts.remotePeer);
                    break;
                } else {
                    recordVideoRemoteWrite(opts.remotePeer, idx, chunk.value);
                    idx += chunk.value.length;
                }
            }
        }

        await promises;
    })();

    // Make it possible to stop
    recordVideoStop = async function() {
        try {
            mrs.mediaRecorder.stop();
        } catch (ex) {}
        await recordPromise;
    };

    recordVideoUI();
}

// Get a MediaRecorder 
function getMediaRecorderStream(ms: MediaStream, opts: any) {
    const mediaRecorder = new MediaRecorder(ms, opts);

    // Buffer of received packets
    const buf: Blob[] = [];
    let notify: () => void = null;

    // Set up the media recorder itself
    mediaRecorder.addEventListener("dataavailable", (ev: any) => {
        buf.push(ev.data);
        if (notify)
            notify();
    });

    mediaRecorder.addEventListener("stop", () => {
        buf.push(null);
        if (notify)
            notify();
    });

    // And the stream
    const stream = new wsp.ReadableStream({
        async pull(controller) {
            if (!buf.length) {
                await new Promise<void>(res => notify = res);
                notify = null;
            }

            const chunk = buf.shift();
            if (chunk)
                controller.enqueue(chunk);
            else
                controller.close();
        }
    });

    mediaRecorder.start(200);

    return {mediaRecorder, stream};
}

// Receive a remote video recording
export function recordVideoRemoteIncoming(
    peer: number, stream: ReadableStream<Uint8Array>, opts?: {ext?: string}
): void {
    // Handle remote options
    let ext = "webm";
    let mimeType = "video/webm";
    if (opts.ext === "mkv") {
        ext = "mkv";
        mimeType = "video/x-matroska";
    }

    // Choose a name
    let filename = "";
    if (net.recName)
        filename = net.recName + "-";
    const remoteUser = ui.ui.panels.userList.users[peer];
    const remoteName = remoteUser ? remoteUser.name.innerText : "";
    if (remoteName)
        filename += remoteName + "-";
    filename += "video." + ext;

    // And save it in the background
    saveVideo(filename, stream, mimeType);
}

// Function to report video storage
let lastStorageCt = -1;
function storageReport(ct: number, used: number, max: number) {
    const s = (ct === 1) ? "" : "s";
    const msg = `Saving ${ct} video stream${s}`;
    ui.ui.panels.master.videoStatus.innerHTML = msg + ". Storage used: " + Math.round(used/max*100) + "%";
    if (ct !== lastStorageCt) {
        lastStorageCt = ct;
        if (ct)
            log.pushStatus("videoStorage", msg);
        else
            log.popStatus("videoStorage");
    }
}

// Save a video download, either as a stream or into local storage, or both
async function saveVideo(
    filename: string, stream: ReadableStream<Uint8Array>, mimeType: string
) {
    let doDownloadStream = true, doLocalStorage = false;
    let dStream: ReadableStream<Uint8Array> = null, lsStream: ReadableStream<Uint8Array> = null;

    // Should we be doing local storage?
    if (("master" in config.config) && ui.ui.panels.master.saveVideoInBrowser.checked) {
        doLocalStorage = true;
        if (!ui.ui.panels.master.downloadVideoLive.checked)
            doDownloadStream = false;
    }

    // Possibly split it
    if (doDownloadStream) {
        if (doLocalStorage)
            [dStream, lsStream] = stream.tee();
        else
            dStream = stream;
    } else {
        lsStream = stream;
    }

    // Do them
    let promises: Promise<unknown>[] = [];
    if (dStream) {
        promises.push(downloadStream.stream(filename, dStream,
            {"content-type": mimeType}));
    }
    if (lsStream) {
        promises.push(fileStorage.storeFile(filename,
            [config.config.id, config.config.key, config.config.master],
            lsStream, {mimeType, report: storageReport}));
    }

    await Promise.all(promises);
}

// Convert from a Blob to an ArrayBuffer
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    if (blob.arrayBuffer) {
        return blob.arrayBuffer();

    } else {
        // Use FileReader
        return new Promise(res => {
            const fr = new FileReader();
            fr.onloadend = function() {
                res(<ArrayBuffer> fr.result);
            };
            fr.readAsArrayBuffer(blob);
        });

    }
}

// Write data to an RTC peer
function recordVideoRemoteWrite(peer: number, idx: number, buf: Uint8Array) {
    jitsi.videoDataSend(peer, idx, buf);
}

// Stop sending video data to a peer
function recordVideoRemoteClose(peer: number) {
    jitsi.videoRecSend(peer, prot.videoRec.endVideoRec);
}

// Configure the video recording UI based on the current state
export function recordVideoUI(loading?: boolean): void {
    const recording = ui.ui.panels.videoConfig.recording;
    recording.record.disabled = !!loading;
    recording.optHider.style.display = (loading || !recording.record.checked) ? "none" : "";
    recording.bitrateHider.style.display = recording.manualBitrate.checked ? "" : "none";
}

// Set to true if we're in the middle of reconsidering recording
let reconsidering = false;

// Called whenever we should reconsider whether/how we're recording
async function maybeRecord() {
    const recording = ui.ui.panels.videoConfig.recording;

    if (reconsidering) {
        // Already being done
        return;
    }

    reconsidering = true;

    if (recordVideoStop)
        await recordVideoStop();

    if (supported && video.userMediaVideo && recording.record.checked) {
        // We should be recording
        const opts: RecordVideoOptions = {
            remote: !("master" in config.config) && recording.remote.checked && config.useRTC,
            local: ("master" in config.config) || recording.local.checked || !config.useRTC
        };
        if (recording.manualBitrate.checked) {
            const br = +recording.bitrate.value;
            if (br)
                opts.bitrate = br;
        }
        await recordVideo(opts);

    } else if (!supported && video.userMediaVideo && recording.record.checked && config.useVideoRec) {
        // Warn that they're not "contributing"
        log.pushStatus("video-rec-unsupported", "WARNING: Your browser does not support video recording!");
        setTimeout(() => { log.popStatus("video-rec-unsupported"); }, 10000);

    }

    reconsidering = false;

}

// Load the video recording UI
export function loadVideoRecordPanel(): void {
    const recording = ui.ui.panels.videoConfig.recording;

    // Is it even supported?
    recording.hider.style.display = supported ? "" : "none";

    // Do or do not record
    recording.record.checked = config.useVideoRec;
    ui.saveConfigCheckbox(recording.record, "record-video-" + config.useVideoRec, function() {
        recordVideoUI();
        maybeRecord();
    });

    // Host/local options
    ui.saveConfigCheckbox(recording.remote, "record-video-remote-" + config.useVideoRec, function(ev) {
        if (!recording.remote.checked && !recording.local.checked) {
            // Invalid
            recording.local.checked = true;
            recording.local.onchange(ev);
            return;
        }
        maybeRecord();
    });
    ui.saveConfigCheckbox(recording.local, "record-video-local-" + config.useVideoRec, function(ev) {
        if (!recording.remote.checked && !recording.local.checked) {
            // Invalid
            recording.remote.checked = true;
            recording.remote.onchange(ev);
            return;
        }
        maybeRecord();
    });
    if (!recording.remote.checked && !recording.local.checked) {
        if (config.useVideoRec)
            recording.remote.checked = true;
        else
            recording.local.checked = true;
    }

    // Set manual bitrate?
    ui.saveConfigCheckbox(recording.manualBitrate, "record-video-bitrate-sel", function() {
        recordVideoUI();
        if (recording.bitrate.value !== "")
            maybeRecord();
    });

    // Manual bitrate value
    ui.saveConfigValue(recording.bitrate, "record-video-bitrate", maybeRecord);

    recordVideoUI();
}

// Make sure the recording updates when the video state updates
util.events.addEventListener("usermediavideoready", maybeRecord);
util.events.addEventListener("usermediavideostopped", maybeRecord);
