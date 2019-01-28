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
 * This is the monitoring client. It shows which users are active and whether
 * they're speaking.
 */

(function() {
    var dce = document.createElement.bind(document);
    var gebi = document.getElementById.bind(document);
    var log = gebi("log");
    var plzno = {ideal: false};
    var prot = EnnuiCastrProtocol;
    var zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

    // Read in our configuration
    var url = new URL(window.location);
    var params = new URLSearchParams(url.search);
    var config = {
        id: params.get("i"),
        key: params.get("k"),
        port: params.get("p")
    };
    config.id = Number.parseInt(config.id, 36);
    config.key = Number.parseInt(config.key, 36);
    if (config.port === null)
        config.port = 36678;
    else
        config.port = Number.parseInt(config.port, 36);
    url.search = "?i=" + config.id.toString(36);
    window.history.pushState({}, "EnnuiCastr", url.toString());

    // Find the websock URL
    var wsUrl = (url.protocol==="http:"?"ws":"wss") + "://" + url.hostname + ":" + config.port;

    // Our monitoring socket
    var monSock = null;

    // Our current client states
    var clients = {};

    // And the display area for our current client states
    var displayDiv = null;
    var displayClients = null;

    // Connect to the server (our first step)
    var connected = false;
    function connect() {
        connected = true;
        log.innerText = "Connecting...";

        monSock = new WebSocket(wsUrl);
        monSock.binaryType = "arraybuffer";

        monSock.addEventListener("open", function() {
            var p = prot.parts.login;
            var out = new DataView(new ArrayBuffer(p.length));
            out.setUint32(0, prot.ids.login, true);
            out.setUint32(p.id, config.id, true);
            out.setUint32(p.key, config.key, true);
            out.setUint32(p.flags, prot.flags.connectionType.monitor, true);
            monSock.send(out.buffer);
        });

        monSock.addEventListener("message", monSockMsg);
        monSock.addEventListener("error", disconnect);
        monSock.addEventListener("close", disconnect);

        // Also prepare our div
        displayDiv = dce("div");
        var cl = dce("div");
        cl.innerText = "Clients:";
        displayDiv.appendChild(cl);
        displayClients = dce("div");
        displayDiv.appendChild(displayClients);
        document.body.appendChild(displayDiv);
        updateClients();
    }
    connect();

    // Called to disconnect explicitly, or implicitly on error
    function disconnect(ev) {
        if (!connected)
            return;
        connected = false;

        log.innerHTML = "";
        var sp = dce("span");
        sp.innerText = "Disconnected! ";
        log.appendChild(sp);
        var a = dce("a");
        var href = "?";
        for (var key in config)
            href += key[0] + "=" + config[key].toString(36) + "&";
        href += "mon=1";
        a.href = href;
        a.innerText = "Attempt reconnection";
        log.appendChild(a);

        var target = null;
        if (ev && ev.target)
            target = ev.target;

        function close(sock) {
            if (sock && sock !== target)
                sock.close();
            return null;
        }
        monSock = close(monSock);
    }

    // Message from the monitor socket
    function monSockMsg(msg) {
        msg = new DataView(msg.data);
        var cmd = msg.getUint32(0, true);
        log.innerText = cmd.toString(16);

        switch (cmd) {
            case prot.ids.ack:
                log.innerText = "";
                break;

            case prot.ids.user:
                var p = prot.parts.user;
                var idx = msg.getUint32(p.index, true);
                var stat = msg.getUint32(p.status, true);
                if (stat) {
                    var nick;
                    if (window.TextDecoder) {
                        nick = new TextDecoder("utf8").decode(msg.buffer.slice(p.nick));
                    } else {
                        nick = "";
                        for (var i = p.nick; i < msg.length; i++)
                            nick += String.fromCharCode(msg[i]);
                    }

                    // They're online
                    if (idx in clients) {
                        // They were already online!
                        break;
                    }
                    clients[idx] = {idx: idx, nick: nick, speaking: false};
                    updateClients();

                } else {
                    if (!(idx in clients)) {
                        // They weren't online anyway
                        break;
                    }
                    delete clients[idx];
                    updateClients();

                }
                break;

            case prot.ids.speech:
                var p = prot.parts.speech;
                var idxStatus = msg.getUint32(p.indexStatus, true);
                var idx = idxStatus>>1;
                var stat = (idxStatus&1);

                if (!(idx in clients)) {
                    // Not even connected...?
                    break;
                }

                var client = clients[idx];
                client.speaking = !!stat;
                client.el.style.backgroundColor = stat?"#073":"#000";
                break;
        }
    }

    // Update our client states
    function updateClients() {
        var cidxs = Object.keys(clients).sort(function(a, b) {
            a = clients[a];
            b = clients[b];
            if (a.nick < b.nick)
                return -1;
            else if (a.nick === b.nick)
                return (a.idx < b.idx)?-1:1;
            else
                return 1;
        });

        var ul = dce("ul");
        displayClients.innerHTML = "";
        displayClients.appendChild(ul);

        cidxs.forEach(function(idx) {
            var client = clients[idx];
            var li = dce("li");
            var el = dce("div");
            el.style.backgroundColor = client.speaking?"#073":"#000";
            el.style.padding = "0.5em";
            el.style.color = "#fff";
            el.innerText = client.nick;
            client.el = el;
            li.appendChild(el);
            ul.appendChild(li);
        });

        if (cidxs.length === 0) {
            var li = dce("li");
            li.innerText = "(None)";
            ul.appendChild(li);
        }
    }
})();
