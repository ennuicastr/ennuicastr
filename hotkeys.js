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

(function() {
    // Our hotkeys are stored in localstorage
    if (typeof localStorage === "undefined")
        return;

    // Check for existing hotkeys
    var hotkeys = localStorage.getItem("hotkeys");
    if (hotkeys)
        hotkeys = JSON.parse(hotkeys);
    else
        hotkeys = (typeof ECDefaultHotkeys === "undefined" ? {} : ECDefaultHotkeys);
    var idToHotkey = {};

    // Reassert them all
    Object.keys(hotkeys).forEach(function(code) {
        var hotkey = hotkeys[code];
        delete hotkeys[code];

        // Extend to the event
        if (typeof hotkey === "string") {
            var ev = {
                key: code.slice(4),
                altKey: !!~~(code[0]),
                ctrlKey: !!~~(code[1]),
                metaKey: !!~~(code[2]),
                shiftKey: !!~~(code[3])
            };
            hotkey = {ev: ev, id: hotkey};
        }

        addHotkey(hotkey.ev, hotkey.id);
    });

    // Create our interface for getting a key code
    var kcw = document.createElement("div");
    var kcb = document.createElement("div");
    kcb.style.position = "fixed";
    kcb.style.left =  "0";
    kcb.style.top =  "0";
    kcb.style.width =  "100%";
    kcb.style.height =  "100%";
    kcb.style.opacity = "0.95";
    kcb.style.zIndex = "1000000";
    kcw.appendChild(kcb);
    var kct = document.createElement("div");
    kct.style.position = "fixed";
    kct.style.display = "flex";
    kct.style.left =  "0";
    kct.style.top =  "0";
    kct.style.width =  "100%";
    kct.style.height =  "100%";
    kct.style.zIndex = "1000001";
    kct.style.alignItems = "center";
    kct.style.justifyContent = "center";
    kct.innerText = "Please press a hotkey, or escape for none";
    kcw.appendChild(kct);

    var userKeyCallback = null;

    // Our function for getting a key code
    function getUserKey() {
        return Promise.all([]).then(function() {
            // Make the prompt
            var bcs = getComputedStyle(document.body);
            kcb.style.backgroundColor = bcs.backgroundColor || "#000";
            kct.style.color = bcs.color || "#000";
            document.body.appendChild(kcw);

            // And wait for the hotkey
            return new Promise(function(res, rej) {
                userKeyCallback = function(ev) {
                    if (ev.key === "Alt" ||
                        ev.key === "AltGraph" ||
                        ev.key === "CapsLock" ||
                        ev.key === "Control" ||
                        ev.key === "Fn" ||
                        ev.key === "FnLock" ||
                        ev.key === "Meta" ||
                        ev.key === "Shift")
                        return true;
                    ev.preventDefault();
                    res(ev);
                    return false;
                };
            });

        }).then(function(ev) {
            document.body.removeChild(kcw);
            userKeyCallback = null;

            if (ev.key === "Escape")
                return null;
            return {
                key: ev.key,
                altKey: ev.altKey,
                ctrlKey: ev.ctrlKey,
                metaKey: ev.metaKey,
                shiftKey: ev.shiftKey
            };

        });
    }

    // Save our hotkey state
    function saveHotkeys() {
        localStorage.setItem("hotkeys", JSON.stringify(hotkeys));
    }

    // Convert an event to its code
    function evToCode(ev) {
        return "" +
               (~~ev.altKey) +
               (~~ev.ctrlKey) +
               (~~ev.metaKey) +
               (~~ev.shiftKey) +
               ev.key;
    }

    // Add the given hotkey
    function addHotkey(ev, id) {
        // Generate our code for it
        var code = evToCode(ev);

        // Remove anything that's already there
        if (code in hotkeys)
            removeHotkey(code);

        // Add it
        hotkeys[code] = {
            ev: ev,
            id: id
        };
        idToHotkey[id] = code;

        // Helper text
        var helper = ev.key.toUpperCase();
        if (helper === " ")
            helper = "_";
        if (ev.shiftKey)
            helper = "\u21e7" + helper;
        if (ev.metaKey)
            helper = "\u25c6" + helper;
        if (ev.altKey)
            helper = "\u2387" + helper;
        if (ev.ctrlKey)
            helper = "\u2388" + helper;

        // And style it
        var style = document.createElement("style");
        style.type = "text/css";
        style.innerHTML = '#' + id + ':not(.hotkey-hidden):after { content: " (' + helper + ')"; }';
        document.body.appendChild(style);

        saveHotkeys();
    }

    // Remove a given hotkey
    function removeHotkey(code) {
        if (!(code in hotkeys))
            return;
        var id = hotkeys[code].id;

        // Un-style it
        var style = document.createElement("style");
        style.type = "text/css";
        style.innerHTML = '#' + id + ':not(.hotkey-hidden):after { content: ""; }';
        document.body.appendChild(style);

        // And remove it
        delete hotkeys[code];
        delete idToHotkey[id];

        saveHotkeys();
    }

    // The full interaction
    function assignHotkey(id) {
        if (id in idToHotkey) {
            // Remove the existing one
            removeHotkey(idToHotkey[id]);
        }

        // Assign a new one
        return getUserKey().then(function(ev) {
            if (ev)
                addHotkey(ev, id);
        });
    }

    // Hotkey handler
    document.body.addEventListener("keydown", function(ev) {
        if (userKeyCallback)
            return userKeyCallback(ev);

        var code = evToCode(ev);

        // No hotkeys on input
        if (ev.target.nodeName === "INPUT") {
            switch (ev.target.type.toLowerCase()) {
                case "text":
                case "":
                    // Special case for the enter hotkey
                    if (code === "0000Enter") {
                        var enterId = ev.target.dataset.hotkeyEnter;
                        var enterEl = (enterId ? document.getElementById(enterId) : null);
                        if (enterEl) {
                            enterEl.click();
                            ev.preventDefault();
                            ev.stopPropagation();
                            return false;
                        }
                    }

                case "date":
                case "datetime-local":
                case "email":
                case "month":
                case "number":
                case "password":
                case "search":
                case "tel":
                case "time":
                case "url":
                case "week":
                    return true;
            }
        }

        // Check if this is a hotkey
        if (!(code in hotkeys))
            return true;

        // Handle the hotkey
        var hotkey = hotkeys[code];
        var el = document.getElementById(hotkey.id);
        if (!el) return true;
        el.click();

        ev.preventDefault();
        ev.stopPropagation();
        return false;
    });

    // And the way to add hotkeys
    document.body.addEventListener("click", function(ev) {
        if (!ev.ctrlKey)
            return true;

        // Find a relevant target
        var target = ev.target;
        while (target) {
            console.error(target);
            if (target.id &&
                (target.nodeName === "BUTTON" || target.nodeName === "A"))
                break;
            target = target.parentElement;
        }
        if (!target)
            return true;

        assignHotkey(target.id);

        ev.preventDefault();
        ev.stopPropagation();
        return false;
    }, true);
})();
