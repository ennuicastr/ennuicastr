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

// Receive a chat message
function recvChat(text) {
    togglePanel("chat", true);
    var line = dce("div");
    line.innerText = text;
    ui.chatBox.incoming.appendChild(line);
    ui.chatBox.incoming.scroll(0, 1000000);
}

// Send a chat message
function sendChat(text) {
    var textBuf = encodeText(text);
    var p = prot.parts.text;
    var out = new DataView(new ArrayBuffer(p.length + textBuf.length));
    out.setUint32(0, prot.ids.text, true);
    out.setUint32(p.reserved, 0, true);
    new Uint8Array(out.buffer).set(textBuf, p.text);
    dataSock.send(out.buffer);
}

// Build the chat box behavior
function createChatBox() {
    var chatBox = ui.chatBox = {
        incoming: gebi("ecchat-incoming"),
        outgoing: gebi("ecchat-outgoing")
    };
    var outgoing = chatBox.outgoing;

    // Make outgoing work
    function handleOutgoing() {
        // Send this message
        sendChat(outgoing.value);
        recvChat("You: " + outgoing.value);
        outgoing.value = "";
    }
    gebi("ecchat-outgoing-b").onclick = handleOutgoing;
}
