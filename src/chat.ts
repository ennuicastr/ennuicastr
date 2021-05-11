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

import * as net from "./net";
import { prot } from "./protocol";
import * as ui from "./ui";
import * as util from "./util";
import { dce, gebi } from "./util";

// Receive a chat message
export function recvChat(text: string) {
    // FIXME: Better output selection
    ui.ui.chat.wrapper.style.display = "";
    var line = dce("div");
    line.innerText = text;
    ui.ui.chat.incoming.appendChild(line);
    ui.ui.chat.incoming.scroll(0, 1000000);
}

// Chat messages come from the data sock
util.netEvent("data", "text", function(ev) {
    let msg: DataView = ev.detail;
    let p = prot.parts.text;
    let text = util.decodeText(msg.buffer.slice(p.text));
    recvChat(text);
});

// Send a chat message
function sendChat(text: string) {
    var textBuf = util.encodeText(text);
    var p = prot.parts.text;
    var out = new DataView(new ArrayBuffer(p.length + textBuf.length));
    out.setUint32(0, prot.ids.text, true);
    out.setUint32(p.reserved, 0, true);
    new Uint8Array(out.buffer).set(textBuf, p.text);
    net.dataSock.send(out.buffer);
}

// Build the chat box behavior
export function mkChatBox() {
    var chat = ui.ui.chat;
    var outgoing = chat.outgoing;

    // Make outgoing work
    function handleOutgoing() {
        // Send this message
        sendChat(outgoing.value);
        recvChat("You: " + outgoing.value);
        outgoing.value = "";
    }
    chat.outgoingB.onclick = handleOutgoing;
}
