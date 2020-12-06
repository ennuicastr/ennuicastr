#!/usr/bin/env node
/*
 * Copyright (c) 2018-2019 Yahweasel
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
        0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x03, 0xC0, 0x03, 0xC0, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x0B, 0xB8, 0x01, 0x70, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00]);


// A precompiled FLAC header for 44.1k
const flacHeader44k =
    Buffer.from([0x7F, 0x46, 0x4C, 0x41, 0x43, 0x01, 0x00, 0x00, 0x03, 0x66,
        0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x03, 0x72, 0x03, 0x72, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x0A, 0xC4, 0x41, 0x70, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00]);

// FLAC tags to say we're ennuicastr
const flacTags =
    Buffer.from([0x04, 0x00, 0x00, 0x41, 0x0A, 0x00, 0x00, 0x00, 0x65, 0x6E,
        0x6E, 0x75, 0x69, 0x63, 0x61, 0x73, 0x74, 0x72]);

const oggFile = new ogg.OggEncoder(fs.createWriteStream("rec.opus"));

// Set up the EnnuiCastr server
const home = process.env.HOME;
var hss;
try {
    hss = https.createServer({
        cert: fs.readFileSync(home+"/cert/fullchain.pem", "utf8"),
        key: fs.readFileSync(home+"/cert/privkey.pem", "utf8")
    });
} catch (ex) {
    hss = http.createServer();
}
const hs = hss;
hs.listen(36678);

const wss = new ws.Server({
    server: hs
});

// Metadata
var startTime = process.hrtime();
var nick = null;
var monWs = null;
var dataTimeout = null;
var connections = [null];

function sendMon(stat) {
    if (!monWs) return;
    var p = prot.parts.speech;
    var buf = Buffer.alloc(p.length);
    buf.writeUInt32LE(prot.ids.speech, 0);
    buf.writeUInt32LE(stat, p.indexStatus);
    monWs.send(buf);
}

function sendMonStart() {
    sendMon(1);
}

function sendMonStop() {
    sendMon(0);
}

wss.on("connection", (ws) => {
    var dead = false;
    var id = 0;
    var packetNo = 0;
    function die() {
        ws.close();
        dead = true;
        if (id)
            connections[id] = null;

        if (packetNo > 0) {
            // We got a successful connection, so we're now done with this demo server
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

                var flags = msg.readUInt32LE(p.flags);
                var ctype = flags & f.connectionTypeMask;
                var dtype = flags & f.dataTypeMask;

                if (ctype !== f.connectionType.monitor) {
                    try {
                        nick = msg.toString("utf8", p.nick);
                    } catch (ex) {
                        nick = "_";
                    }
                    console.log("Login by " + nick);
                }

                var op = prot.parts.ack;
                ret = Buffer.alloc(op.length);
                ret.writeUInt32LE(prot.ids.ack, 0);
                ret.writeUInt32LE(prot.ids.login, op.ackd);
                ws.send(ret);

                if (nick) {
                    // Make the monitor command for the current user
                    var op = prot.parts.user;
                    var nickBuf = Buffer.from(nick, "utf8");
                    ret = Buffer.alloc(op.length + nickBuf.length);
                    ret.writeUInt32LE(prot.ids.user, 0);
                    ret.writeUInt32LE(0, op.index);
                    ret.writeUInt32LE(1, op.status);
                    nickBuf.copy(ret, op.nick);
                }

                switch (ctype) {
                    case f.connectionType.ping:
                        // This is a ping connection, so reset our start time (just for this demo recorder)
                        if (id === 1)
                            startTime = process.hrtime();
                        break;

                    case f.connectionType.data:
                        // This is a data connection
                        id = connections.length;
                        connections.push(ws);

                        // Tell them their ID
                        op = prot.parts.info;
                        ret = Buffer.alloc(op.length);
                        ret.writeUInt32LE(prot.ids.info, 0);
                        ret.writeUInt32LE(prot.info.id, op.key);
                        ret.writeUInt32LE(id, op.value);
                        ws.send(ret);

                        // Tell them the recording mode (always on)
                        ret = Buffer.alloc(op.length);
                        ret.writeUInt32LE(prot.ids.info, 0);
                        ret.writeUInt32LE(prot.info.mode, op.key);
                        ret.writeUInt32LE(prot.mode.rec, op.value);
                        ws.send(ret);

                        for (var ci = 1; ci < connections.length; ci++) {
                            if (ci === id) continue;
                            var target = connections[ci];
                            if (!target) continue;

                            ret = Buffer.alloc(op.length);
                            ret.writeUInt32LE(prot.ids.info, 0);
                            ret.writeUInt32LE(prot.info.peerInitial, op.key);
                            ret.writeUInt32LE(id, op.value);
                            connections[ci].send(ret);

                            ret = Buffer.alloc(op.length);
                            ret.writeUInt32LE(prot.ids.info, 0);
                            ret.writeUInt32LE(prot.info.peerContinuing, op.key);
                            ret.writeUInt32LE(ci, op.value);
                            ws.send(ret);
                        }

                        // Write the header for this track
                        if (dtype === f.dataType.flac) {
                            // We need to wait until an info packet arrives
                        } else {
                            oggFile.write(0, id, packetNo++, opusHeader[0], ogg.BOS);
                            oggFile.write(0, id, packetNo++, opusHeader[1]);
                        }

                        // Tell the monitor if appilcable
                        if (monWs)
                            monWs.send(ret);
                        break;

                    case f.connectionType.monitor:
                        if (nick)
                            ws.send(ret);
                        monWs = ws;
                        break;

                    case f.connectionType.master:
                        // Nothing
                        break;

                    default:
                        // No other connection types supported!
                        return die();
                }
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

                if (!dataTimeout)
                    sendMonStart();
                else
                    clearTimeout(dataTimeout);
                dataTimeout = setTimeout(function() {
                    sendMonStop();
                    dataTimeout = null;
                }, 2000);

                if (packetNo > 0) {
                    // We've written the header, so accept this data
                    var granulePos = msg.readUIntLE(p.granulePos, 6);
                    var chunk = msg.slice(p.length);
                    oggFile.write(granulePos, id, packetNo++, chunk);
                }
                break;

            case prot.ids.rtc:
                var p = prot.parts.rtc;
                if (msg.length < p.length)
                    return die();

                var target = msg.readUInt32LE(p.peer);
                if (!connections[target])
                    break; // Just drop it

                // Relay it to the target, with the source
                msg.writeUInt32LE(id, p.peer);
                connections[target].send(msg);
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
