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
declare let LibAV: any, MediaRecorder: any, streamSaver: any;

import * as audio from "./audio";
import * as avloader from "./avloader";
import * as config from "./config";
import * as jitsi from "./jitsi";
import * as log from "./log";
import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import * as video from "./video";

export const supported = (typeof MediaRecorder !== "undefined");

// Function to stop the current video recording, or null if there is none
let recordVideoStop: ()=>Promise<unknown> = null;

// Function to call to verify remote willingness to accept video data
export let recordVideoRemoteOK: any = null;
let recordVideoRemoteOKTimeout: null|number = null;

/* Any ongoing video recording steps *other* than actually recording pile
 * together into this Promise */
let recordPromise: Promise<unknown> = Promise.all([]);

interface RecordVideoOptions {
    local?: boolean;
    remote?: boolean;
    remotePeer?: number;
    bitrate?: number; // in Mbit
    localWriter?: WritableStreamDefaultWriter;
}

interface TranscodeState {
    libav?: any;
    format?: string;
    mimeType?: string;
    fullReadCodecPar?: boolean;
    bitrate?: number;
    inF?: string;
    outF?: string;
    startPromise?: Promise<unknown>;
    written?: number;
    in_fmt_ctx?: number;
    in_streams?: any[];
    in_stream_idx?: number;
    in_stream?: any;
    pkt?: number;
    out_oc?: number;
    out_fmt?: number;
    out_pb?: number;
    out_st?: number;
    read?: (arg0:unknown)=>void;
    write?: (arg0:Blob)=>void;
}

const fixedTimeBase = {
    num: 1,
    den: 1000
};

// Record video
function recordVideo(opts: RecordVideoOptions): Promise<unknown> {
    recordVideoUI(true);

    // Which format?
    const formats: [string, string, boolean][] = [
        ["x-matroska", "avc1", true],
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

    let localWriter: WritableStreamDefaultWriter = null,
        remoteWriter: {idx: number, write: (arg0:Uint8Array)=>void, close: ()=>void} = null;

    // If we aren't actually recording anything, this will become true
    const noRecording = false;

    // We decide the bitrate based on the height
    const videoSettings = video.userMediaVideo.getVideoTracks()[0].getSettings();
    let bitrate: number;
    if (opts.bitrate)
        bitrate = Math.min(opts.bitrate * 1000000, videoSettings.height * 75000);
    else
        bitrate = videoSettings.height * 7500;
    const globalFrameTime = 1/videoSettings.frameRate * 1000;
    let libav: any;
    const transtate: TranscodeState = {};
    let c: number;

    recordPromise = recordPromise.then(() => {
        // Make sure we've loaded StreamSaver
        if (typeof streamSaver === "undefined")
            return loadStreamSaver();

    }).then(() => {
        if (opts.remote) {
            if (!("remotePeer" in opts)) {
                // Verify first!
                jitsi.videoRecSend(jitsi.videoRecHost, prot.videoRec.startVideoRecReq, {ext: outFormat});

                return new Promise((res) => {
                    recordVideoRemoteOK = function(peer: number) {
                        opts.remotePeer = peer;
                        res(0);
                    };

                    recordVideoRemoteOKTimeout = setTimeout(function() {
                        recordVideoRemoteOK = null;
                        if (localWriter)
                            localWriter.close();
                        recordVideoUI();
                        res(0);
                    }, 5000);
                });
            }

        }

    }).then(() => {
        recordVideoRemoteOK = null;
        if (recordVideoRemoteOKTimeout) {
            clearTimeout(recordVideoRemoteOKTimeout);
            recordVideoRemoteOKTimeout = null;
        }

        if (!("remotePeer" in opts))
            opts.remote = false;

        if (opts.remote) {
            remoteWriter = {
                idx: 0,
                write: function(chunk) {
                    recordVideoRemoteWrite(opts.remotePeer, this.idx, chunk);
                    this.idx += chunk.length;
                },
                close: function() {
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    this.write = function() {};
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    this.close = function() {};
                    recordVideoRemoteClose(opts.remotePeer);
                }
            };

        } else if (!opts.local) {
            opts.local = true;

        }

        if (opts.local) {
            // Create a write stream
            if (opts.localWriter) {
                localWriter = opts.localWriter;
            } else {
                const fileStream = streamSaver.createWriteStream(filename);
                localWriter = fileStream.getWriter();
                window.addEventListener("unload", function() {
                    localWriter.close();
                });
                opts.localWriter = localWriter;
            }
        }

        if (recordVideoStop) {
            // Can't have two videos recording at once!
            return recordVideoStop();
        }

    }).then(() => {
        if (noRecording) return;
        return avloader.loadLibAV();

    }).then(() => {
        if (noRecording) return;
        return LibAV.LibAV();

    }).then((la) => {
        if (noRecording) return;

        // Set up our forwarder in LibAV
        transtate.libav = libav = la;
        if (!libav.onwrite) {
            libav.onwriteto = {};
            libav.onwrite = function(name: string, pos: number, buf: Uint8Array) {
                if (name in libav.onwriteto)
                    return libav.onwriteto[name](pos, buf);
                else
                    console.error(name);
            };
        }

    }).then(() => {
        if (noRecording) return;

        // Create our LibAV input
        transtate.format = (format[0] === "x-matroska") ? "mkv" : format[0];
        transtate.mimeType = mimeType;
        transtate.fullReadCodecPar = format[2];
        transtate.bitrate = bitrate;
        transtate.inF = "in-" + Math.random() + "." + format;
        transtate.outF = "out-" + Math.random() + "." + outFormat;
        return recordVideoInput(transtate);

    }).then(() => {
        if (noRecording) return;

        // And output
        transtate.written = 0;
        libav.onwriteto[transtate.outF] = function(pos: number, buf: Uint8Array) {
            if (pos !== transtate.written)
                return; // Ignore patches
            buf = new Uint8Array(buf.buffer);
            if (localWriter)
                localWriter.write(buf);
            if (remoteWriter)
                remoteWriter.write(buf);
            transtate.written += buf.length;
        };

        // Then the transit
        transtate.startPromise.then(function() {
            return libav.ff_init_demuxer_file(transtate.inF);

        }).then(function(ret: any) {
            transtate.in_fmt_ctx = ret[0];
            const streams = transtate.in_streams = ret[1];

            let si, stream;
            for (si = 0; si < streams.length; si++) {
                stream = streams[si];
                if (stream.codec_type === libav.AVMEDIA_TYPE_VIDEO)
                    break;
            }
            if (si >= streams.length)
                throw new Error("MediaRecorder didn't produce a valid video file!");

            transtate.in_stream_idx = si;
            transtate.in_stream = stream;
            return Promise.all([
                libav.avcodec_alloc_context3(0),
                libav.av_packet_alloc()
            ]);

        }).then(function(ret: any) {
            c = ret[0];
            transtate.pkt = ret[1];

            return libav.avcodec_parameters_to_context(c, transtate.in_stream.codecpar);

        }).then(function() {
            let sentFirst = false;
            let starterPackets: any[] = [];
            let lastDTS = 0;

            // Now read it in
            return new Promise(function(res, rej) {
                function go() {
                    const againPromise = new Promise(function(res) { transtate.read = res; });
                    let readState: number, packets: any, endTimeReal: number;
                    return libav.ff_read_multi(transtate.in_fmt_ctx, transtate.pkt, transtate.inF).then(function(ret: any) {
                        readState = ret[0];
                        if (readState !== 0 && readState !== -libav.EAGAIN && readState !== libav.AVERROR_EOF) {
                            // Weird error!
                            throw new Error(ret[0]);
                        }
                        packets = ret[1][transtate.in_stream_idx] || [];

                        // Figure out the timing
                        if (packets.length)
                            endTimeReal = performance.now();

                        // Maybe prepare output
                        if (packets.length && !transtate.out_oc) {
                            // Initialize the muxer and output device
                            return libav.ff_init_muxer({filename: transtate.outF, open: true, device: true},
                                [[c, fixedTimeBase.num, fixedTimeBase.den]]).then(function(ret: any) {

                                transtate.out_oc = ret[0];
                                transtate.out_fmt = ret[1];
                                transtate.out_pb = ret[2];
                                transtate.out_st = ret[3];

                                // Write out the header
                                return libav.avformat_write_header(transtate.out_oc, 0);

                            });
                        }

                    }).then(function() {
                        function timeFrom(fromhi: number, from: number) {
                            from += fromhi * 0x100000000;
                            return from * transtate.in_stream.time_base_num / transtate.in_stream.time_base_den * 1000;
                        }

                        function timeTo(from: number) {
                            const to = from * fixedTimeBase.den / fixedTimeBase.num / 1000;
                            return {
                                hi: ~~(to / 0x100000000),
                                lo: ~~(to % 0x100000000)
                            };
                        }

                        if (packets.length) {
                            // Update the timing
                            if (net.remoteBeginTime && audio.timeOffset) {
                                // The last packet tells us roughly when we are
                                const lastPacket = packets[packets.length-1];

                                // Get the framerate from the packets
                                let frameTime;
                                if (packets.length > 1) {
                                    const last = timeFrom(lastPacket.dtshi, lastPacket.dts);
                                    const first = timeFrom(packets[0].dtshi, packets[0].dts);
                                    if (last < 0 || first < 0) {
                                        // Invalid dts, just trust global frame time
                                        frameTime = globalFrameTime;
                                    } else {
                                        frameTime = (last - first) / (packets.length - 1);
                                    }
                                } else {
                                    frameTime = globalFrameTime;
                                }

                                // Figure out the ideal end time
                                const endTimeDTS = endTimeReal // The real time when we received this packet
                                    - video.videoLatency // Adjusted for input latency
                                    + audio.timeOffset // Convert to remote time
                                    - net.remoteBeginTime; // Base at recording start time

                                // Now figure out the practical range of times
                                let startTimeDTS;
                                if (lastDTS)
                                    startTimeDTS = lastDTS;
                                else
                                    startTimeDTS = endTimeDTS - frameTime * (packets.length-1);

                                // Figure out our ideal time step between these
                                let step = (endTimeDTS - startTimeDTS) / (packets.length-1);

                                // But don't let it get too far from the frame rate
                                const stepVRate = step/frameTime;
                                if (stepVRate < 0.99)
                                    step = frameTime * 0.99;
                                else if (stepVRate > 1.01)
                                    step = frameTime * 1.01;

                                // Now retime all the packets
                                let dts = startTimeDTS;
                                for (let pi = 0; pi < packets.length; pi++) {
                                    const packet = packets[pi];
                                    let pdts: any = timeFrom(packet.dtshi, packet.dts);
                                    let ppts: any = timeFrom(packet.ptshi, packet.pts);
                                    if (pdts < 0) pdts = ppts;
                                    ppts -= pdts;
                                    pdts = (dts < lastDTS) ? lastDTS : dts;
                                    ppts += pdts;
                                    if (ppts < 0) ppts = 0;
                                    pdts = timeTo(pdts);
                                    ppts = timeTo(ppts);
                                    packet.dtshi = pdts.hi;
                                    packet.dts = pdts.lo;
                                    packet.ptshi = ppts.hi;
                                    packet.pts = ppts.lo;
                                    dts += step;
                                }

                                lastDTS = dts;

                                // If we haven't sent the starter packets, do so
                                if (!sentFirst) {
                                    if (starterPackets.length) {
                                        // Use them to make sure we have an I-frame
                                        packets = starterPackets.concat(packets);
                                    } else {
                                        // We definitely have an I-frame, but fix timing
                                        const packet = packets[0];
                                        packet.dtshi = packet.dts = packet.ptshi = packet.pts = 0;
                                    }
                                    starterPackets = null;
                                    sentFirst = true;
                                }

                            } else {
                                /* No starting time yet, so just collect packets, making sure we keep a keyframe */
                                for (let pi = 0; pi < packets.length; pi++) {
                                    const packet = packets[pi];
                                    packet.dtshi = packet.dts = packet.ptshi = packet.pts = 0;
                                    if (packet.flags & 1 /* KEY */)
                                        starterPackets = [packet];
                                    else
                                        starterPackets.push(packet);
                                }
                                packets = [];

                            }
                        }

                        if (packets.length) {
                            // And write
                            return libav.ff_write_multi(transtate.out_oc, transtate.pkt, packets);

                        }

                    }).then(function() {
                        // Continue or end
                        if (readState === libav.AVERROR_EOF)
                            res(void 0);
                        else if (readState === -libav.EAGAIN && packets.length === 0)
                            againPromise.then(go);
                        else
                            go();

                    }).catch(rej);
                }

                go();
            });

        }).then(function() {
            // When we're done reading, write the trailer
            if (transtate.out_oc)
                return libav.av_write_trailer(transtate.out_oc);

        }).then(function() {
            // Free everything
            return Promise.all([
                libav.avcodec_free_context_js(c),
                libav.av_packet_free(transtate.pkt),
                libav.avformat_close_input_js(transtate.in_fmt_ctx),
                transtate.out_oc ? libav.ff_free_muxer(transtate.out_oc, transtate.out_pb) : Promise.all([])
            ]);

        }).then(function() {
            // And close writing
            if (localWriter)
                localWriter.close();
            if (remoteWriter)
                remoteWriter.close();

        }).catch(net.promiseFail());

        // MediaRecorder produces a WebM file, and we have to correct its timestamps
        const mediaRecorder = new MediaRecorder(video.userMediaVideo, {
            mimeType: mimeType,
            videoBitsPerSecond: bitrate
        });
        mediaRecorder.addEventListener("dataavailable", function(chunk: {data: Blob}) {
            if (transtate.write)
                transtate.write(chunk.data);
        });
        mediaRecorder.addEventListener("stop", function() {
            if (transtate.write) {
                transtate.write(null);
                transtate.write = null;
                recordVideoStop = null;
                recordVideoUI();
            }
        });
        mediaRecorder.start(200);

        // Set up a way to stop it
        recordVideoStop = function() {
            recordVideoUI(true);

            // End the translation
            if (transtate.write) {
                transtate.write(null);
                transtate.write = null;
            }
            mediaRecorder.stop();
            recordVideoStop = null;

            // Give it a second
            return new Promise(res => {
                setTimeout(res, 1000);
            }).then(recordVideoUI);
        };
        recordVideoUI();

    }).catch(net.promiseFail());
}

// Receive a remote video recording
export function recordVideoRemoteIncoming(peer: number, opts?: {ext?: string}): Promise<WritableStreamDefaultWriter> {
    // Handle remote options
    let ext = "webm";
    if (opts.ext === "mkv")
        ext = "mkv";

    // Choose a name
    let filename = "";
    if (net.recName)
        filename = net.recName + "-";
    const remoteUser = ui.ui.panels.userList.users[peer];
    const remoteName = remoteUser ? remoteUser.name.innerText : "";
    if (remoteName)
        filename += remoteName + "-";
    filename += "video." + ext;

    // Create a write stream
    return loadStreamSaver().then(function() {
        const fileStream = streamSaver.createWriteStream(filename);
        const fileWriter = fileStream.getWriter();
        window.addEventListener("unload", function() {
            fileWriter.close();
        });

        return fileWriter;
    }).catch(net.promiseFail());
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

// Input handler for video recording
function recordVideoInput(transtate: TranscodeState) {
    const libav = transtate.libav;

    return Promise.all([]).then(function() {
        if (transtate.fullReadCodecPar) {
            // To get the codec parameters, we need a full file
            const mediaRecorder = new MediaRecorder(video.userMediaVideo, {
                mimeType: transtate.mimeType,
                videoBitsPerSecond: transtate.bitrate
            });
            let data = new Uint8Array(0);
            let mp4PromiseRes: (arg0:unknown)=>void, mp4PromiseRej: (arg0:unknown)=>void;
            const mp4Promise = new Promise(function(res, rej) {
                mp4PromiseRes = res;
                mp4PromiseRej = rej;
            });
            let p: Promise<unknown> = Promise.all([]);
            mediaRecorder.addEventListener("dataavailable", function(chunk: {data: Blob}) {
                p = p.then(function() {
                    return blobToArrayBuffer(chunk.data);
                }).then(function(ab) {
                    const chunk = new Uint8Array(ab);
                    const newData = new Uint8Array(data.length + chunk.length);
                    newData.set(data, 0);
                    newData.set(chunk, data.length);
                    const done = (data.length === 0);
                    data = newData;
                    if (done) {
                        // We got all we need
                        mediaRecorder.stop();
                    }
                }).catch(mp4PromiseRej);
            });
            mediaRecorder.addEventListener("stop", function() {
                // Use this complete file to figure out the header for our eventual real file
                let in_fmt_ctx: number, in_stream: any, c: number;

                const tmpFile = transtate.inF + ".tmp.mp4";

                p = p.then(function() {
                    return libav.writeFile(tmpFile, data);
                }).then(function() {
                    return libav.ff_init_demuxer_file(tmpFile);
                }).then(function(ret) {
                    in_fmt_ctx = ret[0];
                    const streams = ret[1];

                    let si, stream;
                    for (si = 0; si < streams.length; si++) {
                        stream = streams[si];
                        if (stream.codec_type === libav.AVMEDIA_TYPE_VIDEO)
                            break;
                    }
                    if (si >= streams.length)
                        throw new Error("MediaRecorder didn't produce a valid video file!");

                    in_stream = stream;
                    return libav.avformat_find_stream_info(in_fmt_ctx);

                }).then(function() {
                    return libav.avcodec_alloc_context3(0);

                }).then(function(ret) {
                    c = ret;
                    return libav.avcodec_parameters_to_context(c, in_stream.codecpar);

                }).then(function() {
                    // Now we have the codec info to create WebM's header
                    return libav.ff_init_muxer({filename: transtate.outF, open: true, device: true},
                        [[c, fixedTimeBase.num, fixedTimeBase.den]]);

                }).then(function(ret) {
                    transtate.out_oc = ret[0];
                    transtate.out_fmt = ret[1];
                    transtate.out_pb = ret[2];
                    transtate.out_st = ret[3];

                    // Write out the header
                    return libav.avformat_write_header(transtate.out_oc, 0);

                }).then(function() {
                    // Clean up
                    return Promise.all([
                        libav.avcodec_free_context_js(c),
                        libav.avformat_close_input_js(in_fmt_ctx),
                        libav.unlink(tmpFile)
                    ]);

                }).then(function() {
                    // Now we can continue with the normal processing
                    mp4PromiseRes(void 0);

                }).catch(mp4PromiseRej);
            });
            mediaRecorder.start(200);

            return mp4Promise;
        }

    }).then(function() {
        /* Create a promise for the start, because we have to buffer the header
         * before we can start real recording */
        let startPromiseRes: any, startPromiseDone = false;
        let startSz = 0;
        const startPromise = new Promise(function(res) {
            startPromiseRes = res;
        });

        // Create a promise for creating the input device
        const devicePromise = libav.mkreaderdev(transtate.inF);

        // Create a promise so we can keep everything in order, starting with the device
        let inputPromise = devicePromise;

        // Now create our input handler
        transtate.write = function(blob: Blob) {
            let buf: Uint8Array;
            inputPromise = inputPromise.then(function() {
                // Convert to an ArrayBuffer
                if (blob)
                    return blobToArrayBuffer(blob);
                else
                    return null;

            }).then(function(sbuf: ArrayBuffer) {
                // And then send it along
                if (sbuf)
                    buf = new Uint8Array(sbuf);
                else
                    buf = null;
                return libav.ff_reader_dev_send(transtate.inF, buf);

            }).then(function() {
                // Possibly wake up the transcoding
                if (!startPromiseDone || !buf) {
                    if (buf)
                        startSz += buf.length;
                    if (startSz >= 64 * 1024 || !buf) {
                        startPromiseRes();
                        startPromiseDone = true;
                    }
                }
                if (transtate.read)
                    transtate.read(void 0);

            });
        }

        transtate.startPromise = startPromise;

    }).catch(net.promiseFail());
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
function maybeRecord() {
    const recording = ui.ui.panels.videoConfig.recording;

    if (reconsidering) {
        // Already being done
        return;
    }

    reconsidering = true;
    recordPromise = recordPromise.then(() => {
        if (recordVideoStop)
            return recordVideoStop();

    }).then(() => {
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
            recordVideo(opts);

        } else if (!supported && video.userMediaVideo && recording.record.checked && config.useVideoRec) {
            // Warn that they're not "contributing"
            log.pushStatus("video-rec-unsupported", "WARNING: Your browser does not support video recording!");
            setTimeout(() => { log.popStatus("video-rec-unsupported"); }, 10000);

        }
        reconsidering = false;

    });
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

// Load the StreamSaver library, needed only for video recording
function loadStreamSaver(): Promise<unknown> {
    if (typeof streamSaver === "undefined") {
        return util.loadLibrary("libs/web-streams-ponyfill.js").then(function() {
            return util.loadLibrary("libs/StreamSaver.js?v=5");
        }).then(function() {
            streamSaver.mitm = "libs/StreamSaver/mitm.html?v=2";
        });
    }
    return Promise.all([]);
}

// Make sure the recording updates when the video state updates
util.events.addEventListener("usermediavideoready", maybeRecord);
util.events.addEventListener("usermediavideostopped", maybeRecord);
