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
                if (msg.length < p.length)
                    return die();

                var nick;
                try {
                    nick = msg.toString("utf8", 16);
                } catch (ex) {
                    nick = "_";
                }
                console.log("Login by " + nick);

                if (msg.readUInt32LE(p.flags) & 1) {
                    // This is a data connection, so start the actual recording
                    oggFile.write(0, 1, packetNo++, opusHeader[0], ogg.BOS);
                    oggFile.write(0, 1, packetNo++, opusHeader[1]);
                } else {
                    // This is a ping connection, so reset our start time (just for this demo recorder)
                    startTime = process.hrtime();
                }

                var op = prot.parts.ack;
                ret = Buffer.alloc(op.length);
                ret.writeUInt32LE(prot.ids.ack, 0);
                ret.writeUInt32LE(prot.ids.login, op.ackd);
                ws.send(ret);
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
