/*
 * Copyright (c) 2018-2023 Yahweasel
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
 * This file is part of Ennuicastr.
 *
 * Configuration and initial loading.
 */

import * as fileStorage from "./file-storage";
import { prot } from "./protocol";
import { dce, gebi, escape } from "./util";

/* These are the features selectable in the URL, not (necessarily) the
 * protocol */
export const features = {
    "continuous": 0x1,
    "rtc": 0x2,
    "videorec": 0x4,
    "transcription": 0x8,
    "recordOnly": 0x100,
    /* Currently, the default without setting AV flags is RTEnnui audio, Jitsi
     * video */
    "rtennuiAudio": 0x200,
    "rtennuiVideo": 0x400,
    "jitsiAudio": 0x800,
    "jitsiVideo": 0x1000,
};

// Configuration parameters come out of the URL search query
export const url = new URL(<any> window.location);
const params = new URLSearchParams(url.search);

// Configuration information
export let config: any = null;

// Configuration information for invite links
export let iconfig: any = null;

// Our username
export let username: string = null;

// The Jitsi URL
export let jitsiUrl: string = null;

// The RTEnnui URL
export let rtennuiUrl: string = null;

// Should we be creating FLAC?
export let useFlac = false;

// Which features to use
export let useContinuous = false;
export let useRTC = false;
export const useJitsi = {
    audio: false,
    video: false
};
export const useRTEnnui = {
    audio: false,
    video: false
};
export let useVideoRec = false;
export let useTranscription = false;
export let useRecordOnly = false;
export let useDebug = false;

/**
 * Load configuration information.
 */
export async function load(): Promise<boolean> {
    // Convert short-form configuration into long-form
    let shortForm: null|string = null;
    Array.from((<any> params).entries()).forEach(function(key: string) {
        key = key[0];
        if (/-/.test(key))
            shortForm = key;
    });

    if (shortForm) {
        const sfParts = shortForm.split("-");
        params.set("i", sfParts[0]);
        params.set("k", sfParts[1]);
        sfParts.slice(2).forEach(function(part) {
            params.set(part[0], part.slice(1));
        });
        params.delete(shortForm);
    }

    // Get our target for initial login
    const preEc = gebi("pre-ec");
    const loginTarget = gebi("login-ec") || document.body;

    // Read in our configuration
    config = {
        id: params.get("i"),
        key: params.get("k"),
        format: params.get("f")
    };
    iconfig = {}; // invite config
    const port = params.get("p");
    const master = params.get("m");
    const selector = params.get("s");
    const monitor = params.get("mon");
    username = params.get("nm");

    if (config.id === null) {
        // Redirect to the homepage
        window.location = <any> "/";
        return false;
    }

    // Normalize
    config.id = iconfig.id = Number.parseInt(config.id, 36);
    if (config.key === null) {
        const div = dce("div");
        div.innerHTML = "Invalid key!";
        loginTarget.appendChild(div);
        if (preEc) preEc.style.display = "";
        return false;
    }
    config.key = iconfig.key = Number.parseInt(config.key, 36);
    if (master !== null)
        config.master = iconfig.master = Number.parseInt(master, 36);
    if (port !== null)
        config.port = iconfig.port = Number.parseInt(port, 36);
    if (config.format === null)
        config.format = "0";
    config.format = iconfig.format = Number.parseInt(config.format, 36);

    // If we're using the selector, just do that
    if (selector) {
        let div = dce("div");
        div.innerText = "Client links:";
        loginTarget.appendChild(div);
        if (preEc) preEc.style.display = "";

        const sb = "?i=" + config.id.toString(36) + "&k=" + config.key.toString(36) + "&p=" + config.port.toString(36);

        for (let opt = 0; opt <= config.format; opt++) {
            if ((opt&config.format)!==opt) continue;
            // We don't let the menu decide to just not use WebRTC communication
            if ((opt&features.rtc)!==(config.format&features.rtc)) continue;

            div = dce("div");
            const a = dce("a");
            if (opt === 0)
                url.search = sb;
            else
                url.search = sb + "&f=" + opt.toString(36);
            a.href = url.toString();

            a.innerText = (((opt&prot.flags.dataTypeMask)===prot.flags.dataType.flac) ? "FLAC" : "Opus") +
                ((opt&features.continuous)?" continuous":"");

            div.appendChild(a);
            loginTarget.appendChild(div);
        }

        return false;
    }

    // If we're looking for the monitor, just do that
    if (monitor) {
        const scr = dce("script");
        scr.src = "ennuicastr-monitor.js?v=1";
        scr.async = true;
        loginTarget.appendChild(scr);
        if (preEc) preEc.style.display = "";
        return false;
    }

    // Hide the extraneous details
    url.search = "?i=" + config.id.toString(36);
    window.history.pushState({}, "Ennuicastr", url.toString());

    // If they were disconnected, just show them that message
    if (params.get("dc")) {
        const sp = dce("span");
        sp.innerText = "Disconnected! ";
        const a = dce("a");
        let href = "?";
        for (const key in config)
            href += key[0] + "=" + (<any> config)[key].toString(36) + "&";
        href += "nm=" + encodeURIComponent(username);
        a.href = href;
        a.innerText = "Attempt reconnection";
        sp.appendChild(a);
        loginTarget.appendChild(sp);
        if (preEc) preEc.style.display = "";
        return false;
    }

    // Next, check if we have a username
    if (username === null || username === "") {
        // Just ask for a username
        const div = dce("div");
        const quick = !!params.get("quick");

        // Tell them what's going on
        const span = dce("span");
        span.innerHTML =
            (quick?"":
                "You have been invited to join a recording on Ennuicastr. ") +
            "Please enter a username.<br/><br/>";
        div.appendChild(span);

        // Ask for their name
        const form = dce("form");
        form.action = "?";
        form.method = "GET";
        let def = "";
        if (typeof localStorage !== "undefined")
            def = localStorage.getItem("username") || "";
        def = escape(def);
        let html =
            "<label for=\"nm\">Username: </label><input name=\"nm\" id=\"nm\" type=\"text\" value=\"" + def + "\" /> ";
        for (const key in config)
            html += "<input name=\"" + key[0] + "\" type=\"hidden\" value=\"" + config[key].toString(36) + "\" />";
        html += "<input type=\"submit\" value=\"Join\" class=\"pill-button\" />";
        form.innerHTML = html;

        form.onsubmit = function(ev: Event) {
            // Quick mode = same window
            if (quick)
                return true;

            // Try to do this in a new window
            let target = "?";
            for (const key in config)
                target += key[0] + "=" + config[key].toString(36) + "&";
            target += "nm=" + encodeURIComponent(gebi("nm").value);
            if (params.get("debug"))
                target += "&debug=1";
            if (window.open(target, "", "width=800,height=600,menubar=0,toolbar=0,location=0,personalbar=0,status=0") === null) {
                // Just use the regular submit
                return true;
            }

            div.innerHTML = "Connecting in a new window. You may now close this tab.";

            ev.preventDefault();
            return false;
        };

        div.appendChild(form);
        loginTarget.appendChild(div);
        if (preEc) preEc.style.display = "";

        const nmBox = gebi("nm");
        nmBox.focus();
        nmBox.select();

        return false;

    } else {
        // Remember the username
        if (typeof localStorage !== "undefined")
            localStorage.setItem("username", username);

    }

    // The Jitsi URL
    jitsiUrl =
        (url.protocol==="http:"?"ws:":"wss:") +
        "//jitsi." + url.hostname + "/xmpp-websocket";

    // The RTEnnui URL
    {
        const tmp = new URL(url);
        tmp.protocol = (tmp.protocol==="http:"?"ws:":"wss:");
        // eslint-disable-next-line no-useless-escape
        tmp.pathname = url.pathname.replace(/\/[^\/]*$/, "/rtennui/ws");
        tmp.search = "";
        tmp.hash = "";
        rtennuiUrl = tmp.toString();
    }

    // Should we be creating FLAC?
    useFlac = ((config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac);

    // Which features to use
    useContinuous = !!(config.format&features.continuous);
    useRTC = !!(config.format&features.rtc);
    useVideoRec = !!(config.format&features.videorec);
    useTranscription = !!(config.format&features.transcription);
    useRecordOnly = !!(config.format&features.recordOnly);
    useJitsi.audio = !!(config.format&features.jitsiAudio);
    useJitsi.video = !!!(config.format&features.rtennuiVideo);
    useRTEnnui.audio = !useJitsi.audio;
    useRTEnnui.video = !useJitsi.video;
    useDebug = !!(params.get("debug"));

    // If we're in continuous mode, we don't distinguish the degrees of VAD
    if (useContinuous) waveVADColors = waveVADColorSets.sc;

    // If we're a host and recording video, we need persistent storage
    if ("master" in config && useVideoRec) {
        let persistent = false;
        if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
            persistent = await navigator.storage.persisted();
            if (!persistent)
                persistent = await navigator.storage.persist();
            if (!persistent && typeof Notification !== "undefined" &&
                Notification.requestPermission) {
                await Notification.requestPermission();
                persistent = await navigator.storage.persist();
            }
        }
    }

    // Clear anything expired
    await fileStorage.clearExpired();

    return true;
}

// The WebSock URL
export function wsUrl(): string {
    return (url.protocol==="http:"?"ws":"wss") + "://" + url.hostname + ":" + config.port;
}

// Call if we're disconnected, to forcibly close
export function disconnect(): void {
    try {
        let href = "?";
        for (const key in config)
            href += key[0] + "=" + (<any> config)[key].toString(36) + "&";
        href += "nm=" + encodeURIComponent(username) + "&dc=1";
        document.location.href = href;
    } catch (ex) {
        document.location.href = "?";
    }
}

/* Resolve the correct port (and ID and key) from the config parameters. If no
 * port is provided, we're connecting to a *lobby*, which creates *recordings*
 * on demand, so we need to figure out the current room. */
export function resolve(): Promise<unknown> {
    let p: Promise<unknown> = Promise.all([]);

    if (!config.port) {
        p = p.then(() => {
            const req: any = {
                lid: config.id,
                key: config.key
            };
            if ("master" in config)
                req.master = config.master;

            return fetch("lobby/", {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify(req)
            });

        }).then(res => {
            if (!res.ok)
                return disconnect();

            return res.json();

        }).then(res => {
            config.id = res.id;
            config.port = res.port;
            config.key = res.key;
            if ("master" in res)
                config.master = res.master;

        });
    }

    return p;
}

/* Color sets for wave vad colors
 * (s|r)(v|c):
 *   s means stopped (not recording)
 *   r means recording
 *   v means using VAD
 *   c means continuous mode
 * Each set is four colors: error, no, maybe, yes
 */
const waveVADColorSets = {
    "sv": ["#000", "#333", "#666", "#999"],
    "sc": ["#000", "#666", "#666", "#999"],
    "rv": ["#000", "#031", "#061", "#094"],
    "rc": ["#000", "#061", "#061", "#094"],
};

// And the current colors
export let waveVADColors = waveVADColorSets.sv;
export function setWaveVADColors(to: string): void { waveVADColors = (<any> waveVADColorSets)[to]; }
