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
    var bitrate = userMediaVideo.getVideoTracks()[0].getSettings().height * 5000;

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
            console.log(buf);
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

            // Now read it in
            return new Promise(function(res, rej) {
                function go() {
                    var readState, packets;
                    libav.ff_read_multi(transtate.in_fmt_ctx, transtate.pkt, transtate.inF).then(function(ret) {
                        readState = ret[0];
                        if (readState !== 0 && readState !== -libav.EAGAIN && readState !== libav.AVERROR_EOF) {
                            // Weird error!
                            throw new Error(ret[0]);
                        }
                        packets = ret[1][transtate.in_stream_idx] || [];

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
                        // And write (FIXME: Timestamp madness)
                        if (packets.length)
                            return libav.ff_write_multi(transtate.out_oc, transtate.pkt, packets);

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
