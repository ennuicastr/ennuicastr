/*
 * Copyright (c) 2020-2024 Yahweasel
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
declare let LibAV: any, MediaRecorder: any, VideoEncoder : any,
    VideoFrame: any, MediaStreamTrackProcessor : any;

import * as audio from "./audio";
import * as avloader from "./avloader";
import * as comm from "./comm";
import * as config from "./config";
import * as fileStorage from "./file-storage";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as video from "./video";

import * as downloadStream from "@ennuicastr/dl-stream";
import * as lwc from "../node_modules/libavjs-webcodecs-bridge/libavjs-webcodecs-bridge.js";
import * as wsp from "web-streams-polyfill/ponyfill";

export const supported = (typeof MediaRecorder !== "undefined");

// Function to stop the current video recording, or null if there is none
let recordVideoStop: () => Promise<void> = null;

// Function to call to verify remote willingness to accept video data
export let recordVideoRemoteOK: (x: number) => void = null;
let recordVideoRemoteOKTimeout: null|number = null;

interface VideoRecordingFormat {
    useVideoEncoder: boolean,
    mimeType: string,
    outMimeType?: string,
    codec?: string,
    requiresRecapture?: boolean
};

interface RecordVideoOptions {
    local?: boolean;
    remote?: boolean;
    remotePeer?: number;
    bitrate?: number; // in Mbit
    localWriter?: WritableStreamDefaultWriter;
}

/* Since this whole thing is a series of connected streams, a general-purpose
 * bufferable stream */
class BufferStream<T> extends wsp.ReadableStream<T> {
    private _buf: (T | null)[] = [];
    private _res: () => unknown = null;

    constructor() {
        super({
            pull: async (controller) => {
                while (!this._buf.length) {
                    await new Promise<void>(res => this._res = res);
                    this._res = null;
                }

                const next = this._buf.shift();
                if (next === null)
                    controller.close();
                else
                    controller.enqueue(next);
            }
        });
    }

    /**
     * Push an element into the queue, and wake any reader waiting for it.
     */
    push(el: T | null) {
        this._buf.push(el);
        if (this._res)
            this._res();
    }
}

const fixedTimeBase = {
    num: 1,
    den: 1000
};

// Options for the *current* video recording
let curVideoRecOpts: RecordVideoOptions = null;

// Record video
async function recordVideo(opts: RecordVideoOptions): Promise<unknown> {
    recordVideoUI(true);
    curVideoRecOpts = opts;
    const videoSettings = video.userMediaVideo.getVideoTracks()[0].getSettings();

    // Which format?
    const formats: VideoRecordingFormat[] = [
        {
            useVideoEncoder: true, mimeType: "x-matroska; codecs=avc1",
            codec: "avc1.42403e"
        },
        {
            useVideoEncoder: true, mimeType: "webm; codecs=vp9",
            codec: "vp09.00.10.08.03.1.1.1.0"
        },
        {
            useVideoEncoder: false, mimeType: "webm; codecs=vp9"
        },
        {
            useVideoEncoder: true, mimeType: "webm; codecs=vp8",
            codec: "vp8"
        },
        {
            useVideoEncoder: false, mimeType: "webm; codecs=vp8"
        },
        {
            useVideoEncoder: false, mimeType: "mp4; codecs=avc1",
            outMimeType: "x-matroska; codecs=avc1",
            requiresRecapture: true
        }
    ];
    let format: VideoRecordingFormat;
    let mimeType: string;
    let veConfig: any;
    let fi: number;
    for (fi = 0; fi < formats.length; fi++) {
        format = formats[fi];
        try {
            mimeType = `video/${format.mimeType}`;
            if (format.useVideoEncoder) {
                if (typeof MediaStreamTrackProcessor === "undefined")
                    continue;
                veConfig = {
                    codec: format.codec,
                    width: videoSettings.width,
                    height: videoSettings.height,
                    framerate: Math.round(videoSettings.frameRate),
                    latencyMode: "realtime"
                };
                const support = await VideoEncoder.isConfigSupported(veConfig);
                if (support.supported)
                    break;
            } else {
                if (MediaRecorder.isTypeSupported(mimeType))
                    break;
            }
        } catch (ex) {}
    }
    if (fi === formats.length) {
        log.pushStatus("mediaRecorder", "No supported video encoder found!", {
            timeout: 10000
        });
        return;
    }
    const outMimeType = format.outMimeType || format.mimeType;
    let outFormat = outMimeType.replace(/;.*/, "");
    if (outFormat === "x-matroska")
        outFormat = "mkv";

    // Choose a name
    let filename = "";
    if (net.recName)
        filename = net.recName + "-";
    filename += config.username + "-video." + outFormat;

    // We decide the bitrate based on the height
    let bitrate: number;
    if (opts.bitrate)
        bitrate = Math.min(opts.bitrate * 1000000, videoSettings.height * 100000);
    else
        bitrate = videoSettings.height * 10000;
    if (bitrate < 128000) {
        if (opts.bitrate)
            bitrate = opts.bitrate * 1000000;
        else
            bitrate = 10000000;
    }
    const globalFrameTime = 1/videoSettings.frameRate * 1000;

    // Input and output files within libav
    let inExt = format.mimeType.replace(/;.*/, "");
    if (inExt === "x-matroska")
        inExt = "mkv";
    const inF = "in." + inExt;
    const outF = "out." + outFormat;

    // Check if remote recording is OK
    if (opts.remote) {
        if (typeof opts.remotePeer !== "number") {
            // Verify first!
            comm.comms.videoRec.videoRecSend(
                comm.comms.videoRec.getVideoRecHost(),
                prot.videoRec.startVideoRecReq, {ext: outFormat});

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

    // Get a libav
    await avloader.loadLibAV();
    const libav = await LibAV.LibAV();

    // Our output codec parameters
    let codecpar = -1;
    let inNum = -1, inDen = -1;

    // Our output context/info
    let out_oc = -1, out_pb = -1;

    /*
     * Here's how this works:
     * MediaRecorder or MediaStreamTrackProcessor
     * ->
     * libav demuxing (MediaRecorder only)
     * encoding and packetizing (MediaStreamTrackProcessor only)
     * ->
     * timestamping
     * muxing
     * -> (through libav)
     * transmission
     */
    let mr: any = null, mstp: any = null;
    let mrStream: ReadableStream<Blob> = null,
        mstpStream: ReadableStream<any> = null;
    let mrReader: ReadableStreamDefaultReader<Blob> = null,
        mstpReader: ReadableStreamDefaultReader<any> = null,
        mstpCancel: (a0: {done: boolean, value: any}) => unknown = null;
    let videoEnc: any = null;
    let blankCodecPar: number = -1;
    let blankPackets: any[] | null = null;
    let packetStream: BufferStream<any> = null;
    let packetReader: ReadableStreamDefaultReader<any> = null;
    let muxStream: BufferStream<Uint8Array> = null;
    let muxReader: ReadableStreamDefaultReader<Uint8Array> = null;
    let codecparRes: () => unknown = null;
    let recordPromise: Promise<unknown> = null;

    /* We actually do the last step first to make sure that the muxed,
     * transmittable stream is a stream when we need it */

    // 4. Transmission (libav output)
    {
        let libavPos = 0;
        muxStream = new BufferStream<Uint8Array>();
        libav.onwrite = (name: string, pos: number, chunk: Uint8Array) => {
            if (chunk) {
                if (libavPos !== pos)
                    return; // No out-of-order writes
                libavPos = pos + chunk.length;
                muxStream.push(new Uint8Array(chunk.slice(0).buffer));
            } else {
                muxStream.push(null);
            }
        };
    }

    // 1. MediaRecorder or MediaStreamTrackProcessor
    {
        /* With MP4, we need a full file to get the format options, so we do a
         * short record before we start the real recording. */
        if (format.requiresRecapture) {
            // Currently received data
            let data: Uint8Array;

            // MediaRecorder stream
            const mrs = getMediaRecorderStream(video.userMediaVideo, {
                mimeType: mimeType,
                videoBitsPerSecond: bitrate
            });
            const rdr = mrs.mrStream.getReader();

            // Get some data
            {
                const blob = await rdr.read();
                const ab = await blobToArrayBuffer(blob.value);
                data = new Uint8Array(ab);
            }

            // Stop the media recorder
            try {
                mrs.mr.stop();
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
            codecpar = in_stream.codecpar;
            inNum = in_stream.time_base_num;
            inDen = in_stream.time_base_den;
            if (codecparRes)
                codecparRes();

            // Use the context to make our output
            [out_oc, , out_pb] =
                await libav.ff_init_muxer({
                    filename: outF, open: true, device: true, codecpars: true
                },
                [[in_stream.codecpar, fixedTimeBase.num, fixedTimeBase.den]]);

            // Write out the header
            await libav.avformat_write_header(out_oc, 0);

            // And clean up the temporary file info
            await libav.avformat_close_input_js(in_fmt_ctx);
            await libav.unlink(tmpFile);
        } // Pre-allocate output file

        if (format.useVideoEncoder) {
            mstp = new MediaStreamTrackProcessor({
                track: video.userMediaVideo.getVideoTracks()[0]
            });
            mstpStream = mstp.readable;
            mstpReader = mstpStream.getReader();

        } else {
            // Get our MediaRecorder stream
            ({mr, mrStream} = getMediaRecorderStream(video.userMediaVideo, {
                mimeType: mimeType,
                videoBitsPerSecond: bitrate
            }));
            mrReader = mrStream.getReader();

        }
    }

    // 2. Packetizing
    packetStream = new BufferStream<any>();
    packetReader = packetStream.getReader();

    if (format.useVideoEncoder) {
        // Prepare the output stream
        [codecpar] = await lwc.configToVideoStream(libav, veConfig);
        [blankCodecPar] = await lwc.configToVideoStream(libav, veConfig);
        inNum = fixedTimeBase.num;
        inDen = fixedTimeBase.den;
        if (codecparRes)
            codecparRes();

        // Encode blank frames
        {
            let blankDesc: Uint8Array | null = null;
            const blankEnc = new VideoEncoder({
                output: async (chunk, metadata) => {
                    blankPackets = blankPackets || [];
                    const packet = lwc.encodedVideoChunkToPacket(
                        chunk,
                        [blankCodecPar, fixedTimeBase.num, fixedTimeBase.den],
                        1);
                    blankPackets.push(packet);
                    if (
                        !blankDesc &&
                        metadata && metadata.decoderConfig &&
                        metadata.decoderConfig.description
                    ) {
                        const desc = metadata.decoderConfig.description;
                        if (desc.buffer)
                            blankDesc = desc.slice(0);
                        else
                            blankDesc = (new Uint8Array(desc)).slice(0);
                    }
                },
                error: () => {}
            });
            await blankEnc.configure(veConfig);
            const blankData =
                new Uint8Array(4 * veConfig.width * veConfig.height);
            const blank1 = new VideoFrame(blankData, {
                format: "RGBX",
                codedWidth: veConfig.width,
                codedHeight: veConfig.height,
                timestamp: 0
            });
            const blank2 = new VideoFrame(blankData, {
                format: "RGBX",
                codedWidth: veConfig.width,
                codedHeight: veConfig.height,
                timestamp: 100000
            });
            blankEnc.encode(blank1);
            blankEnc.encode(blank2);
            try {
                await blankEnc.flush();
                blankEnc.close();
            } catch (ex) {}
            if (blankPackets && blankDesc) {
                const ed = await libav.malloc(blankDesc.length);
                await libav.copyin_u8(ed, blankDesc);
                await libav.AVCodecParameters_extradata_s(
                    blankCodecPar, ed);
                await libav.AVCodecParameters_extradata_size_s(
                    blankCodecPar, blankDesc.length);
            }
        }

        // Prepare the video encoder
        videoEnc = new VideoEncoder({
            output: (chunk, metadata) => {
                const packet = lwc.encodedVideoChunkToPacket(
                    chunk,
                    [codecpar, fixedTimeBase.num, fixedTimeBase.den],
                    0);
                if (metadata && metadata.decoderConfig &&
                    metadata.decoderConfig.description) {
                    let description: any =
                        metadata.decoderConfig.description;
                    if (description.buffer) {
                        description = description.slice(0);
                    } else {
                        description = (new Uint8Array(description)).slice(0);
                    }
                    packetStream.push({description});
                }
                packetStream.push([packet]);
            },
            error: ex => {
                console.error(ex);
                packetStream.push(null);
            }
        });
        veConfig.bitrate = bitrate;
        videoEnc.configure(veConfig);

        // A way of cancelling the transit
        const mstpCancelPromise = new Promise<{
            done: boolean, value: any
        }>(res => mstpCancel = res);

        // Transit our input to the video encoder
        (async function() {
            while (true) {
                const {done, value} = await Promise.race([
                    mstpReader.read(),
                    mstpCancelPromise
                ]);
                const now = performance.now();
                if (done)
                    break;
                if (!net.remoteBeginTime || !audio.timeOffset) {
                    // Not yet ready for frames
                    value.close();
                    continue;
                }

                const timestamp = now // The real time when we received this frame
                    - video.videoLatency // Adjusted for input latency
                    + audio.timeOffset // Convert to remote time
                    - net.remoteBeginTime; // Base at recording start time

                // Need to make a new frame to set the timestamp
                const frame = new VideoFrame(value, {
                    timestamp: Math.round(timestamp * 1000)
                });
                value.close();
                videoEnc.encode(frame);
                frame.close();
            }

            await videoEnc.flush();
            videoEnc.close();
            packetStream.push(null);
        })();

    } else {
        await libav.mkreaderdev(inF);
        const pkt = await libav.av_packet_alloc();

        // Sending data to the device is streaming, but within libav
        (async function() {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                // Send the data to the dev
                const {done, value} = await mrReader.read();
                const chunk = done ? null :
                    new Uint8Array(await blobToArrayBuffer(value));
                await libav.ff_reader_dev_send(inF, chunk);
                if (done)
                    break;
            }
        })();

        // Then read the packets
        (async function() {
            // Open the file
            const [in_fmt_ctx, [in_stream]] =
                await libav.ff_init_demuxer_file(inF);
            if (codecpar < 0) {
                codecpar = in_stream.codecpar;
                inNum = in_stream.time_base_num;
                inDen = in_stream.time_base_den;
                if (codecparRes)
                    codecparRes();
            }

            while (true) {
                // Try to read a single packet
                const [res, allPackets] =
                    await libav.ff_read_multi(
                        in_fmt_ctx, pkt, inF, {devLimit: 1, limit: 1});
                if (res !== 0 && res !== -libav.EAGAIN &&
                    res !== libav.AVERROR_EOF) {
                    // Weird error!
                    break;
                }
                if (allPackets && allPackets[0] && allPackets[0].length)
                    packetStream.push(allPackets[0]);
                if (res === libav.AVERROR_EOF)
                    break;
            }

            packetStream.push(null);
        })();

    }

    // 3. Timestamping and muxing
    recordPromise = (async function() {
        // Transit it through libav in the background
        const pkt = await libav.av_packet_alloc();

        if (codecpar < 0)
            await new Promise<void>(res => codecparRes = res);

        function timeFrom(fromhi: number, from: number) {
            from += fromhi * 0x100000000;
            return from * inNum / inDen * 1000;
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
            const {done, value} = await packetReader.read();
            if (done)
                break;

            if (!value.length && value.description) {
                // This is codec extradata
                const oldExtradata =
                    await libav.AVCodecParameters_extradata(codecpar);
                if (!oldExtradata) {
                    const extradata =
                        await libav.malloc(value.description.length);
                    await libav.copyin_u8(extradata, value.description);
                    await libav.AVCodecParameters_extradata_s(
                        codecpar, extradata);
                    await libav.AVCodecParameters_extradata_size_s(
                        codecpar, value.description.length);
                }
                continue;
            }

            const endTimeReal = performance.now();
            let packets = value;

            if (out_oc < 0) {
                // Good opportunity to make our output
                const streams = [[codecpar, fixedTimeBase.num, fixedTimeBase.den]];
                if (blankPackets) {
                    streams.push(
                        [blankCodecPar, fixedTimeBase.num, fixedTimeBase.den]
                    );
                } else if (blankCodecPar >= 0) {
                    libav.avcodec_parameters_free_js(blankCodecPar);
                }
                [out_oc, , out_pb] =
                    await libav.ff_init_muxer({
                        filename: outF, open: true, device: true, codecpars: true
                    },
                    streams);

                // Write out the header
                await libav.avformat_write_header(out_oc, 0);

                // Write out any blank packets
                if (blankPackets) {
                    await libav.ff_write_multi(
                        out_oc, pkt, blankPackets, false
                    );
                }
            }

            // Update the timing
            if (net.remoteBeginTime && audio.timeOffset) {
                // With VideoEncoder, our timing is already correct
                if (!format.useVideoEncoder) {
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
                        const portion = Math.min(globalFrameTime / 2000, 1);
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
                await libav.ff_write_multi(out_oc, pkt, packets, false);

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
        }

        // Close the file
        if (out_oc >= 0) {
            await libav.av_write_trailer(out_oc);
            await libav.ff_free_muxer(out_oc, out_pb);
        }
        muxStream.push(null);
    })();

    // Save the muxStream
    const promises = saveVideoData(
        filename, net.selfId, outMimeType, muxStream, {
            local: opts.local,
            remote: opts.remote,
            remotePeer: opts.remotePeer
        }
    );

    // When it's done, it's done
    Promise.all(promises).catch(ex => {
        log.pushStatus(
            "videoRecError",
            `ERROR DURING VIDEO RECORDING: ${ex}`,
            {timeout: 10000}
        );
    }).then(() => {
        libav.terminate();
        curVideoRecOpts = null;
    });

    // Make it possible to stop
    recordVideoStop = async () => {
        if (mr) {
            try {
                mr.stop();
            } catch (ex) {
                mrReader.cancel();
            }
        }
        if (mstp) {
            mstpReader.cancel();
            mstpCancel({done: true, value: void 0});
        }
        await recordPromise;
    };

    recordVideoUI();
}

// Get a MediaRecorder as a bufferable stream
function getMediaRecorderStream(ms: MediaStream, opts: any) {
    const mr = new MediaRecorder(ms, opts);
    const mrStream = new BufferStream<Blob>();

    // Timeout to make sure we receive data
    let timeout: number|null = null;

    mr.addEventListener("dataavailable", (ev: any) => {
        if (timeout !== null) {
            clearTimeout(timeout);
            timeout = setTimeout(timeoutFunc, 5000);
        }
        mrStream.push(ev.data);
    });

    mr.addEventListener("stop", () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
        mrStream.push(null);
    });

    mr.start(200);

    // Make sure it actually gets data soon
    function timeoutFunc() {
        timeout = null;

        log.pushStatus("video-rec-failed", "Failed to record video!", {
            timeout: 5000
        });

        mr.stop();

        mrStream.push(null);

        video.shareVideo("-none", 0);
    }

    timeout = setTimeout(timeoutFunc, 5000);

    return {mr, mrStream};
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
    Promise.all(saveVideoData(filename, peer, mimeType, stream, {
        local: ("master" in config.config) && ui.ui.panels.host.downloadVideoLive.checked
    })).catch(ex => {
        log.pushStatus(
            "videoRecError",
            `ERROR WHILE RECEIVING VIDEO RECORDING: ${ex}`,
            {timeout: 10000}
        );
    });
}

// Function to report video storage
let lastStorageMsg = "";
function storageReport(ct: number, used: number, max: number, cached: number) {
    const s = (ct === 1) ? "" : "s";
    let usedGB = Math.round(used / 1073741824);
    let maxGB = Math.round(max / 1073741824);
    let cachedMB = Math.round(cached / 1048576);
    let msg = `Saving ${ct} video stream${s}. Storage used: ` +
        `${Math.round(used/max*100)}% (${usedGB}/${maxGB}GB).`;
    if (cached)
        msg += ` ${cachedMB}MB to upload.`;
    if (ct === 0)
        msg = "";
    if (msg !== lastStorageMsg) {
        if (lastStorageMsg && !msg)
            window.removeEventListener("beforeunload", beforeUnloadHandler);
        else if (!lastStorageMsg && msg)
            window.addEventListener("beforeunload", beforeUnloadHandler);

        if (msg)
            log.pushStatus("videoStorage", util.escape(msg));
        else
            log.popStatus("videoStorage");

        lastStorageMsg = msg;
    }
}

// Don't quit while we're saving recording data
function beforeUnloadHandler(ev: BeforeUnloadEvent) {
    ev.preventDefault();
    const msg = "Please do not close this window while video streaming is in progress.";
    log.pushStatus(
        "videoStorage-beforeunload", msg,
        {timeout: 8000}
    );
    return msg;
}

// Save a video download into each supported storage location
function saveVideoData(
    filename: string,
    track: number,
    mimeType: string,
    stream: ReadableStream<Uint8Array>,
    opts: RecordVideoOptions
) {
    // The actual ID doesn't matter, it just has to be shared among backends
    const id = Math.random().toString() + Math.random() + Math.random();

    let promises: Promise<unknown>[] = [];
    let outputStream: ReadableStream<Uint8Array> | null = stream;
    let cloud = false, fsdh = false;

    if (("master" in config.config) && ui.ui.panels.host.saveVideoInCloud.checked) {
        const [s1, s2] = <[any, any]> outputStream.tee();
        outputStream = s2;
        promises.push(doCloudStorage(s1));
        cloud = true;
    }

    if (("master" in config.config) && ui.ui.panels.host.saveVideoInFSDH.checked) {
        const [s1, s2] = <[any, any]> outputStream.tee();
        outputStream = s2;
        promises.push(doFSDHStorage(s1));
        fsdh = true;
    }

    if (opts.remote) {
        const [s1, s2] = <[any, any]> outputStream.tee();
        outputStream = s2;
        promises.push(doRemote(s1));
    }

    if (opts.local || promises.length === 0) {
        const [s1, s2] = <[any, any]> outputStream.tee();
        outputStream = s2;
        promises.push(doLocal(s1));
    }

    if (!fsdh) {
        promises.push(doBrowserStorage(outputStream));
    } else {
        (async () => {
            const rdr = outputStream.getReader();
            while (true) {
                const value = await rdr.read();
                if (value.done) break;
            }
        })();
    }

    // Do the browser storage writing
    async function doBrowserStorage(stream: ReadableStream<Uint8Array>) {
        await saveVideoBrowser(id, filename, track, stream, mimeType, !cloud && !fsdh);
    }

    // Do the cloud storage writing
    async function doCloudStorage(stream: ReadableStream<Uint8Array>) {
        await saveVideoCloud(id, filename, track, stream, mimeType);
    }

    // Do the FSDH storage writing
    async function doFSDHStorage(stream: ReadableStream<Uint8Array>) {
        await saveVideoFSDH(id, filename, track, stream, mimeType, !cloud);
    }

    // Do the local writing
    async function doLocal(stream: ReadableStream<Uint8Array>) {
        await saveVideoFile(filename, stream, mimeType);
    }

    // Do the remote writing
    async function doRemote(stream: ReadableStream<Uint8Array>) {
        const rdr = stream.getReader();
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

    return promises;
}

// Save a video download into local storage
async function saveVideoBrowser(
    id: string, filename: string, track: number,
    stream: ReadableStream<Uint8Array>,
    mimeType: string, doReport: boolean
) {
    return (await fileStorage.getLocalFileStorage()).storeFile(
        id,
        filename,
        track,
        [config.config.id, config.config.key, config.config.master],
        stream,
        {mimeType, report: doReport ? storageReport : void 0}
    );
}

// Save a video download into cloud storage
async function saveVideoCloud(
    id: string, filename: string, track: number,
    stream: ReadableStream<Uint8Array>,
    mimeType: string
) {
    // FIXME: Should be using getRemoteFileStorage
    return (await fileStorage.remoteFileStoragePromise).storeFile(
        id,
        filename,
        track,
        [config.config.id, config.config.key, config.config.master],
        stream,
        {mimeType, report: storageReport}
    );
}

// Save a video download into cloud storage
async function saveVideoFSDH(
    id: string, filename: string, track: number,
    stream: ReadableStream<Uint8Array>,
    mimeType: string, doReport: boolean
) {
    // FIXME: Should be using getFSDHFileStorage
    return (await fileStorage.fsdhFileStoragePromise).storeFile(
        id,
        filename,
        track,
        [config.config.id, config.config.key, config.config.master],
        stream,
        {mimeType, report: doReport ? storageReport : void 0}
    );
}

// Save a video as a download
async function saveVideoFile(
    filename: string, stream: ReadableStream<Uint8Array>, mimeType: string
) {
    await downloadStream.stream(filename, stream, {
        "content-type": mimeType
    });
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
    comm.comms.videoRec.videoDataSend(peer, idx, buf);
}

// Stop sending video data to a peer
function recordVideoRemoteClose(peer: number) {
    comm.comms.videoRec.videoRecSend(peer, prot.videoRec.endVideoRec);
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

    if (supported && video.userMediaVideo && recording.record.checked &&
        net.mode >= prot.mode.rec && net.mode < prot.mode.finished) {
        // We should be recording
        const opts: RecordVideoOptions = {
            remote: !("master" in config.config) && recording.remote.checked && config.useRTC,
            local: (
                (
                    // We asked to record locally
                    recording.local.checked
                ) || (
                    /* We're the host, we asked to send *to* the host, and we
                     * record incoming recordings from guests */
                    ("master" in config.config) &&
                    recording.remote.checked &&
                    ui.ui.panels.host.downloadVideoLive.checked
                )
            )
        };
        if (recording.manualBitrate.checked) {
            const br = +recording.bitrate.value;
            if (br)
                opts.bitrate = br;
        }
        await recordVideo(opts);

    } else if (!supported && video.userMediaVideo && recording.record.checked && config.useVideoRec) {
        // Warn that they're not "contributing"
        log.pushStatus(
            "video-rec-unsupported",
            "WARNING: Your browser does not support video recording!", {
            timeout: 10000
        });

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

/**
 * Call to indicate that the video recording host has changed. FIXME: Should
 * be an event.
 */
export function onVideoRecHostChange() {
    const recording = ui.ui.panels.videoConfig.recording;

    /* Restart if either we're currently recording remote, or we would like to
     * be recording remote but aren't */
    if (curVideoRecOpts && (
        curVideoRecOpts.remote ||
        (!("master" in config.config) &&
         recording.remote.checked &&
         config.useRTC))) {

        maybeRecord();
    }
}

// Make sure the recording updates when the video state or mode updates
util.events.addEventListener("usermediavideoready", maybeRecord);
util.events.addEventListener("usermediavideostopped", maybeRecord);
util.events.addEventListener("net.info." + prot.info.mode, () => {
    if (net.mode >= prot.mode.finished) {
        // "Reconsider" here to make sure we stop when the recording stops
        maybeRecord();
    } else if (net.mode >= prot.mode.rec) {
        // Start recording if we're not already
        if (!curVideoRecOpts)
            maybeRecord();
    }
});
