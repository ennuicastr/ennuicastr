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
 * This is the protocol description.
 */

(function() {
    var EnnuiCastrProtocol = {
        "ids": {
            "ack": 0x00,

            "login": 0x10,
            "info": 0x11,
            "error": 0x12,

            "ping": 0x20,
            "pong": 0x21,

            "data": 0x30,

            // Monitoring
            "user": 0x40,
            "speech": 0x41,

            // WebRTC signaling info
            "rtc": 0x50,
        },

        "parts": {
            "ack": {
                "length": 8,
                "ackd": 4
            },

            "login": {
                "length": 16,
                "id": 4,
                "key": 8,
                "flags": 12,
                "nick": 16
            },

            "info": {
                "length": 12,
                "key": 4,
                "value": 8
            },

            "ping": {
                "length": 12,
                "clientTime": 4
            },

            "pong": {
                "length": 20,
                "clientTime": 4,
                "serverTime": 12
            },

            "data": {
                "length": 12,
                "granulePos": 4,
                "packet": 12
            },

            "user": {
                "length": 12,
                "index": 4,
                "status": 8,
                "nick": 12
            },

            "speech": {
                "length": 8,
                "indexStatus": 4
            },

            "rtc": {
                "length": 12,
                "peer": 4,
                "type": 8,
                "value": 12
            }
        },

        "flags": {
            "connectionTypeMask": 0xF,
            "connectionType": {
                "ping": 0x0,
                "data": 0x1,
                "monitor": 0x8
            },
            "dataTypeMask": 0xF0,
            "dataType": {
                "opus": 0x00,
                "flac": 0x10
            },
            "featuresMask": 0xFF00,
            "features": {
                "continuous": 0x100,
                "rtc": 0x200
            }
        },

        "info": {
            // C->S: For FLAC, inform of the sample rate
            "sampleRate": 0,

            // S->C: Give the client its ID number
            "id": 0x10,

            // S->C: Inform the client that a peer exists or has connected
            /* It is the role of an initially-connecting peer to start RTC
             * connections, so a client with RTC enabled should respond to
             * peerContinuing by starting the RTC procedure with that peer.
             * peerInitial is purely informative. */
            "peerInitial": 0x11,
            "peerContinuing": 0x12,

            // S->C: Inform the client of a peer disconnecting
            "peerLost": 0x13
        },

        "rtc": {
            // C->S: Give ICE candidate to another peer {id, candidate JSON}
            // S->C: Relay, id replaced by source
            "candidate": 0x0,

            // C->S: Give RTC offer to another peer {id, offer JSON}
            // S->C: Relay, id replaced by source
            "offer": 0x1,

            // C->S: Give RTC answer to another peer {id, answer JSON}
            // S->C: Relay, id replaced by source
            "answer": 0x2
        }
    };

    if (typeof process !== "undefined")
        module.exports = EnnuiCastrProtocol;
    else if (typeof window !== "undefined")
        window.EnnuiCastrProtocol = EnnuiCastrProtocol;
})();
