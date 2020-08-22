/*
 * Copyright (c) 2020 Yahweasel
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

function recordVideo() {
    var libav;

    // We decide the bitrate based on the height (FIXME: Configurability)
    var videoSettings = userMediaVideo.getVideoTracks()[0].getSettings();
    var bitrate = videoSettings.height * 5000;
    var frameRate = videoSettings.frameRate;
    var frameTime = 1/frameRate * 1000;

    return loadLibAV().then(function() {
        libav = LibAV;

        // Set up our forwarder in LibAV
        if (!libav.onwrite) {
            libav.onwriteto = {};
            libav.onwrite = function(name, pos, buf) {
                if (name in libav.onwriteto)
                    return libav.onwriteto[name](pos, buf);
                else
                    console.error(name);
            };
        }

        // Make sure we've loaded StreamSaver
        if (typeof streamSaver === "undefined") {
            return loadLibrary("web-streams-ponyfill.js").then(function() {
                return loadLibrary("StreamSaver.js");
            }).then(function() {
                streamSaver.mitm = "StreamSaver/mitm.html";
            });
        }

    }).then(function() {
        // Create a write stream
        var fileStream = streamSaver.createWriteStream("video.webm"); // FIXME: name
        var fileWriter = fileStream.getWriter();

        // Create our LibAV input
        var transtate = {};
        transtate.inF = "in-" + Math.random() + ".webm";
        transtate.outF = "out-" + Math.random() + ".webm";
        recordVideoInput(transtate);

        // And output
        transtate.written = 0;
        libav.onwriteto[transtate.outF] = function(pos, buf) {
            if (pos !== transtate.written) {
                console.error("Patch");
                return; // Ignore patches
            }
            buf = new Uint8Array(buf.buffer);
            fileWriter.write(buf);
            transtate.written += buf.length;
        };

        // Then the transit
        transtate.startPromise.then(function() {
            return libav.ff_init_demuxer_file(transtate.inF);

        }).then(function(ret) {
            transtate.in_fmt_ctx = ret[0];
            var streams = transtate.in_streams = ret[1];

            var si, stream;
            for (si = 0; si < streams.length; si++) {
                stream = streams[si];
                if (stream.codec_type === libav.AVMEDIA_TYPE_VIDEO)
                    break;
            }
            if (si >= streams.length)
                throw new Error("MediaRecorder didn't produce a valid video file!");

            transtate.in_stream_idx = si;
            transtate.in_stream = stream;
            return libav.ff_init_decoder(stream.codec_id);

        }).then(function(ret) {
            transtate.c = ret[1];
            transtate.pkt = ret[2];
            transtate.frame = ret[3];

            var sentFirst = false;
            var lastDTS = 0;
            var lastPTS = 0;

            // Now read it in
            return new Promise(function(res, rej) {
                function go() {
                    var readState, packets, endTimeReal;
                    libav.ff_read_multi(transtate.in_fmt_ctx, transtate.pkt, transtate.inF).then(function(ret) {
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
                            // Decode at least some packets so the codec state is complete
                            return libav.ff_decode_multi(transtate.c, transtate.pkt, transtate.frame, packets, true).then(function() {
                                // Initialize the muxer and output device
                                return libav.ff_init_muxer({filename: transtate.outF, open: true, device: true},
                                    [[transtate.c, transtate.in_stream.time_base_num, transtate.in_stream.time_base_den]]);
                            }).then(function(ret) {
                                transtate.out_oc = ret[0];
                                transtate.out_fmt = ret[1];
                                transtate.out_pb = ret[2];
                                transtate.out_st = ret[3];

                                // Write out the header
                                return libav.avformat_write_header(transtate.out_oc, 0);

                            });
                        }

                    }).then(function() {
                        function timeFrom(fromhi, from) {
                            from += fromhi * 0x100000000;
                            return from * transtate.in_stream.time_base_num / transtate.in_stream.time_base_den * 1000;
                        }

                        function timeTo(from) {
                            var to = from * transtate.in_stream.time_base_den / transtate.in_stream.time_base_num / 1000;
                            return {
                                hi: ~~(to / 0x100000000),
                                lo: ~~(to % 0x100000000)
                            };
                        }

                        if (packets.length) {
                            // Update the timing
                            if (remoteBeginTime) {
                                // Get the last packet's time
                                var lastPacket = packets[packets.length-1];
                                /*
                                FIXME: This makes mathematical sense, but
                                causes stutter. The new solution doesn't
                                stutter, but probably drifts. I'll have to find
                                an intermediate.

                                var endTimeDTS = timeFrom(lastPacket.dtshi, lastPacket.dts);
                                var endTimePTS = timeFrom(lastPacket.ptshi, lastPacket.pts);
                                if (endTimeDTS < lastDTS) endTimeDTS = lastDTS;
                                if (endTimePTS < lastPTS) endTimePTS = lastPTS;
                                var startTimeDTS = endTimeDTS - frameTime * (packets.length-1);
                                var startTimePTS = endTimePTS - frameTime * (packets.length-1);
                                */
                                var endTimeDTS, startTimeDTS;
                                if (lastDTS) {
                                    startTimeDTS = lastDTS + frameTime;
                                } else {
                                    startTimeDTS = endTimeReal // Time when this packet ended
                                        - frameTime * (packets.length-1) // But from the first frame
                                        + timeOffset // Convert to remote time
                                        - remoteBeginTime; // Base at recording begin time
                                }
                                endTimeDTS = startTimeDTS + frameTime * (packets.length-1);

                                /*
                                // Figure out the correct offset
                                var offset = 0 - endTimePTS // Remove file time
                                             + endTimeReal // Convert to local time
                                             + timeOffset // Convert to remote time
                                             - remoteBeginTime; // Base at recording time
                                packets.forEach(function(packet) {
                                    var dts = timeFrom(packet.dtshi, packet.dts);
                                    var pts = timeFrom(packet.ptshi, packet.pts);
                                    dts += offset;
                                    pts += offset;
                                    if (dts < lastDTS) dts = lastDTS;
                                    if (pts < lastPTS) pts = lastPTS;
                                    dts = timeTo(dts);
                                    pts = timeTo(pts);
                                    packet.dtshi = dts.hi;
                                    packet.dts = dts.lo;
                                    packet.ptshi = pts.hi;
                                    packet.pts = pts.lo;
                                });
                                */
                                var dts = startTimeDTS;
                                for (var pi = 0; pi < packets.length; pi++) {
                                    var packet = packets[pi];
                                    var pdts = timeFrom(packet.dtshi, packet.dts);
                                    var ppts = timeFrom(packet.ptshi, packet.pts);
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
                                    dts += frameTime;
                                }

                                lastDTS = endTimeDTS;

                            } else {
                                /* No starting time yet, so either send only
                                 * one packet (to get the timestamps right) or
                                 * nothing */
                                if (!sentFirst)
                                    packets = [packets[0]];
                                else
                                    packets = [];

                            }
                        }

                        if (packets.length) {
                            if (!sentFirst) {
                                // Make sure the first packet has timestamp 0 so that all the other timestamps are right
                                packets[0].dtshi = packets[0].dts = packets[0].ptshi = packets[0].pts = 0;
                                sentFirst = true;
                            }

                            // And write
                            return libav.ff_write_multi(transtate.out_oc, transtate.pkt, packets);

                        }

                    }).then(function() {
                        // Continue or end
                        if (readState == libav.AVERROR_EOF)
                            res();
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
                libav.ff_free_decoder(transtate.c, transtate.pkt, transtate.frame),
                libav.avformat_close_input_js(transtate.in_fmt_ctx),
                transtate.out_oc ? libav.ff_free_muxer(transtate.out_oc, transtate.out_pb) : Promise.all([])
            ]);

        }).then(function() {
            // And close writing
            fileWriter.close();

        }).catch(function(err) {
            console.error(err);

        });

        // MediaRecorder produces a WebM file, and we have to correct its timestamps
        mediaRecorder = new MediaRecorder(userMediaVideo, {
            mimeType: "video/webm; codecs=vp8",
            videoBitsPerSecond: bitrate
        });
        mediaRecorder.addEventListener("dataavailable", function(chunk) {
            transtate.write(chunk.data);
        });
        mediaRecorder.addEventListener("stop", function() {
            transtate.write(null);
        });
        mediaRecorder.start(200);

    });
}

// Input handler for video recording
function recordVideoInput(transtate) {
    var libav = LibAV;
    var buf;

    /* Create a promise for the start, because we have to buffer the header
     * before we can start real recording */
    var startPromiseRes, startPromiseDone = false;
    var startSz = 0;
    transtate.startPromise = new Promise(function(res) {
        startPromiseRes = res;
    });

    // Create a promise for creating the input device
    var devicePromise = libav.mkreaderdev(transtate.inF);

    // Create a promise so we can keep everything in order, starting with the device
    var inputPromise = devicePromise;

    // Now create our input handler
    transtate.write = function(blob) {
        inputPromise = inputPromise.then(function() {
            // Convert to an ArrayBuffer
            if (blob)
                return blob.arrayBuffer();
            else
                return null;

        }).then(function(sbuf) {
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

        });
    }
}
