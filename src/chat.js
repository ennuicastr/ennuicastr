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
    if (!chatBox || !chatBox.visible)
        mkChatBox();

    var line = dce("div");
    line.innerText = text;
    chatBox.incoming.appendChild(line);
    chatBox.incoming.scroll(0, 1000000);
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

// Build the chat box
function mkChatBox() {
    if (chatBox) {
        // It already exists, but is it actually visible?
        if (!chatBox.visible) {
            mkUI().appendChild(chatBox.wrapper);
            chatBox.visible = true;
        }
        return chatBox;
    }

    chatBox = {};

    // Create a wrapper so we can easily hide this
    var wrapper = chatBox.wrapper = dce("div");
    wrapper.style.flex = "auto";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";

    // Create the incoming box
    var incoming = chatBox.incoming = dce("div");
    incoming.style.flex = "auto";
    incoming.style.padding = "0.5em";
    incoming.style.minHeight = "2em";
    incoming.style.overflow = "auto";
    //incoming.style.resize = "vertical";
    wrapper.appendChild(incoming);

    // The outgoing box needs a wrapper to take full width
    var ogw = dce("div");
    ogw.style.display = "flex";

    // Create the outgoing box
    var outgoing = chatBox.outgoing = dce("input");
    outgoing.type = "text";
    outgoing.style.flex = "auto";
    ogw.appendChild(outgoing);
    wrapper.appendChild(ogw);

    // Make it visible
    mkUI().appendChild(wrapper);
    chatBox.visible = true;

    // Make outgoing work
    outgoing.onkeydown = function(ev) {
        if (ev.keyCode !== 13 || outgoing.value.trim() === "")
            return true;

        // Send this message
        sendChat(outgoing.value);
        recvChat("You: " + outgoing.value);
        outgoing.value = "";

        ev.preventDefault();
        return false;
    };

    return chatBox;
}

// And make it possible to display it
document.body.addEventListener("keydown", function(ev) {
    if (ev.key !== "c" || ev.target.nodeName === "INPUT")
        return true;

    mkChatBox().outgoing.focus();

    ev.preventDefault();
    return false;
});
