#!/usr/bin/env node
/*
 * Copyright (c) 2018 Yahweasel
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
 * EnnuiCastr: Multi-user synchronized recording via the web
 *
 * This is a simple example/testing server.
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const ws = require("ws");

const ogg = require("./ogg.js");
const prot = require("../protocol.js");

// A precompiled Opus header, modified from one made by opusenc
const opusHeader = [
    Buffer.from([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01,
        0x38, 0x01, 0x80, 0xBB, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from([0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0x0A, 0x00,
        0x00, 0x00, 0x65, 0x6E, 0x6E, 0x75, 0x69, 0x63, 0x61, 0x73, 0x74,
        0x72])
];

// A precompiled FLAC header, modified from one made by flac
const flacHeader48k =
    Buffer.from([0x7F, 0x46, 0x4C, 0x41, 0x43, 0x01, 0x00, 0x00, 0x03, 0x66,
        0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x10, 0x00, 0x10, 0x00, 0x00,
        0x00, 0x0C, 0x00, 0x00, 0x0E, 0x0B, 0xB8, 0x01, 0x70, 0x00, 0x00, 0xBB,
        0x80, 0x6B, 0x94, 0x58, 0xD4, 0xE1, 0xBB, 0x69, 0x0C, 0xDE, 0x1B, 0x87,
        0xF2, 0xDB, 0x82, 0x6E, 0x22]);


// A precompiled FLAC header for 44.1k
const flacHeader44k =
    Buffer.from([0x7F, 0x46, 0x4C, 0x41, 0x43, 0x01, 0x00, 0x00, 0x03, 0x66,
        0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x03, 0x72, 0x03, 0x72, 0x00,
        0x00, 0x0E, 0x00, 0x00, 0x0E, 0x0A, 0xC4, 0x41, 0x70, 0x00, 0x00, 0xAC,
        0x44, 0xD7, 0x1E, 0x31, 0x8B, 0x75, 0xD0, 0x4E, 0xEA, 0x13, 0xEF, 0x91,
        0xC3, 0x23, 0x9B, 0x7E, 0x25]);

// FLAC tags to say we're ennuicastr
const flacTags =
    Buffer.from([0x04, 0x00, 0x00, 0x41, 0x0A, 0x00, 0x00, 0x00, 0x65, 0x6E,
        0x6E, 0x75, 0x69, 0x63, 0x61, 0x73, 0x74, 0x72]);

const oggFile = new ogg.OggEncoder(fs.createWriteStream("rec.opus"));

const home = process.env.HOME;
const hs = https.createServer({
    cert: fs.readFileSync(home+"/cert/fullchain.pem", "utf8"),
    key: fs.readFileSync(home+"/cert/privkey.pem", "utf8")
});
//const hs = http.createServer();
hs.listen(36678);

const wss = new ws.Server({
    server: hs
});

var startTime = process.hrtime();

wss.on("connection", (ws) => {
    var dead = false;
    var packetNo = 0;
    function die() {
        ws.close();
        dead = true;

        if (packetNo > 0) {
            // We got a successful connection, so we're now done
            wss.close();
            hs.close();
            oggFile.end();
        }
    }

    ws.on("message", (msg) => {
        if (dead) return;

        msg = Buffer.from(msg); // Just in case

        if (msg.length < 4) return die();

        var cmd = msg.readUInt32LE(0);
        var ret;

        switch (cmd) {
            case prot.ids.login:
                // In this example server, login is always successful
                var p = prot.parts.login;
                var f = prot.flags;
                if (msg.length < p.length)
                    return die();

                var nick;
                try {
                    nick = msg.toString("utf8", 16);
                } catch (ex) {
                    nick = "_";
                }
                console.log("Login by " + nick);

                var flags = msg.readUInt32LE(p.flags);
                var ctype = flags & f.connectionTypeMask;
                var dtype = flags & f.dataTypeMask;

                switch (ctype) {
                    case f.connectionType.ping:
                        // This is a ping connection, so reset our start time (just for this demo recorder)
                        startTime = process.hrtime();
                        break;

                    case f.connectionType.data:
                        // This is a data connection, so start the actual recording
                        if (dtype === f.dataType.flac) {
                            // We need to wait until an info packet arrives
                        } else {
                            oggFile.write(0, 1, packetNo++, opusHeader[0], ogg.BOS);
                            oggFile.write(0, 1, packetNo++, opusHeader[1]);
                        }
                        break;

                    default:
                        // No other connection types supported!
                        return die();
                }

                var op = prot.parts.ack;
                ret = Buffer.alloc(op.length);
                ret.writeUInt32LE(prot.ids.ack, 0);
                ret.writeUInt32LE(prot.ids.login, op.ackd);
                ws.send(ret);
                break;

            case prot.ids.info:
                var p = prot.parts.info;
                if (msg.length != p.length)
                    return die();

                var key = msg.readUInt32LE(p.key);
                var value = msg.readUInt32LE(p.value);

                if (key === prot.info.sampleRate) {
                    // FLAC's sample rate specification (NOTE: We should really check that we're FLAC here)
                    switch (value) {
                        case 44100:
                            oggFile.write(0, 1, packetNo++, flacHeader44k, ogg.BOS);
                            break;
                        default:
                            oggFile.write(0, 1, packetNo++, flacHeader48k, ogg.BOS);
                    }
                    oggFile.write(0, 1, packetNo++, flacTags);
                }
                break;

            case prot.ids.ping:
                var p = prot.parts.ping;
                if (msg.length != p.length)
                    return die();

                var op = prot.parts.pong;
                ret = Buffer.alloc(op.length);
                ret.writeUInt32LE(prot.ids.pong, 0);
                msg.copy(ret, op.clientTime, p.clientTime);
                var tm = process.hrtime(startTime);
                ret.writeDoubleLE(tm[0]*1000 + (tm[1]/1000000), op.serverTime);
                ws.send(ret);
                break;

            case prot.ids.data:
                var p = prot.parts.data;
                if (msg.length < p.length)
                    return die();

                if (packetNo > 0) {
                    // We've written the header, so accept this data
                    var granulePos = msg.readUIntLE(p.granulePos, 6);
                    var chunk = msg.slice(p.length);
                    oggFile.write(granulePos, 1, packetNo++, chunk);
                }
                break;

            default:
                console.error(msg);
                return die();
        }
    });

    ws.on("close", () => {
        if (dead) return;
        die();
    });
});
